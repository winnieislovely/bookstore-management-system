import * as orders from '@bookstore/modules/orders';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PW, startHarness, type Harness } from './testing.js';

/** Pre-orders at the POS and the to-notify worklist (FR-POS-09, FR-ORD-14, FR-ORD-16, FR-ORD-18, BR-10, UC-11, UC-19). */
let h: Harness;
let owner: string;
let cashier: string;
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
  cashier = await h.staff(owner, 'thu', roles.cashier!);
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
  // The one opening copy of the upcoming title is held elsewhere, so it is out of stock.
  await h.t.sql`update inventory.stock_level set reserved = 1 where variant_id = ${upcoming}`;
  await h.t.sql`insert into inventory.stock_reservation (ref_type, ref_id, variant_id, qty) values ('test', uuidv7(), ${upcoming}, 1)`;
  const registerId = (await h.call('GET', '/api/v1/pos/registers', { cookie: cashier })).body.items[0].id;
  shiftId = (await h.call('POST', '/api/v1/pos/shifts/open', { cookie: cashier, body: { registerId, floatVnd: 500000 } })).body.id;
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

describe('pre-orders at the POS (FR-POS-09, FR-ORD-14, BR-10)', () => {
  let first: { id: string; docNo: string };
  let second: { id: string; docNo: string };

  it('lets the cashier take a deposit of at least 30%, cash into the open shift', async () => {
    const low = await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Mai', phone: '0911000001' }, lines: [{ variantId: upcoming, qty: 2 }], deposit: cash(10000) } });
    expect(low.status).toBe(422);
    expect(low.body.error.code).toBe('deposit_out_of_range');
    const r = await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Mai', phone: '0911000001' }, lines: [{ variantId: upcoming, qty: 2 }], deposit: cash(72000) } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'reserved' });
    expect(r.body.docNo).toMatch(/^DT-\d{4}-00001$/);
    first = r.body;
    const [m] = await h.t.sql`select direction, amount_vnd::int as amount, reason from sales.cash_movement where shift_id = ${shiftId}`;
    expect(m).toMatchObject({ direction: 'in', amount: 72000, reason: `Cọc ${first.docNo}` });
    second = (await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Nam', phone: '0911000002' }, lines: [{ variantId: upcoming, qty: 1 }], deposit: { method: 'transfer', amountVnd: 120000, ref: 'ABCD2345' } } })).body;
    // Online staff without the POS permission do not see pre-orders any more.
    expect((await h.call('GET', '/api/v1/preorders', { cookie: online })).status).toBe(403);
  });

  it('allocates incoming stock oldest first; a fully held pre-order is Arrived', async () => {
    await stockIn(upcoming, 2);
    const list = (await h.call('GET', '/api/v1/preorders', { cookie: cashier })).body.items;
    expect(list.find((p: { id: string }) => p.id === first.id).status).toBe('arrived');
    expect(list.find((p: { id: string }) => p.id === second.id).status).toBe('reserved');
    expect(list.find((p: { id: string }) => p.id === first.id).customerPhone).toBe('+84911000001');
    await stockIn(upcoming, 1);
    expect((await h.call('GET', '/api/v1/preorders?status=arrived', { cookie: cashier })).body.items).toHaveLength(2);
  });

  it('collects at the POS: agreed price, deposit counted as paid, held copies sold', async () => {
    // A price rise after the pre-order does not change the agreed price.
    await h.t.sql`update catalog.item_variant set price_vnd = 150000 where id = ${upcoming}`;
    const [mai] = await h.t.sql`select id from crm.customer where phone_e164 = '+84911000001'`;
    const before = await level(upcoming);
    const body = (payments: unknown[], extra: Record<string, unknown> = {}) => ({
      shiftId,
      preorderId: first.id,
      customerId: mai!.id,
      lines: [{ lineId: 'p1', variantId: upcoming, qty: 2 }],
      payments,
      ...extra,
    });
    const wrongQty = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: body([{ method: 'cash', amountVnd: 48000 }], { lines: [{ lineId: 'p1', variantId: upcoming, qty: 1 }] }) });
    expect(wrongQty.body.error.code).toBe('preorder_line');
    const short = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: body([{ method: 'cash', amountVnd: 240000 }]) });
    expect(short.body.error.code).toBe('payment_mismatch');
    const sale = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: body([{ method: 'cash', amountVnd: 168000, tenderedVnd: 200000 }]) });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(sale.body).toMatchObject({ totalVnd: 240000, changeVnd: 32000 });
    const rec = (await h.call('GET', `/api/v1/pos/sales/${sale.body.id}`, { cookie: cashier })).body;
    expect(rec.payments.map((p: { method: string; amountVnd: number; ref: string | null }) => [p.method, p.amountVnd])).toEqual(expect.arrayContaining([['cash', 168000], ['deposit', 72000]]));
    expect(rec.payments.find((p: { method: string }) => p.method === 'deposit').ref).toBe(first.docNo);
    expect(await level(upcoming)).toEqual({ onHand: before.onHand - 2, reserved: before.reserved - 2 });
    const p = (await h.call('GET', `/api/v1/preorders?q=${first.docNo}`, { cookie: cashier })).body.items[0];
    expect(p).toMatchObject({ status: 'collected', saleId: sale.body.id });
    // The drawer counts the deposit once, when it was taken (cash movement), and the rest at the sale.
    const shift = (await h.call('GET', `/api/v1/pos/shifts/${shiftId}`, { cookie: cashier })).body;
    expect(shift.cash).toMatchObject({ cashSalesVnd: 168000, cashInVnd: 72000 });
    const again = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: body([{ method: 'cash', amountVnd: 168000 }]) });
    expect(again.body.error.code).toBe('preorder_not_ready');
  });

  it('starts the holding period when the customer was called and alerts once past it (FR-ORD-16)', async () => {
    expect((await h.call('POST', `/api/v1/preorders/${second.id}/contacted`, { cookie: cashier })).body.status).toBe('contacted');
    expect((await h.call('POST', `/api/v1/preorders/${second.id}/contacted`, { cookie: cashier })).body.error.code).toBe('invalid_transition');
    const p = (await h.call('GET', '/api/v1/preorders?status=contacted', { cookie: cashier })).body.items[0];
    expect(p.id).toBe(second.id);
    expect(new Date(p.expiresAt).getTime() - new Date(p.contactedAt).getTime()).toBe(7 * 86_400_000);
    h.clock.advance(8 * 86_400_000);
    expect(await orders.notifyExpiredHolds(h.ctx())).toBe(1);
    expect(await orders.notifyExpiredHolds(h.ctx())).toBe(0);
    cashier = await h.login('thu', 'mat-khau-moi-456');
    owner = await h.login('lan', OWNER_PW);
    expect((await h.call('GET', '/api/v1/me/badges', { cookie: cashier })).body).toMatchObject({ holdsOverdue: 1 });
  });

  it('cancels past the holding period keeping the deposit, and the copy goes back', async () => {
    const before = await level(upcoming);
    const r = await h.call('POST', `/api/v1/preorders/${second.id}/cancel`, { cookie: cashier, body: { reason: 'Khách không đến nhận', deposit: 'forfeit' } });
    expect(r.body).toMatchObject({ status: 'cancelled', depositOutcome: 'forfeit' });
    expect((await level(upcoming)).reserved).toBe(before.reserved - 1);
  });

  it('holds several products item by item and is Arrived only when all are held', async () => {
    const registerId = (await h.call('GET', '/api/v1/pos/registers', { cookie: cashier })).body.items[0].id;
    const current = (await h.call('GET', `/api/v1/pos/shifts/current?register=${registerId}`, { cookie: cashier })).body.shift.id;
    const dup = await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Hà', phone: '0911000005' }, lines: [{ variantId: other, qty: 1 }, { variantId: other, qty: 2 }], deposit: { method: 'cash', amountVnd: 200000, shiftId: current } } });
    expect(dup.status).toBe(400);
    const p = (await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Hà', phone: '0911000005' }, lines: [{ variantId: other, qty: 1 }, { variantId: upcoming, qty: 5 }], deposit: { method: 'cash', amountVnd: 300000, shiftId: current } } })).body;
    expect(p.status).toBe('reserved');
    let row = (await h.call('GET', `/api/v1/preorders?q=${p.docNo}`, { cookie: cashier })).body.items[0];
    expect(row.totalVnd).toBe(120000 + 5 * 150000);
    expect(row.lines.map((l: { variantId: string; held: boolean }) => [l.variantId, l.held])).toEqual([
      [other, true],
      [upcoming, false],
    ]);
    await stockIn(upcoming, 5);
    row = (await h.call('GET', `/api/v1/preorders?q=${p.docNo}`, { cookie: cashier })).body.items[0];
    expect(row.status).toBe('arrived');
    const [ha] = await h.t.sql`select id from crm.customer where phone_e164 = '+84911000005'`;
    const missing = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: { shiftId: current, preorderId: p.id, customerId: ha!.id, lines: [{ lineId: 'a', variantId: other, qty: 1 }], payments: [{ method: 'cash', amountVnd: 1 }] } });
    expect(missing.body.error.code).toBe('preorder_line');
    const sale = await h.call('POST', '/api/v1/pos/sales', {
      cookie: cashier,
      body: { shiftId: current, preorderId: p.id, customerId: ha!.id, lines: [{ lineId: 'a', variantId: other, qty: 1 }, { lineId: 'b', variantId: upcoming, qty: 5 }], payments: [{ method: 'cash', amountVnd: 870000 - 300000 }] },
    });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(sale.body.totalVnd).toBe(870000);
  });

  it('refunds a cash deposit from the open shift on cancel', async () => {
    const registerId = (await h.call('GET', '/api/v1/pos/registers', { cookie: cashier })).body.items[0].id;
    const current = (await h.call('GET', `/api/v1/pos/shifts/current?register=${registerId}`, { cookie: cashier })).body.shift.id;
    const p = (await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Quang', phone: '0911000004' }, lines: [{ variantId: other, qty: 3 }], deposit: { method: 'cash', amountVnd: 120000, shiftId: current } } })).body;
    expect((await h.call('POST', `/api/v1/preorders/${p.id}/ordered`, { cookie: cashier })).body.status).toBe('ordered');
    const noShift = await h.call('POST', `/api/v1/preorders/${p.id}/cancel`, { cookie: cashier, body: { reason: 'Nhà phát hành hết hàng', deposit: 'refund' } });
    expect(noShift.status).toBe(400);
    const ok = await h.call('POST', `/api/v1/preorders/${p.id}/cancel`, { cookie: cashier, body: { reason: 'Nhà phát hành hết hàng', deposit: 'refund', shiftId: current } });
    expect(ok.body.status).toBe('cancelled');
    const [m] = await h.t.sql`select direction, amount_vnd::int as amount from sales.cash_movement where reason = ${`Hoàn cọc ${p.docNo}`}`;
    expect(m).toMatchObject({ direction: 'out', amount: 120000 });
  });
});
