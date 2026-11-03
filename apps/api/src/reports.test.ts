import { readTable } from '@bookstore/modules/imports';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './testing.js';

/**
 * Reports on a small, hand-checkable data set (FR-RPT-01..05, FR-RPT-10, TDD §4.11):
 * today (25/10/2026, store time) sale 1 = 2 books + 1 pen, cash, customer A;
 * sale 2 = 2 pens, card, no customer; sale 3 voided; one book of sale 1 returned in cash.
 */
let h: Harness;
let owner: string;
let manager: string;
let cashier: string;
let viewer: string;
let roles: Record<string, string>;
let book: string;
let pen: string;
const TODAY = '2026-10-25';

beforeAll(async () => {
  h = await startHarness();
  ({ owner, roles } = await h.setupOwner());
  manager = await h.staff(owner, 'quanly', roles.manager!, '112233');
  cashier = await h.staff(owner, 'thu', roles.cashier!);
  // A role that sees reports but not profit or cost.
  const viewerRole = await h.call('POST', '/api/v1/admin/roles', { cookie: owner, body: { name: 'Xem báo cáo', permissions: ['report.view'] } });
  viewer = await h.staff(owner, 'xem', viewerRole.body.id);

  const cat = (await h.call('POST', '/api/v1/catalog/categories', { cookie: owner, body: { i18n: { en: { name: 'Books' } } } })).body.id;
  const supplier = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Fahasa', phone: '0900000000' } })).body.id;
  const mk = async (sku: string, price: number, cost: number, vatBp: number, qty: number, minStock: number | null = null) => {
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', {
      cookie: owner,
      body: {
        supplierId: supplier,
        line: {
          item: { kind: 'book', i18n: { en: { title: sku, description: sku } }, categoryIds: [cat] },
          variant: { sku, weightG: 100, vatBp, minStock },
          imageFileIds: ['00000000-0000-7000-8000-00000000000a'],
          costVnd: cost,
          sellingPriceVnd: price,
          qty,
        },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.lines[0].variantId as string;
  };
  book = await mk('BOOK', 100000, 50000, 0, 10, 20);
  pen = await mk('PEN', 11000, 5000, 1000, 50);
  await mk('NEVER-SOLD', 30000, 10000, 0, 4);

  const registerId = (await h.call('GET', '/api/v1/pos/registers', { cookie: cashier })).body.items[0].id;
  const shiftId = (await h.call('POST', '/api/v1/pos/shifts/open', { cookie: cashier, body: { registerId, floatVnd: 500000 } })).body.id;
  const customerId = (await h.call('POST', '/api/v1/customers', { cookie: cashier, body: { name: 'Khách A', phone: '0901234567' } })).body.id;
  const sell = async (lines: [string, number][], payments: unknown[], extra: Record<string, unknown> = {}) => {
    const r = await h.call('POST', '/api/v1/pos/sales', {
      cookie: cashier,
      body: { lines: lines.map(([variantId, qty], i) => ({ lineId: `l${i}`, variantId, qty })), shiftId, payments, ...extra },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  const s1 = await sell([[book, 2], [pen, 1]], [{ method: 'cash', amountVnd: 211000 }], { customerId });
  await sell([[pen, 2]], [{ method: 'card', amountVnd: 22000, ref: 'A1' }]);
  const s3 = await sell([[book, 1]], [{ method: 'cash', amountVnd: 100000 }]);
  await h.call('POST', `/api/v1/pos/sales/${s3}/void`, { cookie: manager, body: { reason: 'Nhầm', shiftId } });
  const bookLine = (await h.call('GET', `/api/v1/pos/sales/${s1}`, { cookie: cashier })).body.lines.find((l: { sku: string }) => l.sku === 'BOOK');
  const ret = await h.call('POST', `/api/v1/pos/sales/${s1}/returns`, {
    cookie: cashier,
    body: { shiftId, lines: [{ saleLineId: bookLine.id, qty: 1, restock: true }], refundMethod: 'cash' },
  });
  expect(ret.status, JSON.stringify(ret.body)).toBe(201);
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

const get = (path: string, cookie: string) => h.call('GET', path, { cookie });
const range = `from=${TODAY}&to=${TODAY}`;
const rowOf = (rows: { key: string }[], key: string) => rows.find((r) => r.key === key) as Record<string, unknown>;

describe('dashboard (FR-RPT-01)', () => {
  it('shows today’s figures, bestsellers and low stock — no alert tiles', async () => {
    const d = (await get('/api/v1/reports/dashboard', manager)).body;
    expect(d.today).toEqual({ grossVnd: 233000, returnsVnd: 100000, netVnd: 133000, orders: 2, averageBasketVnd: 116500 });
    expect(Object.keys(d)).not.toContain('week');
    expect(d.bestsellers[0]).toMatchObject({ sku: 'PEN', units: 3 });
    expect(d.lowStock.map((l: { sku: string }) => l.sku)).toEqual(['BOOK']);
    expect(Object.keys(d)).not.toContain('failedEinvoices');
    expect((await get('/api/v1/reports/dashboard', cashier)).status).toBe(403);
  });
});

describe('sales report (FR-RPT-02)', () => {
  it('groups by item with VAT, returns, net and margin (profit permission)', async () => {
    const r = (await get(`/api/v1/reports/sales?${range}&groupBy=item`, manager)).body;
    const b = rowOf(r.rows, 'BOOK');
    expect(r.columns.slice(0, 2).map((c: { label: string }) => c.label)).toEqual(['SKU', 'Tên sản phẩm']);
    expect(b).toMatchObject({ title: 'BOOK' });
    expect(b).toMatchObject({ units: 2, grossVnd: 200000, vatVnd: 0, returnsVnd: 100000, netVnd: 100000, costVnd: 100000, marginVnd: 100000 });
    const p = rowOf(r.rows, 'PEN');
    expect(p).toMatchObject({ units: 3, grossVnd: 33000, vatVnd: 3000, costVnd: 15000, marginVnd: 15000 });
    expect(r.totals).toMatchObject({ orders: 2, grossVnd: 233000, returnsVnd: 100000, netVnd: 133000 });
  });

  it('omits cost and margin without report.profit (TDD §10.3)', async () => {
    const r = (await get(`/api/v1/reports/sales?${range}&groupBy=item`, viewer)).body;
    expect(r.columns.map((c: { key: string }) => c.key)).not.toContain('marginVnd');
    expect(r.rows[0]).not.toHaveProperty('costVnd');
  });

  it('groups by customer', async () => {
    const cust = (await get(`/api/v1/reports/sales?${range}&groupBy=customer`, manager)).body;
    expect(rowOf(cust.rows, 'Khách A')).toMatchObject({ grossVnd: 211000, returnsVnd: 100000 });
    expect(rowOf(cust.rows, 'Khách lẻ')).toMatchObject({ grossVnd: 22000 });
  });

  it('enforces the date range rules', async () => {
    expect((await get('/api/v1/reports/sales?from=2025-01-01&to=2026-10-25', manager)).body.error.code).toBe('range_too_long');
    expect((await get('/api/v1/reports/sales?groupBy=day', manager)).status).toBe(400);
    // Removed groupings (FR-RPT-02): cashier, category, payment method.
    for (const g of ['cashier', 'category', 'payment']) expect((await get(`/api/v1/reports/sales?${range}&groupBy=${g}`, manager)).status).toBe(400);
    const empty = (await get('/api/v1/reports/sales?from=2026-10-24&to=2026-10-24', manager)).body;
    expect(empty.rows).toEqual([]);
  });
});

describe('tax and audit reports (FR-RPT-04)', () => {
  it('output VAT by rate, net of returns', async () => {
    const r = (await get(`/api/v1/reports/tax?${range}&view=vat`, manager)).body;
    expect(r.rows).toEqual([
      { vatBp: 0, revenueVnd: 100000, netOfVatVnd: 100000, vatVnd: 0 },
      { vatBp: 1000, revenueVnd: 33000, netOfVatVnd: 30000, vatVnd: 3000 },
    ]);
  });

  it('e-invoice register and shift reconciliation', async () => {
    const inv = (await get(`/api/v1/reports/tax?${range}&view=einvoices`, manager)).body;
    expect(inv.rows).toHaveLength(3);
    expect(inv.rows.map((r: { status: string }) => r.status).sort()).toEqual(['Chờ xuất', 'Chờ xuất', 'Đã hủy']);
    const shifts = (await get(`/api/v1/reports/tax?${range}&view=shifts`, manager)).body;
    expect(shifts.rows[0]).toMatchObject({ cashier: 'thu', register: 'Q1', floatVnd: 500000 });
  });
});

describe('inventory and purchasing reports (FR-RPT-03, FR-RPT-05)', () => {
  it('stock with valuation only for cost viewers; slow movers', async () => {
    const asManager = (await get('/api/v1/reports/inventory?view=stock', manager)).body;
    expect(rowBy(asManager.rows, 'BOOK')).toMatchObject({ onHand: 9, available: 9, avgCostVnd: 50000, valueVnd: 450000 });
    const asViewer = (await get('/api/v1/reports/inventory?view=stock', viewer)).body;
    expect(rowBy(asViewer.rows, 'BOOK')).not.toHaveProperty('valueVnd');
    // Slow movers are a Stock-list filter now (FR-INV-10): in stock and unsold for 30 days.
    const slow = (await get('/api/v1/catalog/items?unsoldDays=30', manager)).body;
    expect(slow.items.map((r: { sku: string }) => r.sku)).toEqual(['NEVER-SOLD']);
    expect((await get('/api/v1/catalog/items?unsoldDays=45', manager)).status).toBe(400);
    expect((await get('/api/v1/reports/inventory?view=slow', manager)).status).toBe(400);
    const mv = (await get(`/api/v1/reports/inventory?view=movements&${range}`, manager)).body;
    // Movement types show in Vietnamese, as on the stock screen.
    expect(mv.rows.find((r: { type: string }) => r.type === 'Bán hàng')).toMatchObject({ qtyOut: 6, qtyIn: 0 });
    // The void and the return both put stock back as customer returns.
    expect(mv.rows.find((r: { type: string }) => r.type === 'Khách trả')).toMatchObject({ qtyIn: 2 });
  });

  it('stock-ins by supplier; there is no payables view', async () => {
    const si = (await get(`/api/v1/reports/purchasing?view=stock_ins&${range}`, manager)).body;
    expect(si.rows[0]).toMatchObject({ supplier: 'Fahasa', entries: 3, units: 64, costVnd: 10 * 50000 + 50 * 5000 + 4 * 10000 });
    expect((await get('/api/v1/reports/purchasing?view=payables', manager)).status).toBe(400);
    // Repeats of the Kiểm kho and Ký gửi screens are gone (FR-RPT-03, FR-RPT-05).
    expect((await get(`/api/v1/reports/purchasing?view=consignment&${range}`, manager)).status).toBe(400);
    for (const view of ['counts', 'consignment']) expect((await get(`/api/v1/reports/inventory?view=${view}&${range}`, manager)).status).toBe(400);
  });
});

describe('exports (FR-RPT-10)', () => {
  it('needs the export permission; the token works once and is audited', async () => {
    expect((await h.call('POST', '/api/v1/reports/sales/export', { cookie: viewer, body: { params: { from: TODAY, to: TODAY } } })).status).toBe(403);
    const bad = await h.call('POST', '/api/v1/reports/sales/export', { cookie: manager, body: { params: { from: TODAY } } });
    expect(bad.status).toBe(400);
    const t = await h.call('POST', '/api/v1/reports/sales/export', { cookie: manager, body: { params: { from: TODAY, to: TODAY, groupBy: 'item' } } });
    expect(t.status).toBe(201);
    const res = await h.app.request(t.body.url, { headers: { cookie: manager } });
    expect(res.headers.get('content-disposition')).toMatch(/bao-cao-sales-2026-10-25_2026-10-25\.xlsx/);
    const table = await readTable(new Uint8Array(await res.arrayBuffer()), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(table[0]!.slice(0, 2)).toEqual(['SKU', 'Tên sản phẩm']);
    expect(table.at(-1)![0]).toBe('Tổng cộng');
    expect((await h.app.request(t.body.url, { headers: { cookie: manager } })).status).toBe(404);
    // Someone else cannot redeem the token.
    const t2 = await h.call('POST', '/api/v1/reports/tax/export', { cookie: manager, body: { params: { from: TODAY, to: TODAY, view: 'vat' } } });
    expect((await h.app.request(t2.body.url, { headers: { cookie: viewer } })).status).toBe(403);
    // No CSV export for reports (FR-RPT-10).
    expect((await h.call('POST', '/api/v1/reports/tax/export', { cookie: manager, body: { format: 'csv', params: { from: TODAY, to: TODAY, view: 'vat' } } })).status).toBe(400);
    const audit = (await get('/api/v1/admin/audit?action=report.export', await h.login('lan', 'chu-cua-hang-2026'))).body.items;
    expect(audit.length).toBe(1);
  });
});

describe('menu badges (FR-ADM-08)', () => {
  it('counts failed e-invoices only for users who manage them', async () => {
    expect((await get('/api/v1/me/badges', manager)).body).toEqual({ einvoicesFailed: 0, ordersNeedingAction: 0, holdsOverdue: 0 });
    await h.t.sql`update sales.einvoice_job set status = 'failed' where status = 'pending'`;
    expect((await get('/api/v1/me/badges', manager)).body).toMatchObject({ einvoicesFailed: 2 });
    expect((await get('/api/v1/me/badges', cashier)).body).toEqual({ holdsOverdue: 0 });
  });
});

function rowBy(rows: { sku: string }[], sku: string) {
  return rows.find((r) => r.sku === sku);
}
