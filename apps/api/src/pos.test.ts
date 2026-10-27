import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PW, startHarness, type Harness } from './testing.js';

/** POS end to end (FR-POS-01..22, UC-01..03, UC-20). */
let h: Harness;
let owner: string;
let roles: Record<string, string>;
let cashier: string;
let manager: string;
let registerId: string;
let shiftId: string;
let book: string;
let pen: string;
let customerId: string;
let firstSale: { id: string; docNo: string };

const MANAGER_PIN = '112233';

beforeAll(async () => {
  h = await startHarness();
  ({ owner, roles } = await h.setupOwner());
  cashier = await h.staff(owner, 'thu', roles.cashier!);
  manager = await h.staff(owner, 'quanly', roles.manager!, MANAGER_PIN);

  const cat = (await h.call('POST', '/api/v1/catalog/categories', { cookie: owner, body: { i18n: { en: { name: 'Books' } } } })).body.id;
  const supplier = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Fahasa', phone: '0900000000' } })).body.id;
  const consignor = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Kim Đồng', phone: '0900000000', isConsignor: true } })).body.id;
  const mk = async (sku: string, title: string, price: number, vatBp: number, qty: number) => {
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', {
      cookie: owner,
      body: {
        supplierId: supplier,
        line: {
          item: { kind: 'book', i18n: { en: { title, description: title } }, categoryIds: [cat] },
          variant: { sku, weightG: 200, vatBp },
          imageFileIds: ['00000000-0000-7000-8000-00000000000a'],
          costVnd: Math.round(price / 2),
          sellingPriceVnd: price,
          qty,
        },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.lines[0].variantId as string;
  };
  book = await mk('SACH-0001', 'Cho toi xin mot ve', 98000, 0, 10);
  pen = await mk('VPP-0012', 'Blue pen', 6000, 1000, 100);
  // Consignment units of the book (sold first, FIFO by lot).
  const c = await h.call('POST', '/api/v1/purchasing/stock-in/existing', {
    cookie: owner,
    body: { supplierId: consignor, consignment: true, consignmentDiscountBp: 3000, line: { variantId: book, costVnd: 68600, sellingPriceVnd: 98000, qty: 2 } },
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  registerId = (await h.call('GET', '/api/v1/pos/registers', { cookie: cashier })).body.items[0].id;
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

const cart = (lines: { variantId: string; qty: number; [k: string]: unknown }[], extra: Record<string, unknown> = {}) => ({
  lines: lines.map((l, i) => ({ lineId: `l${i}`, ...l })),
  ...extra,
});

async function approve(action: string, subject?: string) {
  const r = await h.call('POST', '/api/v1/auth/approve', { cookie: cashier, body: { approverUsername: 'quanly', pin: MANAGER_PIN, action, ...(subject && { subject }) } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.approvalToken as string;
}

describe('shift open (FR-POS-18)', () => {
  it('the wizard created register Q1; one open shift per register', async () => {
    const regs = (await h.call('GET', '/api/v1/pos/registers', { cookie: cashier })).body.items;
    expect(regs.map((r: { code: string }) => r.code)).toEqual(['Q1']);
    const r = await h.call('POST', '/api/v1/pos/shifts/open', { cookie: cashier, body: { registerId, floatVnd: 1000000 } });
    expect(r.status).toBe(201);
    shiftId = r.body.id;
    expect((await h.call('POST', '/api/v1/pos/shifts/open', { cookie: cashier, body: { registerId, floatVnd: 0 } })).body.error.code).toBe('shift_already_open');
    expect((await h.call('GET', `/api/v1/pos/shifts/current?register=${registerId}`, { cookie: cashier })).body.shift.id).toBe(shiftId);
  });
});

describe('pricing with promotions (FR-POS-05, FR-PRM)', () => {
  it('applies a buy-2-get-1 promotion automatically', async () => {
    const plain = await h.call('POST', '/api/v1/pos/price', { cookie: cashier, body: cart([{ variantId: book, qty: 1 }, { variantId: pen, qty: 3 }]) });
    expect(plain.body.totalVnd).toBe(116000);
    const p = await h.call('POST', '/api/v1/promotions', {
      cookie: owner,
      body: { name: 'Mua 2 tặng 1 bút', rule: { type: 'buy_x_get_y', buyQty: 2, getQty: 1, scope: { kind: 'product', variantIds: [pen] } }, startsAt: h.clock.now().toISOString() },
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const promo = await h.call('POST', '/api/v1/pos/price', { cookie: cashier, body: cart([{ variantId: book, qty: 1 }, { variantId: pen, qty: 3 }]) });
    expect(promo.body.totalVnd).toBe(110000);
    expect(promo.body.lines[1].savings[0]).toMatchObject({ label: 'Mua 2 tặng 1 bút', amountVnd: 6000 });
  });
});

describe('customers (FR-CRM-01, BR-16)', () => {
  it('creates a customer once per phone', async () => {
    const r = await h.call('POST', '/api/v1/customers', { cookie: cashier, body: { name: 'Trần Thị B', phone: '0912 345 678' } });
    expect(r.status).toBe(201);
    customerId = r.body.id;
    const dupe = await h.call('POST', '/api/v1/customers', { cookie: cashier, body: { name: 'B', phone: '+84912345678' } });
    expect(dupe.body.error).toMatchObject({ code: 'duplicate_phone', details: { customerId } });
    const found = await h.call('GET', '/api/v1/customers?phone=84912345678', { cookie: cashier });
    expect(found.body.items[0]).toMatchObject({ id: customerId, tierCode: 'standard' });
    expect((await h.call('GET', '/api/v1/customers?q=tran thi', { cookie: cashier })).body.items).toHaveLength(1);
  });
});

describe('completing a sale (FR-POS-06, UC-01)', () => {
  it('records sale, stock, points, e-invoice job; returns change', async () => {
    const body = { ...cart([{ variantId: book, qty: 1 }, { variantId: pen, qty: 3 }], { customerId }), shiftId, payments: [{ method: 'cash', amountVnd: 110000, tenderedVnd: 200000 }] };
    const r = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ docNo: 'HD-2026-00001', totalVnd: 110000, changeVnd: 90000, pointsEarned: 11, einvoiceStatus: 'pending', printSlip: false });
    firstSale = r.body;
    const detail = await h.call('GET', `/api/v1/catalog/items/${(await h.t.sql`select item_id from catalog.item_variant where id = ${book}`)[0]!.item_id}`, { cookie: owner });
    expect(detail.body.variants[0].stock.onHand).toBe(11);
    expect((await h.call('GET', `/api/v1/customers/${customerId}`, { cookie: cashier })).body.pointsBalance).toBe(11);
    // The consignment lot took the sold unit first (TDD §4.3).
    const [lot] = await h.t.sql`select qty_sold from purchasing.consignment_lot where variant_id = ${book}`;
    expect(lot!.qty_sold).toBe(1);
  });

  it('is idempotent on the Idempotency-Key (TDD §6.1)', async () => {
    const body = { ...cart([{ variantId: pen, qty: 1 }]), shiftId, payments: [{ method: 'card', amountVnd: 6000, ref: 'APPR-77' }] };
    const call = (b: unknown) =>
      h.app.request('/api/v1/pos/sales', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'x-bms-request': '1', 'content-type': 'application/json', cookie: cashier, 'idempotency-key': 'k-1' },
        body: JSON.stringify(b),
      });
    const a = (await (await call(body)).json()) as { docNo: string };
    const b = (await (await call(body)).json()) as { docNo: string };
    expect(b.docNo).toBe(a.docNo);
    const c = (await (await call({ ...body, payments: [{ method: 'card', amountVnd: 6000, ref: 'OTHER' }] })).json()) as { error: { code: string } };
    expect(c.error.code).toBe('idempotency_key_reused');
    const [n] = await h.t.sql`select count(*)::int as n from sales.sale`;
    expect(n!.n).toBe(2);
  });

  it('validates payments: sum, card approval code, transfer reference', async () => {
    const base = { ...cart([{ variantId: pen, qty: 1 }]), shiftId };
    expect((await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: { ...base, payments: [{ method: 'cash', amountVnd: 5000 }] } })).body.error.code).toBe('payment_mismatch');
    expect((await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: { ...base, payments: [{ method: 'card', amountVnd: 6000, ref: '' }] } })).status).toBe(400);
    expect((await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: { ...base, payments: [{ method: 'transfer', amountVnd: 6000, ref: 'O0I1' }] } })).status).toBe(400);
    const split = await h.call('POST', '/api/v1/pos/sales', {
      cookie: cashier,
      body: { ...base, payments: [{ method: 'cash', amountVnd: 2000 }, { method: 'transfer', amountVnd: 4000, ref: 'k7m2 x9pq' }] },
    });
    expect(split.status, JSON.stringify(split.body)).toBe(201);
  });

  it('needs a supervisor above the cashier discount limit (BR-05, FR-ADM-09)', async () => {
    const lines = cart([{ variantId: book, qty: 1, manualDiscount: { kind: 'percent', bp: 1500 } }]);
    const body = { ...lines, shiftId, payments: [{ method: 'cash', amountVnd: 83300 }] };
    const denied = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body });
    expect(denied.body.error).toMatchObject({ code: 'approval_required', details: { action: 'discount_over_limit', limitBp: 1000 } });
    const ok = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: { ...body, approvals: { discount_over_limit: await approve('discount_over_limit') } } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const [s] = await h.t.sql`select approved_by from sales.sale where id = ${ok.body.id}`;
    expect(s!.approved_by).toBeTruthy();
  });

  it('redeems points as a discount (BR-07)', async () => {
    // Earn enough first: 5 books = 490.000 ₫ → 49 points, balance 60.
    const earn = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: { ...cart([{ variantId: book, qty: 5 }], { customerId }), shiftId, payments: [{ method: 'cash', amountVnd: 490000 }] } });
    expect(earn.body.pointsEarned).toBe(49);
    const r = await h.call('POST', '/api/v1/pos/sales', {
      cookie: cashier,
      body: { ...cart([{ variantId: book, qty: 1 }], { customerId, redeemPoints: 50 }), shiftId, payments: [{ method: 'cash', amountVnd: 93000 }] },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ totalVnd: 93000, discountVnd: 5000, pointsRedeemed: 50, pointsEarned: 9 });
    expect((await h.call('GET', `/api/v1/customers/${customerId}`, { cookie: cashier })).body.pointsBalance).toBe(60 - 50 + 9);
  });
});

describe('returns (FR-POS-12, FR-POS-13, BR-04)', () => {
  it('refunds within the window, restocks and reverses points proportionally', async () => {
    const sale = (await h.call('GET', `/api/v1/pos/sales/${firstSale.id}`, { cookie: cashier })).body;
    const bookLine = sale.lines.find((l: { sku: string }) => l.sku === 'SACH-0001');
    const r = await h.call('POST', `/api/v1/pos/sales/${firstSale.id}/returns`, {
      cookie: cashier,
      body: { shiftId, lines: [{ saleLineId: bookLine.id, qty: 1, restock: true }], refundMethod: 'cash' },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ docNo: 'TH-2026-00001', refundVnd: 98000, pointsReversed: 10 });
    const again = await h.call('POST', `/api/v1/pos/sales/${firstSale.id}/returns`, {
      cookie: cashier,
      body: { shiftId, lines: [{ saleLineId: bookLine.id, qty: 1, restock: true }], refundMethod: 'cash' },
    });
    expect(again.body.error.code).toBe('return_exceeds_sold');
    const wrongMethod = await h.call('POST', `/api/v1/pos/sales/${firstSale.id}/returns`, {
      cookie: cashier,
      body: { shiftId, lines: [{ saleLineId: sale.lines[1].id, qty: 1, restock: true }], refundMethod: 'card' },
    });
    expect(wrongMethod.body.error.code).toBe('refund_method_mismatch');
    // Both consignment units had been sold (this sale and the discount sale); the returned one goes back to its lot.
    const [lot] = await h.t.sql`select qty_sold from purchasing.consignment_lot where variant_id = ${book}`;
    expect(lot!.qty_sold).toBe(1);
  });

  it('needs approval outside the return window', async () => {
    h.clock.advance(8 * 86_400_000);
    cashier = await h.login('thu', 'mat-khau-moi-456');
    const sale = (await h.call('GET', `/api/v1/pos/sales/${firstSale.id}`, { cookie: cashier })).body;
    const penLine = sale.lines.find((l: { sku: string }) => l.sku === 'VPP-0012');
    const body = { shiftId, lines: [{ saleLineId: penLine.id, qty: 1, restock: false }], refundMethod: 'cash' };
    const denied = await h.call('POST', `/api/v1/pos/sales/${firstSale.id}/returns`, { cookie: cashier, body });
    expect(denied.body.error.code).toBe('approval_required');
    manager = await h.login('quanly', 'mat-khau-moi-456');
    const ok = await h.call('POST', `/api/v1/pos/sales/${firstSale.id}/returns`, {
      cookie: cashier,
      body: { ...body, approvalToken: await approve('return_exception', firstSale.id) },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    // Damaged/not restocked: stock unchanged; refund is a share of the promoted pen line (3 for 12.000 ₫).
    expect(ok.body.refundVnd).toBe(4000);
  });
});

describe('void (FR-POS-14)', () => {
  it('needs approval, restores stock and points, and cannot repeat', async () => {
    const sale = await h.call('POST', '/api/v1/pos/sales', {
      cookie: cashier,
      body: { ...cart([{ variantId: book, qty: 2 }], { customerId }), shiftId, payments: [{ method: 'cash', amountVnd: 196000 }] },
    });
    const before = (await h.call('GET', `/api/v1/customers/${customerId}`, { cookie: cashier })).body.pointsBalance;
    const denied = await h.call('POST', `/api/v1/pos/sales/${sale.body.id}/void`, { cookie: cashier, body: { reason: 'Khách đổi ý', shiftId } });
    expect(denied.body.error.code).toBe('approval_required');
    const ok = await h.call('POST', `/api/v1/pos/sales/${sale.body.id}/void`, {
      cookie: cashier,
      body: { reason: 'Khách đổi ý', shiftId, approvalToken: await approve('void_sale', sale.body.id) },
    });
    expect(ok.body.status).toBe('voided');
    expect((await h.call('GET', `/api/v1/customers/${customerId}`, { cookie: cashier })).body.pointsBalance).toBe(before - 19);
    const [ej] = await h.t.sql`select status from sales.einvoice_job where sale_id = ${sale.body.id}`;
    expect(ej!.status).toBe('cancelled');
    expect((await h.call('POST', `/api/v1/pos/sales/${sale.body.id}/void`, { cookie: manager, body: { reason: 'x', shiftId } })).body.error.code).toBe('sale_not_completed');
    const audit = (await h.call('GET', `/api/v1/admin/audit?entity=sale&entityId=${sale.body.id}`, { cookie: await h.login('lan', OWNER_PW) })).body.items;
    expect(audit[0]).toMatchObject({ action: 'sale.void', after: { reason: 'Khách đổi ý' } });
  });
});

describe('no store credit (FR-CRM-10 withdrawn)', () => {
  it('rejects store credit as a payment or a refund and has no adjustment endpoint', async () => {
    const pay = await h.call('POST', '/api/v1/pos/sales', {
      cookie: cashier,
      body: { ...cart([{ variantId: pen, qty: 1 }], { customerId }), shiftId, payments: [{ method: 'store_credit', amountVnd: 6000 }] },
    });
    expect(pay.status).toBe(400);
    const line = (await h.call('GET', `/api/v1/pos/sales/${firstSale.id}`, { cookie: cashier })).body.lines[0];
    const ret = await h.call('POST', `/api/v1/pos/sales/${firstSale.id}/returns`, {
      cookie: cashier,
      body: { shiftId, lines: [{ saleLineId: line.id, qty: 1, restock: true }], refundMethod: 'store_credit' },
    });
    expect(ret.status).toBe(400);
    expect((await h.call('POST', `/api/v1/customers/${customerId}/store-credit-adjust`, { cookie: manager, body: { deltaVnd: 1000, reason: 'x' } })).status).toBe(404);
    const profile = (await h.call('GET', `/api/v1/customers/${customerId}`, { cookie: cashier })).body;
    expect(Object.keys(profile)).not.toContain('storeCreditLedger');
    expect(Object.keys(profile)).not.toContain('storeCreditVnd');
  });
});

describe('e-invoice on request (FR-POS-16, FR-POS-17)', () => {
  it('stores buyer details and only retries failed invoices', async () => {
    const r = await h.call('POST', `/api/v1/pos/sales/${firstSale.id}/einvoice-request`, {
      cookie: cashier,
      body: { name: 'Công ty ABC', taxCode: '0101234567', address: 'Hà Nội', email: 'ketoan@abc.vn' },
    });
    expect(r.body).toEqual({ saleId: firstSale.id, status: 'pending', emailRequested: true });
    expect((await h.call('POST', `/api/v1/pos/sales/${firstSale.id}/einvoice/retry`, { cookie: manager })).body.error.code).toBe('einvoice_not_failed');
    await h.t.sql`update sales.einvoice_job set status = 'failed', error = 'MISA unreachable' where sale_id = ${firstSale.id}`;
    const failed = (await h.call('GET', '/api/v1/pos/einvoices?status=failed', { cookie: manager })).body.items;
    expect(failed).toHaveLength(1);
    expect((await h.call('POST', `/api/v1/pos/sales/${firstSale.id}/einvoice/retry`, { cookie: manager })).body.status).toBe('pending');
    expect((await h.call('GET', '/api/v1/pos/einvoices', { cookie: cashier })).status).toBe(403);
  });
});

describe('held carts (FR-POS-03) and sales list (FR-POS-21)', () => {
  it('holds and recalls a cart', async () => {
    const held = await h.call('POST', '/api/v1/pos/held-carts', { cookie: cashier, body: { registerId, label: 'Khách áo xanh', payload: { lines: [{ variantId: pen, qty: 2 }] } } });
    expect((await h.call('GET', `/api/v1/pos/held-carts?register=${registerId}`, { cookie: cashier })).body.items).toHaveLength(1);
    const recalled = await h.call('DELETE', `/api/v1/pos/held-carts/${held.body.id}`, { cookie: cashier });
    expect(recalled.body.payload.lines[0].qty).toBe(2);
    expect((await h.call('GET', `/api/v1/pos/held-carts?register=${registerId}`, { cookie: cashier })).body.items).toHaveLength(0);
  });

  it('finds sales by phone and item; cashiers see only their own', async () => {
    const byPhone = await h.call('GET', '/api/v1/pos/sales?q=0912345678', { cookie: manager });
    expect(byPhone.body.items.length).toBeGreaterThanOrEqual(3);
    const bySku = await h.call('GET', '/api/v1/pos/sales?q=VPP-0012', { cookie: manager });
    expect(bySku.body.items.map((s: { docNo: string }) => s.docNo)).toContain(firstSale.docNo);
    // Customer list: purchase stats and filters (FR-CRM-02).
    const [cust] = (await h.call('GET', '/api/v1/customers?q=0912345678', { cookie: manager })).body.items;
    expect(cust.orders).toBeGreaterThanOrEqual(3);
    expect(cust.ordersVnd).toBeGreaterThan(0);
    expect(cust.lastPurchaseAt).toBeTruthy();
    const ids = async (qs: string) => (await h.call('GET', `/api/v1/customers?${qs}`, { cookie: manager })).body.items.map((c: { id: string }) => c.id);
    expect(await ids('orders=3%2B&lastPurchase=30d')).toContain(cust.id);
    expect(await ids('orders=0')).not.toContain(cust.id);
    expect(await ids('lastPurchase=never')).not.toContain(cust.id);
    expect(await ids(`tier=${cust.tierCode}&points=0,1%2B`)).toContain(cust.id);
    expect((await h.call('GET', '/api/v1/customers?orders=abc', { cookie: manager })).status).toBe(400);
    // Several values in one filter combine with OR (TDD §6.2).
    const all = (await h.call('GET', '/api/v1/pos/sales', { cookie: manager })).body.items.length;
    expect((await h.call('GET', '/api/v1/pos/sales?status=completed,voided', { cookie: manager })).body.items).toHaveLength(all);
    const cashOrCard = (await h.call('GET', '/api/v1/pos/sales?method=cash,card', { cookie: manager })).body.items as { methods: string[] }[];
    expect(cashOrCard.every((s) => s.methods.some((m) => m === 'cash' || m === 'card'))).toBe(true);
    expect((await h.call('GET', '/api/v1/pos/sales?method=cash,bitcoin', { cookie: manager })).status).toBe(400);
    const managerSale = await h.call('POST', '/api/v1/pos/sales', { cookie: manager, body: { ...cart([{ variantId: pen, qty: 1 }]), shiftId, payments: [{ method: 'cash', amountVnd: 6000 }] } });
    const mine = (await h.call('GET', '/api/v1/pos/sales', { cookie: cashier })).body.items.map((s: { id: string }) => s.id);
    expect(mine).not.toContain(managerSale.body.id);
    expect((await h.call('GET', `/api/v1/pos/sales/${managerSale.body.id}`, { cookie: cashier })).status).toBe(403);
  });
});

describe('shift history filters (FR-POS-22)', () => {
  it('searches by shift number or cashier and filters by register and day', async () => {
    const ids = async (qs: string) => (await h.call('GET', `/api/v1/pos/shifts?${qs}`, { cookie: manager })).body.items.map((s: { id: string }) => s.id);
    const [mine] = (await h.call('GET', '/api/v1/pos/shifts', { cookie: manager })).body.items.filter((s: { id: string }) => s.id === shiftId);
    expect(await ids(`q=%23${mine.shiftNo}`)).toEqual([shiftId]);
    expect(await ids(`q=${encodeURIComponent(mine.openedBy.toLowerCase())}`)).toContain(shiftId);
    expect(await ids(`register=${registerId}`)).toContain(shiftId);
    expect(await ids('register=00000000-0000-7000-8000-000000000000')).toEqual([]);
    const opened = new Date(mine.openedAt);
    expect(await ids(`from=${new Date(opened.getTime() + 86_400_000).toISOString()}`)).not.toContain(shiftId);
  });
});

describe('shift close (FR-POS-19, BR-06, UC-03)', () => {
  it('needs a reason for a variance, never blocks, and alerts managers above the threshold', async () => {
    const report = (await h.call('GET', `/api/v1/pos/shifts/${shiftId}`, { cookie: cashier })).body;
    const expected = report.cash.expectedVnd;
    // Float 1.000.000 + cash sales − cash refunds (98.000 + the 4.000 out-of-window return); the voided sale is excluded.
    expect(report.cash.cashRefundsVnd).toBe(102000);
    const noReason = await h.call('POST', '/api/v1/pos/shifts/close', { cookie: cashier, body: { shiftId, countedVnd: expected - 80000 } });
    expect(noReason.body.error).toMatchObject({ code: 'variance_reason_required', details: { varianceVnd: -80000 } });
    const closed = await h.call('POST', '/api/v1/pos/shifts/close', { cookie: cashier, body: { shiftId, countedVnd: expected - 80000, varianceReason: 'Thối nhầm cho khách' } });
    expect(closed.body).toMatchObject({ varianceVnd: -80000, alert: true });

    const forManager = (await h.call('GET', '/api/v1/notifications', { cookie: manager })).body;
    expect(forManager.items[0]).toMatchObject({ template: 'shift.variance_exceeded', vars: { varianceVnd: -80000 } });
    expect((await h.call('GET', '/api/v1/notifications', { cookie: cashier })).body.items).toHaveLength(0);
    const history = (await h.call('GET', '/api/v1/pos/shifts', { cookie: manager })).body.items;
    expect(history[0]).toMatchObject({ varianceVnd: -80000, varianceReason: 'Thối nhầm cho khách', openedBy: 'thu' });
    expect((await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: { ...cart([{ variantId: pen, qty: 1 }]), shiftId, payments: [{ method: 'cash', amountVnd: 6000 }] } })).body.error.code).toBe(
      'shift_closed',
    );
  });
});

describe('ledgers stay consistent (TDD §5.4 nightly invariants)', () => {
  it('stock and points balances equal their ledgers', async () => {
    const stock = await h.t.sql`
      select s.variant_id from inventory.stock_level s
      where s.on_hand <> (select coalesce(sum(qty_delta), 0) from inventory.stock_movement m where m.variant_id = s.variant_id and m.location = s.location)`;
    expect(stock).toHaveLength(0);
    const points = await h.t.sql`
      select c.id from crm.customer c where c.points_balance <> (select coalesce(sum(delta), 0) from crm.points_ledger l where l.customer_id = c.id)`;
    expect(points).toHaveLength(0);
  });
});
