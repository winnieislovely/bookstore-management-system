import { MockEInvoiceAdapter } from '@bookstore/modules/integrations/einvoice';
import * as jobs from '@bookstore/modules/jobs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './testing.js';

/** Consignment settlement, customer privacy and background jobs (FR-PUR-10..12, FR-CRM-06/07/08, TDD §9). */
let h: Harness;
let owner: string;
let manager: string;
let cashier: string;
let roles: Record<string, string>;
let shiftId: string;
let book: string;
let consigned: string;
let consignorId: string;
let customerId: string;
let saleA: string;
const adapter = new MockEInvoiceAdapter();

beforeAll(async () => {
  h = await startHarness();
  ({ owner, roles } = await h.setupOwner());
  manager = await h.staff(owner, 'quanly', roles.manager!, '112233');
  cashier = await h.staff(owner, 'thu', roles.cashier!);
  const cat = (await h.call('POST', '/api/v1/catalog/categories', { cookie: owner, body: { i18n: { en: { name: 'Books' } } } })).body.id;
  const supplier = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Fahasa', kind: 'distributor' } })).body.id;
  consignorId = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Kim Đồng', kind: 'publisher', isConsignor: true } })).body.id;
  const mk = async (sku: string, price: number, opts: Record<string, unknown> = {}) => {
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', {
      cookie: owner,
      body: {
        supplierId: opts.consignor ? consignorId : supplier,
        ...(opts.consignor ? { consignment: true, consignmentDiscountBp: 3000 } : {}),
        line: {
          item: { kind: 'book', i18n: { en: { title: sku, description: sku } }, categoryIds: [cat] },
          variant: { sku, weightG: 200, vatBp: 0 },
          imageFileIds: ['00000000-0000-7000-8000-00000000000a'],
          costVnd: price / 2,
          sellingPriceVnd: price,
          qty: (opts.qty as number) ?? 10,
        },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.lines[0].variantId as string;
  };
  book = await mk('SACH-0001', 100000);
  consigned = await mk('KG-0001', 80000, { consignor: true, qty: 5 });
  const registerId = (await h.call('GET', '/api/v1/pos/registers', { cookie: cashier })).body.items[0].id;
  shiftId = (await h.call('POST', '/api/v1/pos/shifts/open', { cookie: cashier, body: { registerId, floatVnd: 500000 } })).body.id;
  customerId = (await h.call('POST', '/api/v1/customers', { cookie: cashier, body: { name: 'Lê Văn C', phone: '0987654321' } })).body.id;
  // A 10 % store promotion must not reduce what the consignor is paid (TDD §4.3).
  await h.call('POST', '/api/v1/promotions', {
    cookie: owner,
    body: { name: 'Giảm 10%', rule: { type: 'percent', percentBp: 1000, scope: { kind: 'product', variantIds: [consigned] } }, startsAt: h.clock.now().toISOString() },
  });
  const sale = await h.call('POST', '/api/v1/pos/sales', {
    cookie: cashier,
    body: {
      lines: [
        { lineId: 'a', variantId: consigned, qty: 2 },
        { lineId: 'b', variantId: book, qty: 1 },
      ],
      customerId,
      shiftId,
      payments: [{ method: 'cash', amountVnd: 244000 }],
    },
  });
  expect(sale.status, JSON.stringify(sale.body)).toBe(201);
  saleA = sale.body.id;
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

describe('consignment statement (FR-PUR-10, FR-PUR-11)', () => {
  let statementId: string;

  it('lists received, sold and remaining with the amount due at the agreed discount', async () => {
    const r = await h.call('POST', '/api/v1/purchasing/consignment/statements', { cookie: owner, body: { supplierId: consignorId, period: '2026-10' } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.docNo).toBe('KG-2026-00001');
    expect(r.body.lines).toEqual([
      expect.objectContaining({ sku: 'KG-0001', received: 5, sold: 2, returned: 0, remaining: 3, unitPriceVnd: 80000, discountBp: 3000, amountDueVnd: 112000 }),
    ]);
    statementId = r.body.id;
    // Regenerating a draft keeps its number.
    const again = await h.call('POST', '/api/v1/purchasing/consignment/statements', { cookie: owner, body: { supplierId: consignorId, period: '2026-10' } });
    expect(again.body).toMatchObject({ id: statementId, docNo: 'KG-2026-00001' });
    expect((await h.call('POST', '/api/v1/purchasing/consignment/statements', { cookie: cashier, body: { supplierId: consignorId, period: '2026-10' } })).status).toBe(403);
  });

  it('approval fixes the amount due; an approved statement is final', async () => {
    const r = await h.call('POST', `/api/v1/purchasing/consignment/statements/${statementId}/approve`, { cookie: owner });
    expect(r.body).toMatchObject({ amountDueVnd: 112000 });
    // No payable is written (FR-PUR-06 removed); the amount is paid outside the system.
    expect((await h.t.sql`select count(*)::int as n from purchasing.payable`)[0]!.n).toBe(0);
    expect((await h.call('POST', `/api/v1/purchasing/consignment/statements/${statementId}/approve`, { cookie: owner })).body.error.code).toBe('statement_approved');
    expect((await h.call('POST', '/api/v1/purchasing/consignment/statements', { cookie: owner, body: { supplierId: consignorId, period: '2026-10' } })).body.error.code).toBe(
      'statement_approved',
    );
  });
});

describe('consignment return (FR-PUR-12)', () => {
  it('returns unsold units without cost impact and refuses more than remain', async () => {
    const lot = (await h.call('GET', `/api/v1/purchasing/consignment/lots?supplier=${consignorId}`, { cookie: owner })).body.items[0];
    expect(lot.remaining).toBe(3);
    const r = await h.call('POST', '/api/v1/purchasing/consignment/returns', { cookie: owner, body: { lotId: lot.id, qty: 2 } });
    expect(r.body.remaining).toBe(1);
    expect((await h.call('POST', '/api/v1/purchasing/consignment/returns', { cookie: owner, body: { lotId: lot.id, qty: 5 } })).body.error.code).toBe('return_exceeds_remaining');
    const [lvl] = await h.t.sql`select on_hand, avg_cost_vnd from inventory.stock_level where variant_id = ${consigned}`;
    expect({ onHand: lvl!.on_hand, avgCost: Number(lvl!.avg_cost_vnd) }).toEqual({ onHand: 1, avgCost: 0 });
  });
});

describe('e-invoice worker (FR-POS-15..17, TDD §8.3)', () => {
  it('a provider outage marks the job failed, notifies, then retries with backoff', async () => {
    adapter.failNext = 1;
    expect(await jobs.processEinvoices(h.ctx(), adapter)).toMatchObject({ failed: 1, issued: 0 });
    const [job] = await h.t.sql`select status, attempts, error from sales.einvoice_job where sale_id = ${saleA}`;
    expect(job).toMatchObject({ status: 'failed', attempts: 1 });
    const n = (await h.call('GET', '/api/v1/notifications', { cookie: manager })).body.items;
    expect(n[0]).toMatchObject({ template: 'einvoice.failed' });
    expect((await h.call('GET', '/api/v1/notifications', { cookie: cashier })).body.items).toHaveLength(0);
    // Not due yet.
    expect((await jobs.processEinvoices(h.ctx(), adapter)).issued).toBe(0);
    h.clock.advance(2 * 60_000);
    expect((await jobs.processEinvoices(h.ctx(), adapter)).issued).toBe(1);
    const [issued] = await h.t.sql`select status, invoice_no from sales.einvoice_job where sale_id = ${saleA}`;
    expect(issued!.status).toBe('issued');
    expect(issued!.invoice_no).toMatch(/^\d{8}$/);
  });

  it('a later buyer request reissues with buyer details and emails it', async () => {
    await h.call('POST', `/api/v1/pos/sales/${saleA}/einvoice-request`, { cookie: cashier, body: { name: 'Công ty ABC', taxCode: '0101234567', email: 'ketoan@abc.vn' } });
    const r = await jobs.processEinvoices(h.ctx(), adapter);
    expect(r).toMatchObject({ reissued: 1, emailed: 1 });
    expect(adapter.emails).toEqual([expect.objectContaining({ email: 'ketoan@abc.vn' })]);
    expect((await jobs.processEinvoices(h.ctx(), adapter)).emailed).toBe(0);
    const sale = (await h.call('GET', `/api/v1/pos/sales/${saleA}`, { cookie: cashier })).body;
    expect(sale.einvoice).toMatchObject({ status: 'issued', emailStatus: 'sent' });
  });

  it('voiding a sale with an issued invoice cancels it at the provider', async () => {
    const s = await h.call('POST', '/api/v1/pos/sales', { cookie: cashier, body: { lines: [{ lineId: 'x', variantId: book, qty: 1 }], shiftId, payments: [{ method: 'cash', amountVnd: 100000 }] } });
    await jobs.processEinvoices(h.ctx(), adapter);
    await h.call('POST', `/api/v1/pos/sales/${s.body.id}/void`, { cookie: manager, body: { reason: 'Nhầm', shiftId } });
    expect((await jobs.processEinvoices(h.ctx(), adapter)).cancelled).toBe(1);
    const [job] = await h.t.sql`select status from sales.einvoice_job where sale_id = ${s.body.id}`;
    expect(job!.status).toBe('cancelled');
  });
});

describe('outbox dispatch (TDD §9.2)', () => {
  it('hands events to subscribers once and marks them processed', async () => {
    const seen: string[] = [];
    const handled = await jobs.dispatchOutbox(h.ctx(), { 'sale.completed': [async (_c, e) => void seen.push(e.payload.saleId as string)] }, 1000);
    expect(handled).toBeGreaterThan(5);
    expect(seen).toContain(saleA);
    expect(await jobs.dispatchOutbox(h.ctx(), {}, 1000)).toBe(0);
  });
});

describe('points adjustment and erasure (FR-CRM-06, FR-CRM-08)', () => {
  it('adjusts points with permission and a reason', async () => {
    expect((await h.call('POST', `/api/v1/customers/${customerId}/points-adjust`, { cookie: cashier, body: { delta: 10, reason: 'x' } })).status).toBe(403);
    const r = await h.call('POST', `/api/v1/customers/${customerId}/points-adjust`, { cookie: manager, body: { delta: 10, reason: 'Bù điểm' } });
    expect(r.body.pointsBalance).toBe(24 + 10);
  });

  it('recalculates tiers from rolling 12-month spend (FR-CRM-07)', async () => {
    await h.t.sql`update crm.tier set min_spend_vnd = 200000 where code = 'silver'`;
    expect(await jobs.recalcTiers(h.ctx())).toBe(1);
    expect((await h.call('GET', `/api/v1/customers/${customerId}`, { cookie: cashier })).body.tierCode).toBe('silver');
    expect(await jobs.recalcTiers(h.ctx())).toBe(0);
  });

  it('expires points 12 months after earning, once (BR-07)', async () => {
    h.clock.advance(366 * 86_400_000);
    const expired = await jobs.expirePoints(h.ctx());
    expect(expired).toBe(24); // the earned points; the manual +10 has no expiry
    expect(await jobs.expirePoints(h.ctx())).toBe(0);
    const [c] = await h.t.sql`select points_balance from crm.customer where id = ${customerId}`;
    expect(c!.points_balance).toBe(10);
  });

  it('anonymises personal data and keeps the financial history', async () => {
    owner = await h.login('lan', 'chu-cua-hang-2026');
    const r = await h.call('POST', `/api/v1/customers/${customerId}/erase`, { cookie: owner, body: { reason: 'Khách yêu cầu' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [c] = await h.t.sql`select name, phone_e164, search_text, anonymised_at from crm.customer where id = ${customerId}`;
    expect(c).toMatchObject({ phone_e164: null, search_text: '' });
    expect(c!.anonymised_at).toBeTruthy();
    const [s] = await h.t.sql`select customer_id from sales.sale where id = ${saleA}`;
    expect(s!.customer_id).toBe(customerId);
    expect((await h.call('POST', `/api/v1/customers/${customerId}/erase`, { cookie: owner, body: { reason: 'x' } })).body.error.code).toBe('already_erased');
  });

  it('the nightly integrity check finds no drift (TDD §5.4)', async () => {
    expect(await jobs.integrityCheck(h.ctx())).toEqual([]);
  });
});
