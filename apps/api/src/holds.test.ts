import { schema } from '@bookstore/db';
import * as orders from '@bookstore/modules/orders';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './testing.js';

/** Pre-orders, special orders and the to-notify worklist (FR-ORD-14..18, BR-10, UC-19). */
let h: Harness;
let owner: string;
let online: string;
let supplierId: string;
let upcoming: string;
let other: string;
let shiftId: string;

async function level(variantId: string) {
  const [r] = await h.t.sql`select on_hand, reserved from inventory.stock_level where variant_id = ${variantId}`;
  return { onHand: r?.on_hand ?? 0, reserved: r?.reserved ?? 0 };
}

async function stockIn(variantId: string, qty: number) {
  const r = await h.call('POST', '/api/v1/purchasing/stock-in/existing', { cookie: owner, body: { supplierId, line: { variantId, costVnd: 60000, sellingPriceVnd: 120000, qty } } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  // The worker runs preorder.allocate on stock_in.posted (TDD §9.1).
  await orders.allocatePreorders(h.ctx(), [variantId]);
}

const cash = (amountVnd: number) => ({ method: 'cash', amountVnd, shiftId });

beforeAll(async () => {
  h = await startHarness();
  let roles: Record<string, string>;
  ({ owner, roles } = await h.setupOwner());
  online = await h.staff(owner, 'online', roles.online_staff!);
  const cat = (await h.call('POST', '/api/v1/catalog/categories', { cookie: owner, body: { i18n: { en: { name: 'Books' } } } })).body.id;
  supplierId = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Nhã Nam', phone: '0900000000' } })).body.id;
  const mk = async (sku: string, title: string) => {
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', {
      cookie: owner,
      body: { supplierId, line: { item: { kind: 'book', i18n: { en: { title, description: title } }, categoryIds: [cat] }, variant: { sku, weightG: 300, vatBp: 0 }, imageFileIds: ['00000000-0000-7000-8000-00000000000a'], costVnd: 60000, sellingPriceVnd: 120000, qty: 1 } },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.lines[0].variantId as string;
  };
  upcoming = await mk('SACH-NEW-01', 'Upcoming novel');
  other = await mk('SACH-OLD-01', 'Backlist title');
  // Sell the one opening copy of the upcoming title so it is out of stock.
  await h.t.sql`update inventory.stock_level set reserved = 1 where variant_id = ${upcoming}`;
  await h.t.sql`insert into inventory.stock_reservation (ref_type, ref_id, variant_id, qty) values ('test', uuidv7(), ${upcoming}, 1)`;
  const registerId = (await h.call('GET', '/api/v1/pos/registers', { cookie: owner })).body.items[0].id;
  shiftId = (await h.call('POST', '/api/v1/pos/shifts/open', { cookie: owner, body: { registerId, floatVnd: 500000 } })).body.id;
  await h.t.db.insert(schema.geoProvince).values({ id: 201, name: 'Hà Nội', searchText: 'ha noi' });
  await h.t.db.insert(schema.geoWard).values({ code: '1A0101', name: 'Phường Hàng Bài', provinceId: 201, districtId: 1488, districtName: 'Quận Hoàn Kiếm', searchText: 'phuong hang bai' });
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

describe('pre-orders (FR-ORD-14, BR-10)', () => {
  let first: { id: string; docNo: string };
  let second: { id: string };

  it('takes a deposit of at least 30% at the counter, cash into the open shift', async () => {
    const low = await h.call('POST', '/api/v1/preorders', { cookie: online, body: { customer: { name: 'Mai', phone: '0911000001' }, variantId: upcoming, qty: 2, deposit: cash(10000) } });
    expect(low.status).toBe(422);
    expect(low.body.error.code).toBe('deposit_out_of_range');
    const r = await h.call('POST', '/api/v1/preorders', { cookie: online, body: { source: 'zalo', customer: { name: 'Mai', phone: '0911000001' }, variantId: upcoming, qty: 2, deposit: cash(72000) } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'reserved' });
    expect(r.body.docNo).toMatch(/^DT-\d{4}-00001$/);
    first = r.body;
    const [m] = await h.t.sql`select direction, amount_vnd::int as amount, reason from sales.cash_movement where shift_id = ${shiftId}`;
    expect(m).toMatchObject({ direction: 'in', amount: 72000, reason: `Cọc ${first.docNo}` });
    second = (await h.call('POST', '/api/v1/preorders', { cookie: online, body: { customer: { name: 'Nam', phone: '0911000002' }, variantId: upcoming, qty: 1, deposit: { method: 'transfer', amountVnd: 120000, ref: 'ABCD2345' } } })).body;
  });

  it('allocates incoming stock oldest first and adds the customer to the worklist', async () => {
    await stockIn(upcoming, 2);
    const list = (await h.call('GET', '/api/v1/preorders', { cookie: online })).body.items;
    expect(list.find((p: { id: string }) => p.id === first.id).status).toBe('arrived');
    expect(list.find((p: { id: string }) => p.id === second.id).status).toBe('reserved');
    const tasks = (await h.call('GET', '/api/v1/contact-tasks', { cookie: online })).body.items;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ reason: 'preorder_arrived', refLabel: first.docNo, phone: '+84911000001', overdue: false });
    // One more copy: the second pre-order is next.
    await stockIn(upcoming, 1);
    expect((await h.call('GET', '/api/v1/preorders?status=arrived', { cookie: online })).body.items).toHaveLength(2);
  });

  it('starts the holding period when the customer is contacted and alerts once past it (FR-ORD-16)', async () => {
    const task = (await h.call('GET', '/api/v1/contact-tasks?reason=preorder_arrived', { cookie: online })).body.items.find((t: { refId: string }) => t.refId === second.id);
    expect((await h.call('POST', `/api/v1/contact-tasks/${task.id}/unreachable`, { cookie: online, body: { note: 'Không nghe máy' } })).body.attempts).toBe(1);
    expect((await h.call('POST', `/api/v1/contact-tasks/${task.id}/contacted`, { cookie: online, body: {} })).body.status).toBe('contacted');
    const p = (await h.call('GET', '/api/v1/preorders?status=contacted', { cookie: online })).body.items[0];
    expect(p.id).toBe(second.id);
    expect(new Date(p.expiresAt).getTime() - new Date(p.contactedAt).getTime()).toBe(7 * 86_400_000);
    h.clock.advance(8 * 86_400_000);
    expect(await orders.notifyExpiredHolds(h.ctx())).toBe(1);
    expect(await orders.notifyExpiredHolds(h.ctx())).toBe(0);
    // The first pre-order's task is overdue too (24 h deadline).
    expect(await orders.notifyOverdueTasks(h.ctx())).toBe(1);
    owner = await h.login('lan', 'chu-cua-hang-2026');
    online = await h.login('online', 'mat-khau-moi-456');
    const badges = (await h.call('GET', '/api/v1/me/badges', { cookie: online })).body;
    expect(badges).toMatchObject({ holdsOverdue: 1, contactTasksOverdue: 1 });
  });

  it('cancels past the holding period keeping the deposit, and the copy goes back', async () => {
    const before = await level(upcoming);
    const r = await h.call('POST', `/api/v1/preorders/${second.id}/cancel`, { cookie: online, body: { reason: 'Khách không đến nhận', deposit: 'forfeit' } });
    expect(r.body).toMatchObject({ status: 'cancelled', depositOutcome: 'forfeit' });
    expect((await level(upcoming)).reserved).toBe(before.reserved - 1);
  });

  it('collects as a store-pickup order at the agreed price less the deposit', async () => {
    // A price rise after the pre-order does not change the agreed price.
    await h.t.sql`update catalog.item_variant set price_vnd = 150000 where id = ${upcoming}`;
    const before = await level(upcoming);
    const r = await h.call('POST', `/api/v1/preorders/${first.id}/collect`, { cookie: online, body: { delivery: 'pickup', paymentMethod: 'cod' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const o = (await h.call('GET', `/api/v1/orders/${r.body.order.id}`, { cookie: online })).body;
    expect(o).toMatchObject({ totalVnd: 240000, depositVnd: 72000, delivery: 'pickup', source: 'zalo', sourceRef: first.docNo });
    expect(o.status).toBe('new');
    expect(await level(upcoming)).toEqual(before);
    expect((await h.call('POST', `/api/v1/preorders/${first.id}/collect`, { cookie: online, body: { delivery: 'pickup', paymentMethod: 'cod' } })).body.error.code).toBe('invalid_transition');
  });

  it('collects a fully paid pre-order by GHN with nothing left to collect', async () => {
    await h.t.sql`update catalog.item_variant set price_vnd = 120000 where id = ${upcoming}`;
    const p = (await h.call('POST', '/api/v1/preorders', { cookie: online, body: { customer: { name: 'Lan Anh', phone: '0911000003' }, variantId: upcoming, qty: 1, deposit: { method: 'card', amountVnd: 120000, ref: 'APPR01' } } })).body;
    await stockIn(upcoming, 1);
    const r = await h.call('POST', `/api/v1/preorders/${p.id}/collect`, { cookie: online, body: { delivery: 'ship', address: { provinceId: 201, wardCode: '1A0101', line: '5 Tràng Tiền' }, paymentMethod: 'transfer', shippingVnd: 0 } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.order).toMatchObject({ status: 'new', reviewReasons: [], paymentRef: null });
    const ship = await h.call('POST', `/api/v1/orders/${r.body.order.id}/confirm`, { cookie: online });
    expect(ship.body.status).toBe('confirmed');
    const s = await h.call('POST', `/api/v1/orders/${r.body.order.id}/shipment`, { cookie: online, body: { carrier: 'ghn' } });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const [shipment] = await h.t.sql`select cod_vnd::int as cod from orders.shipment where order_id = ${r.body.order.id}`;
    expect(shipment!.cod).toBe(0);
  });
});

describe('special orders (FR-ORD-15)', () => {
  it('runs Requested → Ordered → Arrived → Contacted → Collected, refunding nothing extra', async () => {
    const r = await h.call('POST', '/api/v1/special-orders', { cookie: online, body: { customer: { name: 'Quang', phone: '0911000004' }, requestedTitle: 'Sapiens (bìa cứng)', isbn: '9780062316097', qty: 2, quoteVnd: 450000, deposit: cash(300000) } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.docNo).toMatch(/^DR-/);
    const id = r.body.id;
    expect((await h.call('POST', `/api/v1/special-orders/${id}/ordered`, { cookie: online })).body.status).toBe('ordered');
    const noStock = await h.call('POST', `/api/v1/special-orders/${id}/arrived`, { cookie: online, body: { variantId: other } });
    expect(noStock.body.error.code).toBe('insufficient_stock');
    await stockIn(other, 1);
    expect((await h.call('POST', `/api/v1/special-orders/${id}/arrived`, { cookie: online, body: { variantId: other } })).body.status).toBe('arrived');
    const task = (await h.call('GET', '/api/v1/contact-tasks?reason=special_order_arrived', { cookie: online })).body.items[0];
    await h.call('POST', `/api/v1/contact-tasks/${task.id}/contacted`, { cookie: online, body: { note: 'Khách hẹn thứ Bảy' } });
    const c = await h.call('POST', `/api/v1/special-orders/${id}/collect`, { cookie: online, body: { delivery: 'pickup', paymentMethod: 'cod' } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const o = (await h.call('GET', `/api/v1/orders/${c.body.order.id}`, { cookie: online })).body;
    expect(o).toMatchObject({ totalVnd: 900000, depositVnd: 300000 });
  });

  it('refunds a cash deposit from the open shift on cancel', async () => {
    const r = (await h.call('POST', '/api/v1/special-orders', { cookie: online, body: { customer: { name: 'Quang', phone: '0911000004' }, requestedTitle: 'Atlas', quoteVnd: 300000, deposit: cash(100000) } })).body;
    const noShift = await h.call('POST', `/api/v1/special-orders/${r.id}/cancel`, { cookie: online, body: { reason: 'Nhà phát hành hết hàng', deposit: 'refund' } });
    expect(noShift.status).toBe(400);
    const ok = await h.call('POST', `/api/v1/special-orders/${r.id}/cancel`, { cookie: online, body: { reason: 'Nhà phát hành hết hàng', deposit: 'refund', shiftId } });
    expect(ok.body.status).toBe('cancelled');
    const [m] = await h.t.sql`select direction, amount_vnd::int as amount from sales.cash_movement where reason = ${`Hoàn cọc ${r.docNo}`}`;
    expect(m).toMatchObject({ direction: 'out', amount: 100000 });
  });
});
