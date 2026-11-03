import * as library from '@bookstore/modules/library';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PW, startHarness, type Harness } from './testing.js';

/** Library: codes, loans with fees, returns, renewals, reservations, POS payment (SRS §3.9, UC-17, UC-18, BR-13..15). */
let h: Harness;
let owner: string;
let librarian: string;
let cashier: string;
let shiftId: string;
let titleId: string;
let other: string;
let mai: string;
let nam: string;
const DAY = 86_400_000;

const call = (method: string, path: string, cookie: string, body?: unknown) => h.call(method, path, { cookie, body });

async function customer(name: string, phone: string) {
  const r = await call('POST', '/api/v1/customers', owner, { name, phone });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

beforeAll(async () => {
  h = await startHarness();
  let roles: Record<string, string>;
  ({ owner, roles } = await h.setupOwner());
  librarian = await h.staff(owner, 'thuthu', roles.librarian!);
  cashier = await h.staff(owner, 'thu', roles.cashier!);
  mai = await customer('Mai', '0912000001');
  nam = await customer('Nam', '0912000002');
  const registerId = (await call('GET', '/api/v1/pos/registers', cashier)).body.items[0].id;
  shiftId = (await call('POST', '/api/v1/pos/shifts/open', cashier, { registerId, floatVnd: 500000 })).body.id;
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

describe('catalogue: library codes and copies (FR-LIB-01, FR-LIB-02, FR-LIB-17)', () => {
  it('suggests the next code per language and refuses a duplicate code', async () => {
    expect((await call('GET', '/api/v1/library/titles/next-code?lang=vi', librarian)).body.code).toBe('VN-0001');
    const r = await call('POST', '/api/v1/library/titles', librarian, { code: 'vn-0123', title: 'Dế Mèn phiêu lưu ký', authors: ['Tô Hoài'], language: 'vi', category: 'Thiếu nhi' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.code).toBe('VN-0123');
    titleId = r.body.id;
    expect((await call('GET', '/api/v1/library/titles/next-code?lang=vi', librarian)).body.code).toBe('VN-0124');
    expect((await call('GET', '/api/v1/library/titles/next-code?lang=en', librarian)).body.code).toBe('EN-0001');
    const dup = await call('POST', '/api/v1/library/titles', librarian, { code: 'VN-0123', title: 'Khác', language: 'vi' });
    expect(dup.body.error.code).toBe('code_taken');
    other = (await call('POST', '/api/v1/library/titles', librarian, { code: 'EN-0001', title: 'The Little Prince', language: 'en' })).body.id;
  });

  it('numbers copies as library code plus copy number and prints labels', async () => {
    const r = await call('POST', `/api/v1/library/titles/${titleId}/copies`, librarian, { count: 2, valueVnd: 80000, acquiredVia: 'purchase', shelf: 'A1' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.items.map((c: { barcode: string }) => c.barcode)).toEqual(['VN-0123-1', 'VN-0123-2']);
    await call('POST', `/api/v1/library/titles/${other}/copies`, librarian, { count: 1, valueVnd: 30000, acquiredVia: 'donation', shelf: 'B1' });
    const labels = (await call('GET', `/api/v1/library/labels?copyIds=${r.body.items.map((c: { id: string }) => c.id).join(',')}`, librarian)).body.items;
    expect(labels[0]).toMatchObject({ barcode: 'VN-0123-1', code: 'VN-0123', language: 'vi' });
    const list = (await call('GET', '/api/v1/library/titles?language=vi', librarian)).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ copies: 2, available: 2 });
    // Cashiers have no library screens.
    expect((await call('GET', '/api/v1/library/titles', cashier)).status).toBe(403);
  });
});

describe('loans, fees and the POS (FR-LIB-07, FR-LIB-08, FR-LIB-10, FR-LIB-18, BR-13)', () => {
  let loanId: string;
  let feeCharge: string;

  it('lends with a 50,000 VND fee per copy and a 30-day due date', async () => {
    const r = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: mai, barcodes: ['vn-0123-1'] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ totalFeeVnd: 50000, discountPct: 0 });
    loanId = r.body.loans[0].loanId;
    const due = new Date(r.body.dueAt).getTime();
    expect(due - h.clock.now().getTime()).toBeGreaterThan(29 * DAY);
    expect(due - h.clock.now().getTime()).toBeLessThan(31 * DAY);
    const again = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: nam, barcodes: ['VN-0123-1'] });
    expect(again.body.error.code).toBe('copy_not_available');
  });

  it('blocks new loans while a charge is unpaid, and the cashier collects it at the POS', async () => {
    const blocked = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: mai, barcodes: ['EN-0001-1'] });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.details.blocks).toEqual(['unpaid_charges']);
    const charges = (await call('GET', `/api/v1/customers/${mai}/library-charges`, cashier)).body;
    expect(charges.totalVnd).toBe(50000);
    feeCharge = charges.items[0].id;
    expect(charges.items[0].description).toContain('VN-0123-1');
    const sale = await call('POST', '/api/v1/pos/sales', cashier, { shiftId, customerId: mai, lines: [], libraryChargeIds: [feeCharge], payments: [{ method: 'cash', amountVnd: 50000 }] });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(sale.body).toMatchObject({ totalVnd: 50000, pointsEarned: 0 });
    const rec = (await call('GET', `/api/v1/pos/sales/${sale.body.id}`, cashier)).body;
    expect(rec.lines[0]).toMatchObject({ itemClass: 'library_charge', variantId: null, totalVnd: 50000 });
    const twice = await call('POST', '/api/v1/pos/sales', cashier, { shiftId, customerId: mai, lines: [], libraryChargeIds: [feeCharge], payments: [{ method: 'cash', amountVnd: 50000 }] });
    expect(twice.body.error.code).toBe('library_charge_paid');
    const wrong = await call('POST', '/api/v1/pos/sales', cashier, { shiftId, customerId: nam, lines: [], libraryChargeIds: [feeCharge], payments: [{ method: 'cash', amountVnd: 50000 }] });
    expect(wrong.status).toBe(422);
  });

  it('renews for another period and another fee, up to the limit', async () => {
    const before = (await call('GET', `/api/v1/library/borrowers/${mai}`, librarian)).body.openLoans[0].dueAt;
    const r = await call('POST', `/api/v1/library/loans/${loanId}/renew`, librarian);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(new Date(r.body.dueAt).getTime() - new Date(before).getTime()).toBe(30 * DAY);
    expect(r.body.feeVnd).toBe(50000);
    // The renewal fee is owed before another renewal (BR-15).
    expect((await call('POST', `/api/v1/library/loans/${loanId}/renew`, librarian)).body.error.code).toBe('borrow_blocked');
  });

  it('charges 2,000 VND per day late at return, capped at the copy value', async () => {
    // Pay the renewal fee, then come back 3 days after the due date.
    const owed = (await call('GET', `/api/v1/customers/${mai}/library-charges`, cashier)).body.items.map((c: { id: string }) => c.id);
    expect((await call('POST', '/api/v1/pos/sales', cashier, { shiftId, customerId: mai, lines: [], libraryChargeIds: owed, payments: [{ method: 'cash', amountVnd: 50000 }] })).status).toBe(201);
    const loan = (await call('GET', `/api/v1/library/borrowers/${mai}`, librarian)).body.openLoans[0];
    h.clock.set(new Date(new Date(loan.dueAt).getTime() + 3 * DAY));
    // Sessions time out over the jump.
    owner = await h.login('lan', OWNER_PW);
    librarian = await h.login('thuthu', 'mat-khau-moi-456');
    cashier = await h.login('thu', 'mat-khau-moi-456');
    const registerId = (await call('GET', '/api/v1/pos/registers', cashier)).body.items[0].id;
    shiftId = (await call('GET', `/api/v1/pos/shifts/current?register=${registerId}`, cashier)).body.shift.id;
    const overdue = (await call('GET', '/api/v1/library/loans?filter=overdue', librarian)).body;
    expect(overdue.items).toHaveLength(1);
    expect(overdue.items[0]).toMatchObject({ daysLate: 3, lateFeeVnd: 6000, customerPhone: '+84912000001' });
    // Morning reminder: one in-app notice to library staff, no email (FR-LIB-14).
    expect(await library.remindLoans(h.ctx())).toEqual({ dueSoon: 0, overdue: 1 });
    const notes = (await call('GET', '/api/v1/notifications', librarian)).body.items;
    expect(notes[0]).toMatchObject({ template: 'library.loans_to_call', vars: { overdue: 1 } });
    const r = await call('POST', '/api/v1/library/loans/checkin', librarian, { barcode: 'VN-0123-1', condition: 'ok' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ daysLate: 3, lateFeeVnd: 6000, damageVnd: 0, hold: null });
    const b = (await call('GET', `/api/v1/library/borrowers/${mai}`, librarian)).body;
    expect(b.unpaidChargesVnd).toBe(6000);
    expect(b.history[0]).toMatchObject({ closedAs: 'returned' });
  });

  it('lets a manager waive a late fee with a reason; the librarian may not', async () => {
    const late = (await call('GET', `/api/v1/customers/${mai}/library-charges`, cashier)).body.items[0];
    expect(late.kind).toBe('late_fee');
    expect((await call('POST', `/api/v1/library/charges/${late.id}/waive`, librarian, { reason: 'Khách quen' })).status).toBe(403);
    expect((await call('POST', `/api/v1/library/charges/${late.id}/waive`, owner, { reason: '' })).status).toBe(400);
    expect((await call('POST', `/api/v1/library/charges/${late.id}/waive`, owner, { reason: 'Khách quen' })).body.status).toBe('waived');
  });

  it('discounts the loan fee for buyers past the spend threshold (FR-LIB-18)', async () => {
    expect((await call('PUT', '/api/v1/admin/settings', owner, { 'library.fee_discount_spend_vnd': 40000 })).status).toBe(204);
    // Mai has spent nothing on goods yet: library fees do not count.
    expect((await call('GET', `/api/v1/library/borrowers/${mai}`, librarian)).body.fee).toEqual({ listVnd: 50000, discountPct: 0, amountVnd: 50000 });
    // A goods sale of 45,000 ₫ (payments are checked at commit).
    await h.t.sql.begin(async (tx) => {
      await tx`insert into sales.sale (doc_no, shift_id, cashier_id, customer_id, subtotal_vnd, discount_vnd, total_vnd, vat_vnd)
        select 'TEST-1', ${shiftId}, opened_by, ${mai}, 45000, 0, 45000, 0 from sales.shift where id = ${shiftId}`;
      await tx`insert into sales.sale_line (sale_id, line_no, item_class, description, qty, unit_price_vnd, total_vnd, vat_bp, vat_vnd)
        select id, 1, 'goods', 'Sách', 1, 45000, 45000, 0, 0 from sales.sale where doc_no = 'TEST-1'`;
      await tx`insert into sales.sale_payment (sale_id, method, amount_vnd) select id, 'cash', 45000 from sales.sale where doc_no = 'TEST-1'`;
    });
    const b = (await call('GET', `/api/v1/library/borrowers/${mai}`, librarian)).body;
    expect(b.spendVnd).toBe(45000);
    expect(b.fee).toEqual({ listVnd: 50000, discountPct: 10, amountVnd: 45000 });
    const r = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: mai, barcodes: ['EN-0001-1'] });
    expect(r.body).toMatchObject({ totalFeeVnd: 45000, discountPct: 10 });
  });
});

describe('damage, loss and reservations (FR-LIB-11, FR-LIB-13)', () => {
  it('holds a returned copy for the first in the queue; renewal is refused meanwhile', async () => {
    await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: nam, barcodes: ['VN-0123-1', 'VN-0123-2'] });
    expect((await call('POST', '/api/v1/library/reservations', librarian, { titleId, customerId: nam })).body.error.code).toBe('already_borrowing');
    const res = await call('POST', '/api/v1/library/reservations', librarian, { titleId, customerId: mai });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const namLoan = (await call('GET', `/api/v1/library/borrowers/${nam}`, librarian)).body.openLoans.find((l: { barcode: string }) => l.barcode === 'VN-0123-2');
    expect((await call('POST', `/api/v1/library/loans/${namLoan.id}/renew`, librarian)).body.error.code).toBe('title_reserved');
    const back = (await call('POST', '/api/v1/library/loans/checkin', librarian, { barcode: 'VN-0123-2' })).body;
    expect(back.hold).toMatchObject({ customerName: 'Mai', customerPhone: '+84912000001' });
    expect((await call('GET', '/api/v1/library/loans?filter=held', librarian)).body.holds).toHaveLength(1);
    // Held for Mai: Nam cannot take it, Mai can (both with their charges paid).
    for (const who of [mai, nam]) {
      const owed = (await call('GET', `/api/v1/customers/${who}/library-charges`, cashier)).body;
      const paid = await call('POST', '/api/v1/pos/sales', cashier, { shiftId, customerId: who, lines: [], libraryChargeIds: owed.items.map((c: { id: string }) => c.id), payments: [{ method: 'cash', amountVnd: owed.totalVnd }] });
      expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    }
    expect((await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: nam, barcodes: ['VN-0123-2'] })).body.error.code).toBe('copy_held');
    expect((await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: mai, barcodes: ['VN-0123-2'] })).status).toBe(201);
  });

  it('charges value plus processing fee for a damaged or lost copy, cancelled if found', async () => {
    const dmg = (await call('POST', '/api/v1/library/loans/checkin', librarian, { barcode: 'VN-0123-2', condition: 'damaged' })).body;
    expect(dmg.damageVnd).toBe(100000);
    const namLoan = (await call('GET', `/api/v1/library/borrowers/${nam}`, librarian)).body.openLoans[0];
    expect((await call('POST', `/api/v1/library/loans/${namLoan.id}/mark-lost`, librarian)).body.chargeVnd).toBe(100000);
    const title = (await call('GET', `/api/v1/library/titles/${titleId}`, librarian)).body;
    expect(title.copies.map((c: { status: string }) => c.status)).toEqual(['lost', 'damaged']);
    expect((await call('POST', `/api/v1/library/copies/${title.copies[0].id}/found`, librarian)).body.cancelledCharges).toBe(1);
    expect((await call('GET', `/api/v1/customers/${nam}/library-charges`, cashier)).body.items.map((c: { kind: string }) => c.kind)).not.toContain('lost');
  });

  it('a voided sale owes its library charges again; charge lines cannot be returned', async () => {
    const owed = (await call('GET', `/api/v1/customers/${mai}/library-charges`, cashier)).body;
    expect(owed.totalVnd).toBe(100000 + 45000);
    const sale = (await call('POST', '/api/v1/pos/sales', cashier, { shiftId, customerId: mai, lines: [], libraryChargeIds: owed.items.map((c: { id: string }) => c.id), payments: [{ method: 'cash', amountVnd: owed.totalVnd }] })).body;
    const rec = (await call('GET', `/api/v1/pos/sales/${sale.id}`, cashier)).body;
    const ret = await call('POST', `/api/v1/pos/sales/${sale.id}/returns`, cashier, { shiftId, refundMethod: 'cash', lines: [{ saleLineId: rec.lines[0].id, qty: 1, restock: false }] });
    expect(ret.body.error.code).toBe('not_returnable');
    expect((await call('POST', `/api/v1/pos/sales/${sale.id}/void`, owner, { shiftId, reason: 'Thu nhầm' })).status).toBe(200);
    expect((await call('GET', `/api/v1/customers/${mai}/library-charges`, cashier)).body.totalVnd).toBe(owed.totalVnd);
  });

  it('finds missing and misplaced copies in a shelf stock-take (FR-LIB-04)', async () => {
    const r = (await call('POST', '/api/v1/library/stocktake', librarian, { shelf: 'B1', barcodes: ['VN-0123-1', 'XX-1'] })).body;
    expect(r.misplaced.map((c: { barcode: string }) => c.barcode)).toEqual(['VN-0123-1']);
    expect(r.unknown).toEqual(['XX-1']);
    expect(r.missing).toEqual([]);
  });

  it('reports circulation and fees (FR-LIB-16)', async () => {
    const day = new Date(h.clock.now().getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const r = (await call('GET', `/api/v1/reports/library?from=2000-01-01&to=${day}`, owner)).body;
    expect(r.loans).toBeGreaterThanOrEqual(5);
    expect(r.loanFeesVnd).toBeGreaterThan(0);
    expect(r.popular[0].code).toBe('VN-0123');
  });
});
