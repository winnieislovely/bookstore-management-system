import * as orders from '@bookstore/modules/orders';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PW, startHarness, type Harness } from './testing.js';

/** Pre-orders: holds, deposits, statuses set by hand, collection and expiry (FR-POS-09, FR-ORD-14, FR-ORD-16, BR-10, UC-11). */
let h: Harness;
let owner: string;
let cashier: string;
let online: string;
let supplierId: string;
let upcoming: string;
let other: string;
let rare: string;
let shiftId: string;

async function level(variantId: string) {
  const [r] = await h.t.sql`select on_hand, reserved from inventory.stock_level where variant_id = ${variantId}`;
  return { onHand: r?.on_hand ?? 0, reserved: r?.reserved ?? 0 };
}

async function stockIn(variantId: string, qty: number) {
  const r = await h.stockInOne({ cookie: owner, body: { supplierId, line: { variantId, costVnd: 60000, sellingPriceVnd: 120000, qty } } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
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
    const r = await h.newProduct({
      cookie: owner,
      body: { supplierId, line: { item: { kind: 'book', i18n: { en: { title, description: title } }, categoryIds: [cat] }, variant: { sku, weightG: 300, vatBp: 0 }, imageFileIds: ['00000000-0000-7000-8000-00000000000a'], costVnd: 60000, sellingPriceVnd: 120000, qty: 1 } },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.lines[0].variantId as string;
  };
  upcoming = await mk('SACH-NEW-01', 'Upcoming novel');
  other = await mk('SACH-OLD-01', 'Backlist title');
  rare = await mk('SACH-RARE-01', 'Rare import');
  // The one opening copy of the upcoming title is held elsewhere, so it is out of stock.
  await h.t.sql`update inventory.stock_level set reserved = 1 where variant_id = ${upcoming}`;
  await h.t.sql`insert into inventory.stock_reservation (ref_type, ref_id, variant_id, qty) values ('test', uuidv7(), ${upcoming}, 1)`;
  await h.t.sql`update inventory.stock_level set reserved = 1 where variant_id = ${rare}`;
  await h.t.sql`insert into inventory.stock_reservation (ref_type, ref_id, variant_id, qty) values ('test', uuidv7(), ${rare}, 1)`;
  const registerId = (await h.call('GET', '/api/v1/pos/registers', { cookie: cashier })).body.items[0].id;
  shiftId = (await h.call('POST', '/api/v1/pos/shifts/open', { cookie: cashier, body: { registerId, floatVnd: 500000 } })).body.id;
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

describe('pre-orders (FR-POS-09, FR-ORD-14, FR-ORD-16, BR-10)', () => {
  const find = async (docNo: string) => (await h.call('GET', `/api/v1/preorders?q=${docNo}`, { cookie: cashier })).body.items[0];
  const customerId = async (phone: string) => (await h.t.sql`select id from crm.customer where phone_e164 = ${phone}`)[0]!.id as string;
  let first: { id: string; docNo: string };
  let second: { id: string; docNo: string };
  let quang: { id: string; docNo: string };

  it('holds copies on the shelf at once: no manager, optional deposit, 3 days without one', async () => {
    const before = await level(other);
    const r = await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Lan Anh', phone: '0911000009' }, lines: [{ variantId: other, qty: 1 }] } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('contacted');
    expect(r.body.docNo).toMatch(/^DT-\d{4}-00001$/);
    expect(new Date(r.body.expiresAt).getTime() - h.clock.now().getTime()).toBe(3 * 86_400_000);
    expect((await level(other)).reserved).toBe(before.reserved + 1);
    // The held copy cannot be sold to someone else (FR-INV-05).
    const walkIn = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: { shiftId, lines: [{ lineId: 'w', variantId: other, qty: 1 }], payments: [{ method: 'cash', amountVnd: 120000 }] } });
    expect(walkIn.body.error.code).toBe('insufficient_stock');
    // The POS search shows who it is held for.
    const holds = (await h.call('GET', `/api/v1/preorders/holds?variant=${other}`, { cookie: cashier })).body.items;
    expect(holds).toEqual([expect.objectContaining({ docNo: r.body.docNo, customerPhone: '+84911000009', qty: 1 })]);
    // A hold is Chờ nhận from the start: it cannot be set back to an order status.
    expect((await h.call('POST', `/api/v1/preorders/${r.body.id}/status`, { cookie: cashier, body: { status: 'ordered' } })).body.error.code).toBe('invalid_transition');
    // A cashier may cancel a slip without a deposit; the copy goes back.
    expect((await h.call('POST', `/api/v1/preorders/${r.body.id}/cancel`, { cookie: cashier, body: { reason: 'Khách đổi ý' } })).body.status).toBe('cancelled');
    expect((await level(other)).reserved).toBe(before.reserved);
    // Online staff without the POS permission do not see pre-orders.
    expect((await h.call('GET', '/api/v1/preorders', { cookie: online })).status).toBe(403);
  });

  it('takes books to order (free text too) with a deposit of at least 30% of the catalogue books', async () => {
    const body = (deposit?: unknown) => ({ customer: { name: 'Mai', phone: '0911000001' }, lines: [{ variantId: upcoming, qty: 2 }, { title: 'Rare import ISBN 978-0-00-000000-1', qty: 1 }], ...(deposit ? { deposit } : {}) });
    // 30 % of the two catalogue copies (240 000); the free-text book adds nothing.
    expect((await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: body() })).body.error).toMatchObject({ code: 'deposit_out_of_range', details: expect.objectContaining({ minVnd: 72000 }) });
    expect((await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: body(cash(10000)) })).body.error.code).toBe('deposit_out_of_range');
    const r = await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: body(cash(108000)) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('quote');
    first = r.body;
    const row = await find(first.docNo);
    expect(row).toMatchObject({ status: 'quote', unpriced: true, depositVnd: 108000 });
    expect(row.lines[0]).toMatchObject({ variantId: upcoming, unitPriceVnd: 120000, held: false });
    expect(row.lines[1]).toMatchObject({ freeText: true, title: 'Rare import ISBN 978-0-00-000000-1', variantId: null });
    const [m] = await h.t.sql`select direction, amount_vnd::int as amount from sales.cash_movement where reason = ${`Cọc ${first.docNo}`}`;
    expect(m).toMatchObject({ direction: 'in', amount: 108000 });
    // Found by scanning or typing a book's ISBN (FR-POS-09).
    await h.t.sql`update catalog.item_variant set isbn13 = '9786041234567' where id = ${upcoming}`;
    expect((await h.call('GET', '/api/v1/preorders?q=978-604-1-23456-7', { cookie: cashier })).body.items.map((x: { docNo: string }) => x.docNo)).toEqual([first.docNo]);
    const byTitle = (await h.call('GET', '/api/v1/preorders/by-title', { cookie: cashier })).body.items;
    expect(byTitle).toEqual(expect.arrayContaining([expect.objectContaining({ variantId: upcoming, qty: 2, slips: 1 }), expect.objectContaining({ variantId: null, title: 'Rare import ISBN 978-0-00-000000-1', qty: 1 })]));
    // Đang đặt hàng is set by hand by staff.
    expect((await h.call('POST', `/api/v1/preorders/${first.id}/status`, { cookie: cashier, body: { status: 'ordered' } })).body.status).toBe('ordered');
  });

  it('sets Chờ nhận by hand once every free-text book is linked; nothing comes from stock', async () => {
    second = (await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Nam', phone: '0911000002' }, lines: [{ variantId: upcoming, qty: 1 }], deposit: { method: 'transfer', amountVnd: 36000 } } })).body;
    expect(second).toMatchObject({ status: 'quote' });
    await stockIn(upcoming, 3);
    await stockIn(rare, 1);
    // Incoming stock changes no slip.
    expect((await find(first.docNo)).status).toBe('ordered');
    expect((await find(second.docNo)).status).toBe('quote');
    const freeLine = (await find(first.docNo)).lines[1].lineId;
    expect((await h.call('POST', `/api/v1/preorders/${first.id}/status`, { cookie: cashier, body: { status: 'arrived' } })).body.error.code).toBe('link_required');
    const ok = await h.call('POST', `/api/v1/preorders/${first.id}/status`, { cookie: cashier, body: { status: 'arrived', links: [{ lineId: freeLine, variantId: rare }] } });
    expect(ok.body, JSON.stringify(ok.body)).toMatchObject({ status: 'arrived' });
    // The linked book takes the product's selling price.
    expect((await find(first.docNo)).lines[1]).toMatchObject({ variantId: rare, unitPriceVnd: 120000, freeText: false });
    expect((await find(first.docNo)).totalVnd).toBe(360000);
    expect((await h.call('POST', `/api/v1/preorders/${second.id}/status`, { cookie: cashier, body: { status: 'arrived' } })).body.status).toBe('arrived');
    // Chờ nhận records Giao hàng with a note written by hand; back to Nhận tại quầy clears the note.
    await h.call('POST', `/api/v1/preorders/${second.id}/status`, { cookie: cashier, body: { status: 'arrived', delivery: true, deliveryNote: 'Ship 12 Lý Thường Kiệt, khách trả phí' } });
    expect(await find(second.docNo)).toMatchObject({ status: 'arrived', delivery: true, deliveryNote: 'Ship 12 Lý Thường Kiệt, khách trả phí' });
    await h.call('POST', `/api/v1/preorders/${second.id}/status`, { cookie: cashier, body: { status: 'arrived', delivery: false, deliveryNote: 'x' } });
    expect(await find(second.docNo)).toMatchObject({ delivery: false, deliveryNote: null });
    expect((await h.call('GET', '/api/v1/me/badges', { cookie: cashier })).body.preordersAction).toBe(2);
  });

  it('collects the whole slip at the POS at the agreed price, the deposit counted as paid', async () => {
    // A price rise after the quote does not change the agreed price.
    await h.t.sql`update catalog.item_variant set price_vnd = 150000 where id = ${upcoming}`;
    const mai = await customerId('+84911000001');
    const before = await level(upcoming);
    const body = (payments: unknown[], lines = [{ lineId: 'a', variantId: upcoming, qty: 2 }, { lineId: 'b', variantId: rare, qty: 1 }]) => ({ shiftId, preorderId: first.id, customerId: mai, lines, payments });
    expect((await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: body([{ method: 'cash', amountVnd: 1 }], [{ lineId: 'a', variantId: upcoming, qty: 2 }]) })).body.error.code).toBe('preorder_line');
    const sale = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: body([{ method: 'cash', amountVnd: 252000 }]) });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(sale.body.totalVnd).toBe(360000);
    const rec = (await h.call('GET', `/api/v1/pos/sales/${sale.body.id}`, { cookie: cashier })).body;
    expect(rec.payments.find((p: { method: string }) => p.method === 'deposit')).toMatchObject({ amountVnd: 108000, ref: first.docNo });
    // Nothing was held for the order: the copies are sold from stock.
    expect(await level(upcoming)).toEqual({ onHand: before.onHand - 2, reserved: before.reserved });
    expect(await find(first.docNo)).toMatchObject({ status: 'collected', saleId: sale.body.id });
    expect((await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: body([{ method: 'cash', amountVnd: 252000 }]) })).body.error.code).toBe('preorder_not_ready');
  });

  it("collects at today's promotion when it is cheaper than the agreed price", async () => {
    const promo = await h.call('POST', '/api/v1/promotions', { cookie: owner, body: { name: 'Giảm 25%', rule: { type: 'percent', percentBp: 2500, scope: { kind: 'product', variantIds: [upcoming] } }, startsAt: '2026-01-01T00:00:00.000Z' } });
    expect(promo.status, JSON.stringify(promo.body)).toBe(201);
    const nam = await customerId('+84911000002');
    // Today: 150 000 less 25 % = 112 500, under the agreed 120 000; the deposit 36 000 counts as paid.
    const sale = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: { shiftId, preorderId: second.id, customerId: nam, lines: [{ lineId: 'a', variantId: upcoming, qty: 1 }], payments: [{ method: 'cash', amountVnd: 76500 }] } });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(sale.body.totalVnd).toBe(112500);
    await h.call('POST', `/api/v1/promotions/${promo.body.id}/pause`, { cookie: owner });
  });

  it('collects a slip paid in full by its deposit, and hands back the difference when the price fell below it', async () => {
    await stockIn(other, 2);
    const hold = async (name: string, phone: string) => {
      const r = await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name, phone }, lines: [{ variantId: other, qty: 1 }], deposit: { method: 'transfer', amountVnd: 120000 } } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body as { id: string; docNo: string };
    };
    const collect = async (slip: { id: string }, phone: string) =>
      h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: { shiftId, preorderId: slip.id, customerId: await customerId(phone), lines: [{ lineId: 'a', variantId: other, qty: 1 }], payments: [] } });
    // Deposit equals the price: nothing more to pay.
    const full = await hold('Hà', '0911000011');
    const paidUp = await collect(full, '+84911000011');
    expect(paidUp.status, JSON.stringify(paidUp.body)).toBe(201);
    expect(paidUp.body).toMatchObject({ totalVnd: 120000, depositRefundVnd: 0 });
    // Today's promotion makes it cheaper than the deposit: the difference goes back in cash (FR-POS-09).
    const over = await hold('Minh', '0911000012');
    const promo = await h.call('POST', '/api/v1/promotions', { cookie: owner, body: { name: 'Giảm 25% backlist', rule: { type: 'percent', percentBp: 2500, scope: { kind: 'product', variantIds: [other] } }, startsAt: '2026-01-01T00:00:00.000Z' } });
    expect(promo.status, JSON.stringify(promo.body)).toBe(201);
    const refunded = await collect(over, '+84911000012');
    expect(refunded.status, JSON.stringify(refunded.body)).toBe(201);
    expect(refunded.body).toMatchObject({ totalVnd: 90000, depositRefundVnd: 30000 });
    const rec = (await h.call('GET', `/api/v1/pos/sales/${refunded.body.id}`, { cookie: cashier })).body;
    expect(rec.payments).toEqual([expect.objectContaining({ method: 'deposit', amountVnd: 90000, ref: over.docNo })]);
    const [m] = await h.t.sql`select direction, amount_vnd::int as amount from sales.cash_movement where reason = ${`Hoàn chênh cọc ${over.docNo}`}`;
    expect(m).toMatchObject({ direction: 'out', amount: 30000 });
    await h.call('POST', `/api/v1/promotions/${promo.body.id}/pause`, { cookie: owner });
  });

  it('never mixes books on the shelf and books to order on one slip; an order is cancelled with its deposit refunded', async () => {
    const mixed = await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Quang', phone: '0911000004' }, lines: [{ variantId: other, qty: 1 }, { variantId: rare, qty: 1 }] } });
    expect(mixed.body.error.code).toBe('mixed_slip');
    quang = (await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Quang', phone: '0911000004' }, lines: [{ variantId: other, qty: 1 }] } })).body;
    expect((await find(quang.docNo)).status).toBe('contacted');
    // A hold is Chờ nhận already: Giao hàng is recorded and it stays Contacted.
    expect((await h.call('POST', `/api/v1/preorders/${quang.id}/status`, { cookie: cashier, body: { status: 'arrived', delivery: true, deliveryNote: 'Grab' } })).body).toMatchObject({ status: 'contacted', delivery: true });
    // Slips are never edited.
    expect((await h.call('PUT', `/api/v1/preorders/${quang.id}/lines`, { cookie: cashier, body: { lines: [{ variantId: other, qty: 2 }] } })).status).toBe(404);
    const order = (await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Quang', phone: '0911000004' }, lines: [{ variantId: rare, qty: 1 }], deposit: { method: 'transfer', amountVnd: 120000 } } })).body;
    expect(order.status).toBe('quote');
    const c = await h.call('POST', `/api/v1/preorders/${order.id}/cancel`, { cookie: owner, body: { reason: 'Khách đổi ý', deposit: 'refund', refundRef: 'FT123' } });
    expect(c.body).toMatchObject({ status: 'cancelled', depositOutcome: 'refund' });
  });

  it('expires holds without a deposit by themselves and alerts managers about slips with one (FR-ORD-16)', async () => {
    await stockIn(other, 1);
    const ha = (await h.call('POST', '/api/v1/preorders', { cookie: cashier, body: { customer: { name: 'Hà', phone: '0911000005' }, lines: [{ variantId: other, qty: 1 }], deposit: cash(10000) } })).body;
    expect(ha.status).toBe('contacted');
    h.clock.advance(8 * 86_400_000);
    const open = await h.t.sql`select doc_no, status, deposit_vnd::int as dep from orders.preorder where status not in ('collected', 'cancelled')`;
    expect(open.map((r) => r.doc_no).sort(), JSON.stringify(open)).toEqual([ha.docNo, quang.docNo].sort());
    expect(await orders.expireHolds(h.ctx())).toEqual({ cancelled: 1, alerted: 1 });
    expect(await orders.expireHolds(h.ctx())).toEqual({ cancelled: 0, alerted: 0 });
    cashier = await h.login('thu', 'mat-khau-moi-456');
    owner = await h.login('lan', OWNER_PW);
    expect(await find(quang.docNo)).toMatchObject({ status: 'cancelled' });
    // A slip with a deposit needs a manager to cancel, who keeps or refunds it.
    expect((await h.call('POST', `/api/v1/preorders/${ha.id}/cancel`, { cookie: cashier, body: { reason: 'Khách không đến', deposit: 'forfeit' } })).body.error.code).toBe('manager_required');
    expect((await h.call('POST', `/api/v1/preorders/${ha.id}/cancel`, { cookie: owner, body: { reason: 'Khách không đến', deposit: 'forfeit' } })).body).toMatchObject({ status: 'cancelled', depositOutcome: 'forfeit' });
  });
});

describe('new slip notification (FR-ADM-08, TDD §4.12)', () => {
  const created = async (cookie: string, docNo: string) =>
    ((await h.call('GET', '/api/v1/notifications', { cookie })).body.items as { template: string; vars: Record<string, unknown> }[]).filter(
      (n) => n.template === 'preorder.created' && n.vars.docNo === docNo,
    );
  const slip = (cookie: string, phone: string) =>
    h.call('POST', '/api/v1/preorders', { cookie, body: { customer: { name: 'Mai Chi', phone }, lines: [{ title: 'Sách chưa có trong kho', qty: 1 }] } });

  it('every new slip tells the pre-order staff, except the one who took it', async () => {
    const roles = (await h.call('GET', '/api/v1/admin/roles', { cookie: owner })).body.items as { code: string; id: string }[];
    const manager = await h.staff(owner, 'quanly', roles.find((r) => r.code === 'manager')!.id);

    const byCashier = await slip(cashier, '0911000777');
    expect(byCashier.status, JSON.stringify(byCashier.body)).toBe(201);
    expect(await created(owner, byCashier.body.docNo)).toEqual([expect.objectContaining({ vars: expect.objectContaining({ id: byCashier.body.id, customerName: 'Mai Chi' }) })]);
    expect(await created(manager, byCashier.body.docNo)).toHaveLength(1);
    expect(await created(cashier, byCashier.body.docNo)).toEqual([]);

    const byManager = await slip(manager, '0911000778');
    expect(byManager.status, JSON.stringify(byManager.body)).toBe(201);
    expect(await created(owner, byManager.body.docNo)).toHaveLength(1);
    expect(await created(manager, byManager.body.docNo)).toEqual([]);
  });
});
