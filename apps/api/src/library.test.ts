import * as library from '@bookstore/modules/library';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, OWNER_PW, startHarness, type Harness } from './testing.js';

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

describe('loans and fees taken at the library desk (FR-LIB-07, FR-LIB-08, FR-LIB-09a, FR-LIB-10, FR-LIB-18, BR-13, BR-14)', () => {
  let loanId: string;
  const cash = { method: 'cash' };
  const owedOf = async (who: string) =>
    ((await call('GET', `/api/v1/library/borrowers/${who}`, librarian)).body.charges as { id: string; kind: string; status: string; amountVnd: number }[]).filter((c) => c.status === 'unpaid');

  it('lends only once the 50,000 VND fee is paid at the desk, due in 30 days', async () => {
    const unpaid = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: mai, barcodes: ['vn-0123-1'] });
    expect(unpaid.status).toBe(400);
    // Cash or transfer only: no card at the library desk.
    const card = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: mai, barcodes: ['vn-0123-1'], payment: { method: 'card', ref: 'AP1' } });
    expect(card.status).toBe(400);
    const r = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: mai, barcodes: ['vn-0123-1'], payment: cash });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ totalFeeVnd: 50000, discountPct: 0 });
    expect(r.body.receiptNo).toMatch(/^PT-\d{4}-00001$/);
    loanId = r.body.loans[0].loanId;
    const due = new Date(r.body.dueAt).getTime();
    expect(due - h.clock.now().getTime()).toBeGreaterThan(29 * DAY);
    expect(due - h.clock.now().getTime()).toBeLessThan(31 * DAY);
    expect(await owedOf(mai)).toEqual([]);
    const again = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: nam, barcodes: ['VN-0123-1'], payment: cash });
    expect(again.body.error.code).toBe('copy_not_available');
  });

  it('records the fee in the library cash book, not in shop sales (BR-14)', async () => {
    const day = new Date(h.clock.now().getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const book = (await call('GET', `/api/v1/library/payments?from=${day}&to=${day}`, librarian)).body;
    expect(book.items[0]).toMatchObject({ kind: 'receipt', method: 'cash', amountVnd: 50000, customerName: 'Mai' });
    expect(book.items[0].items).toContain('VN-0123-1');
    expect(book.totals).toMatchObject({ cash: 50000, all: 50000 });
    expect((await call('GET', `/api/v1/library/payments?from=${day}&to=${day}`, cashier)).status).toBe(403);
    // No sale and no shift cash: the shop's figures are untouched.
    expect((await call('GET', '/api/v1/reports/dashboard', owner)).body.today).toMatchObject({ grossVnd: 0, orders: 0 });
    const shift = (await call('GET', `/api/v1/pos/shifts/${shiftId}`, cashier)).body;
    expect(shift.cash).toMatchObject({ cashSalesVnd: 0, cashInVnd: 0 });
  });

  it('renews for another period, taking another fee at the desk', async () => {
    const before = (await call('GET', `/api/v1/library/borrowers/${mai}`, librarian)).body.openLoans[0].dueAt;
    expect((await call('POST', `/api/v1/library/loans/${loanId}/renew`, librarian, {})).status).toBe(400);
    const r = await call('POST', `/api/v1/library/loans/${loanId}/renew`, librarian, { payment: { method: 'transfer' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(new Date(r.body.dueAt).getTime() - new Date(before).getTime()).toBe(30 * DAY);
    expect(r.body).toMatchObject({ feeVnd: 50000, renewals: 1 });
    expect(r.body.receiptNo).toMatch(/^PT-/);
  });

  it('charges 2,000 VND per day late at return; the fee stays owed until paid', async () => {
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
    // Owed charges block new loans (BR-15).
    expect((await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: mai, barcodes: ['EN-0001-1'], payment: cash })).body.error.details.blocks).toEqual(['unpaid_charges']);
  });

  it('lets a manager waive a late fee with a reason; the librarian may not', async () => {
    const [late] = await owedOf(mai);
    expect(late!.kind).toBe('late_fee');
    expect((await call('POST', `/api/v1/library/charges/${late!.id}/waive`, librarian, { reason: 'Khách quen' })).status).toBe(403);
    expect((await call('POST', `/api/v1/library/charges/${late!.id}/waive`, owner, { reason: '' })).status).toBe(400);
    expect((await call('POST', `/api/v1/library/charges/${late!.id}/waive`, owner, { reason: 'Khách quen' })).body.status).toBe('waived');
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
    const r = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: mai, barcodes: ['EN-0001-1'], payment: cash });
    expect(r.body).toMatchObject({ totalFeeVnd: 45000, discountPct: 10 });
  });
});

describe('damage, loss, reservations and the cash book (FR-LIB-09a, FR-LIB-11, FR-LIB-13)', () => {
  const cash = { method: 'cash' };
  const owedOf = async (who: string) =>
    ((await call('GET', `/api/v1/library/borrowers/${who}`, librarian)).body.charges as { id: string; kind: string; status: string; amountVnd: number }[]).filter((c) => c.status === 'unpaid');

  it('holds a returned copy for the first in the queue; renewal is refused meanwhile', async () => {
    expect((await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: nam, barcodes: ['VN-0123-1', 'VN-0123-2'], payment: cash })).body.totalFeeVnd).toBe(100000);
    expect((await call('POST', '/api/v1/library/reservations', librarian, { titleId, customerId: nam })).body.error.code).toBe('already_borrowing');
    const res = await call('POST', '/api/v1/library/reservations', librarian, { titleId, customerId: mai });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const namLoan = (await call('GET', `/api/v1/library/borrowers/${nam}`, librarian)).body.openLoans.find((l: { barcode: string }) => l.barcode === 'VN-0123-2');
    expect((await call('POST', `/api/v1/library/loans/${namLoan.id}/renew`, librarian, { payment: cash })).body.error.code).toBe('title_reserved');
    const back = (await call('POST', '/api/v1/library/loans/checkin', librarian, { barcode: 'VN-0123-2' })).body;
    expect(back.hold).toMatchObject({ customerName: 'Mai', customerPhone: '+84912000001' });
    expect((await call('GET', '/api/v1/library/loans?filter=held', librarian)).body.holds).toHaveLength(1);
    // Held for Mai: Nam cannot take it, Mai can.
    expect((await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: nam, barcodes: ['VN-0123-2'], payment: cash })).body.error.code).toBe('copy_held');
    expect((await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: mai, barcodes: ['VN-0123-2'], payment: cash })).status).toBe(201);
  });

  it('charges value plus processing fee for a damaged or lost copy, cancelled if found', async () => {
    const dmg = (await call('POST', '/api/v1/library/loans/checkin', librarian, { barcode: 'VN-0123-2', condition: 'damaged' })).body;
    expect(dmg.damageVnd).toBe(100000);
    const namLoan = (await call('GET', `/api/v1/library/borrowers/${nam}`, librarian)).body.openLoans[0];
    expect((await call('POST', `/api/v1/library/loans/${namLoan.id}/mark-lost`, librarian)).body.chargeVnd).toBe(100000);
    const title = (await call('GET', `/api/v1/library/titles/${titleId}`, librarian)).body;
    expect(title.copies.map((c: { status: string }) => c.status)).toEqual(['lost', 'damaged']);
    expect((await call('POST', `/api/v1/library/copies/${title.copies[0].id}/found`, librarian)).body.cancelledCharges).toBe(1);
    expect((await owedOf(nam)).map((c) => c.kind)).not.toContain('lost');
  });

  it('collects owed charges at the desk; a refund makes them owed again', async () => {
    const owed = await owedOf(mai);
    expect(owed.map((c) => [c.kind, c.amountVnd])).toEqual([['damage', 100000]]);
    expect((await call('POST', '/api/v1/library/charges/pay', librarian, { customerId: nam, chargeIds: [owed[0]!.id], payment: cash })).status).toBe(422);
    const paid = await call('POST', '/api/v1/library/charges/pay', librarian, { customerId: mai, chargeIds: [owed[0]!.id], payment: { method: 'transfer', ref: 'FT2611050001' } });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect(paid.body).toMatchObject({ amountVnd: 100000, method: 'transfer' });
    expect((await call('POST', '/api/v1/library/charges/pay', librarian, { customerId: mai, chargeIds: [owed[0]!.id], payment: cash })).body.error.code).toBe('charge_not_unpaid');
    expect((await call('POST', `/api/v1/library/payments/${paid.body.id}/refund`, librarian, { reason: 'Thu nhầm' })).status).toBe(403);
    const refund = await call('POST', `/api/v1/library/payments/${paid.body.id}/refund`, owner, { reason: 'Thu nhầm' });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    expect(refund.body.amountVnd).toBe(-100000);
    expect((await call('POST', `/api/v1/library/payments/${paid.body.id}/refund`, owner, { reason: 'Lần nữa' })).body.error.code).toBe('already_refunded');
    expect((await owedOf(mai)).map((c) => c.id)).toEqual([owed[0]!.id]);
    const day = new Date(h.clock.now().getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const book = (await call('GET', `/api/v1/library/payments?from=${day}&to=${day}&method=transfer`, librarian)).body;
    expect(book.items.map((i: { kind: string; amountVnd: number }) => [i.kind, i.amountVnd])).toEqual([
      ['refund', -100000],
      ['receipt', 100000],
    ]);
    expect(book.totals.transfer).toBe(0);
  });

  it('counts a shelf like a stock count: blind, scan, out of scope, submit, approve without changes (FR-LIB-04)', async () => {
    // Shelf A1 holds VN-0123-1 (on the shelf); VN-0123-2 is damaged and EN-0001-1 is on loan.
    const created = await call('POST', '/api/v1/library/counts', librarian, { shelves: ['A1'], blind: true });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.docNo).toMatch(/^KT-\d{4}-00001$/);
    const id = created.body.id;
    let c = (await call('GET', `/api/v1/library/counts/${id}`, librarian)).body;
    expect(c.lines.map((l: { barcode: string }) => l.barcode)).toEqual(['VN-0123-1']);
    expect(c.lines[0].status).toBeUndefined(); // blind for the librarian
    expect((await call('POST', `/api/v1/library/counts/${id}/scan`, librarian, { barcode: 'vn-0123-1' })).body).toMatchObject({ inScope: true });
    expect((await call('POST', `/api/v1/library/counts/${id}/scan`, librarian, { barcode: 'EN-0001-1' })).body).toMatchObject({ inScope: false });
    expect((await call('POST', `/api/v1/library/counts/${id}/scan`, librarian, { barcode: 'XX-1' })).body.error.code).toBe('copy_not_found');
    c = (await call('GET', `/api/v1/library/counts/${id}`, owner)).body;
    expect(c.summary).toMatchObject({ lines: 1, found: 1, missing: 0, unchecked: 0, outOfScope: 1 });
    expect(c.lines.find((l: { barcode: string }) => l.barcode === 'EN-0001-1')).toMatchObject({ inScope: false, outcome: 'found_on_loan' });
    expect((await call('POST', `/api/v1/library/counts/${id}/submit`, librarian)).status).toBe(204);
    expect((await call('POST', `/api/v1/library/counts/${id}/scan`, librarian, { barcode: 'VN-0123-1' })).body.error.code).toBe('count_not_open');
    expect((await call('POST', `/api/v1/library/counts/${id}/approve`, librarian)).status).toBe(403);
    expect((await call('POST', `/api/v1/library/counts/${id}/approve`, owner)).body.status).toBe('approved');
    const title = (await call('GET', `/api/v1/library/titles/${titleId}`, librarian)).body;
    expect(title.copies.map((x: { status: string }) => x.status)).toEqual(['available', 'damaged']);
  });

  it('takes results from the count sheet and cancels until approved (FR-LIB-04)', async () => {
    const id = (await call('POST', '/api/v1/library/counts', librarian, {})).body.id;
    const req = (method: string, path: string, body?: Uint8Array) =>
      h.app.request(path, { method, headers: { origin: ORIGIN, 'x-bms-request': '1', cookie: librarian, 'content-type': 'text/csv' }, ...(body && { body: body as never }) });
    // Not blind: the sheet carries the system status.
    const csv = await (await req('GET', `/api/v1/library/counts/${id}/sheet?format=csv`)).text();
    expect(csv.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('Mã bản,Tên sách,Kệ,Trạng thái hệ thống,Có mặt');
    const up = async (text: string) => (await (await req('POST', `/api/v1/library/counts/${id}/sheet`, new TextEncoder().encode(text))).json()) as { error: { code: string } };
    expect((await up('Mã bản,Có mặt\r\nVN-0123-1,2\r\n')).error.code).toBe('count_sheet_invalid');
    expect(await up('Mã bản,Có mặt\r\nVN-0123-1,0\r\n')).toMatchObject({ updated: 1, checked: 1 });
    expect((await call('GET', `/api/v1/library/counts/${id}`, owner)).body.summary).toMatchObject({ missing: 1 });
    expect((await call('POST', `/api/v1/library/counts/${id}/cancel`, librarian)).status).toBe(204);
    expect((await call('GET', '/api/v1/library/counts?status=cancelled', librarian)).body.items).toHaveLength(1);
  });

  it('reports circulation and fees (FR-LIB-16)', async () => {
    const day = new Date(h.clock.now().getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const r = (await call('GET', `/api/v1/reports/library?from=2000-01-01&to=${day}`, owner)).body;
    expect(r.loans).toBeGreaterThanOrEqual(5);
    expect(r.loanFeesVnd).toBeGreaterThan(0);
    expect(r.popular[0].code).toBe('VN-0123');
  });

  it('gives the library overview on Mượn / trả and the dashboard (FR-LIB-15a, FR-RPT-01)', async () => {
    // VN-0123-1 on the shelf, VN-0123-2 damaged, EN-0001-1 lent to Mai.
    const ov = (await call('GET', '/api/v1/library/overview', librarian)).body;
    expect(ov).toMatchObject({ copies: 3, available: 1, onLoan: 1, overdue: 0, period: 'week' });
    // Fees collected this week (from Monday, store time), receipts less refunds (FR-LIB-15a).
    const book = (await call('GET', `/api/v1/library/payments?from=${ov.from}&to=${ov.to}`, librarian)).body;
    expect(ov.collectedVnd).toBeGreaterThan(0);
    expect(ov.collectedVnd).toBe(book.totals.all);
    expect(new Date(`${ov.from}T00:00:00Z`).getUTCDay()).toBe(1);
    expect((await call('GET', '/api/v1/reports/dashboard', owner)).body.libraryOverview).toEqual(ov);
    expect((await call('PUT', '/api/v1/admin/settings', owner, { 'library.overview_period': 'day' })).status).toBe(204);
    expect((await call('GET', '/api/v1/library/overview', librarian)).body).toMatchObject({ period: 'day', from: ov.to, to: ov.to });
    expect((await call('GET', '/api/v1/library/overview', cashier)).status).toBe(403);
  });
});

describe('reservations on the borrow form (FR-LIB-13, UC-17 3b)', () => {
  const cash = { method: 'cash' };
  let hoa: string;
  let minh: string;
  const ids: Record<string, string> = {};
  const checkout = (body: unknown) => call('POST', '/api/v1/library/loans/checkout', librarian, body);
  const titleRow = async (code: string) => (await call('GET', `/api/v1/library/titles?q=${code}`, librarian)).body.items[0];

  beforeAll(async () => {
    hoa = await customer('Hoa', '0912000011');
    minh = await customer('Minh', '0912000012');
    for (const [code, n] of [['VN-0201', 1], ['VN-0202', 1], ['VN-0203', 3], ['VN-0204', 1]] as const) {
      ids[code] = (await call('POST', '/api/v1/library/titles', librarian, { code, title: `Sách ${code}`, language: 'vi' })).body.id;
      await call('POST', `/api/v1/library/titles/${ids[code]}/copies`, librarian, { count: n, valueVnd: 50000, acquiredVia: 'purchase', shelf: 'C1' });
    }
    expect((await checkout({ customerId: minh, barcodes: ['VN-0201-1', 'VN-0202-1', 'VN-0204-1'], payment: cash })).status).toBe(201);
  });

  it('reserves a title with no copy on the shelf without payment (a reservation slip)', async () => {
    const t = await titleRow('VN-0201');
    expect(t).toMatchObject({ available: 0, onLoan: 1 });
    expect(t.nextDueAt).toBeTruthy();
    const r = await checkout({ customerId: hoa, holdTitleIds: [ids['VN-0201']] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ loans: [], totalFeeVnd: 0, receiptNo: null });
    expect(r.body.holds).toEqual([expect.objectContaining({ code: 'VN-0201', position: 1 })]);
    expect((await checkout({ customerId: hoa, holdTitleIds: [ids['VN-0201']] })).body.error.code).toBe('already_reserved');
    expect((await checkout({ customerId: hoa })).status).toBe(400);
  });

  it('lends and reserves on one form, taking the fee for the loans only', async () => {
    // A title still on the shelf cannot be reserved; nothing of the form is recorded.
    const shelf = await checkout({ customerId: hoa, barcodes: ['VN-0203-1'], holdTitleIds: [ids['VN-0203']], payment: cash });
    expect(shelf.body.error.code).toBe('title_available');
    expect((await titleRow('VN-0203')).available).toBe(3);
    // Payment is still required once a copy is lent.
    expect((await checkout({ customerId: hoa, barcodes: ['VN-0203-1'], holdTitleIds: [ids['VN-0202']] })).status).toBe(400);
    const r = await checkout({ customerId: hoa, barcodes: ['VN-0203-1'], holdTitleIds: [ids['VN-0202']], payment: cash });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ totalFeeVnd: 50000 });
    expect(r.body.loans).toHaveLength(1);
    expect(r.body.holds).toEqual([expect.objectContaining({ code: 'VN-0202', position: 1 })]);
  });

  it('does not count reservations toward the loan limit', async () => {
    expect((await checkout({ customerId: hoa, barcodes: ['VN-0203-2', 'VN-0203-3'], payment: cash })).status).toBe(201);
    // Three loans out: no more copies, but a reservation is still taken.
    expect((await checkout({ customerId: hoa, barcodes: ['VN-0123-1'], payment: cash })).body.error.code).toBe('borrow_blocked');
    expect((await checkout({ customerId: hoa, holdTitleIds: [ids['VN-0204']] })).status).toBe(201);
  });

  it('refuses reservations from a borrower with overdue loans', async () => {
    const due = (await call('GET', `/api/v1/library/borrowers/${minh}`, librarian)).body.openLoans[0].dueAt;
    h.clock.set(new Date(new Date(due).getTime() + 2 * DAY));
    owner = await h.login('lan', OWNER_PW);
    librarian = await h.login('thuthu', 'mat-khau-moi-456');
    const r = await checkout({ customerId: minh, holdTitleIds: [ids['VN-0203']] });
    expect(r.body.error.code).toBe('borrow_blocked');
    expect((await call('POST', '/api/v1/library/reservations', librarian, { titleId: ids['VN-0203'], customerId: minh })).body.error.code).toBe('borrow_blocked');
  });
});

describe('manual discount at check-out (FR-LIB-18)', () => {
  const cash = { method: 'cash' };
  let an: string;
  beforeAll(async () => {
    an = await customer('An', '0912000021');
    const t = (await call('POST', '/api/v1/library/titles', librarian, { code: 'VN-0301', title: 'Sách giảm giá', language: 'vi' })).body.id;
    await call('POST', `/api/v1/library/titles/${t}/copies`, librarian, { count: 5, valueVnd: 50000, acquiredVia: 'purchase', shelf: 'D1' });
  });

  it('takes a percentage off each copy, rounded down to 1,000 VND', async () => {
    const r = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: an, barcodes: ['VN-0301-1', 'VN-0301-2'], payment: cash, discount: { kind: 'pct', value: 15 } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.loans.map((l: { feeVnd: number }) => l.feeVnd)).toEqual([42000, 42000]);
    expect(r.body.totalFeeVnd).toBe(84000);
    expect((await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: an, barcodes: ['VN-0301-3'], payment: cash, discount: { kind: 'pct', value: 120 } })).status).toBe(400);
  });

  it('takes an amount off the total, never above the fees', async () => {
    const big = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: an, barcodes: ['VN-0301-3'], payment: cash, discount: { kind: 'vnd', value: 60000 } });
    expect(big.body.error.code).toBe('discount_too_high');
    const r = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: an, barcodes: ['VN-0301-3'], payment: cash, discount: { kind: 'vnd', value: 50000 } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // Free loan: still a slip, a 0 VND receipt (FR-LIB-09a).
    expect(r.body).toMatchObject({ totalFeeVnd: 0 });
    expect(r.body.receiptNo).toMatch(/^PT-/);
  });
});

describe('loan slips on Mượn / trả (FR-LIB-09a)', () => {
  const cash = { method: 'cash' };
  let binh: string;
  let slipNo: string;
  let slipId: string;
  const slips = async (query = '') => (await call('GET', `/api/v1/library/slips${query}`, librarian)).body;

  beforeAll(async () => {
    binh = await customer('Bình', '0912000031');
    const t = (await call('POST', '/api/v1/library/titles', librarian, { code: 'VN-0401', title: 'Sách phiếu mượn', language: 'vi' })).body.id;
    await call('POST', `/api/v1/library/titles/${t}/copies`, librarian, { count: 3, valueVnd: 80000, acquiredVia: 'purchase', shelf: 'E1' });
  });

  it('lists one row per check-out, numbered by its receipt', async () => {
    const r = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: binh, barcodes: ['VN-0401-1', 'VN-0401-2'], payment: cash });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    slipNo = r.body.receiptNo;
    const list = await slips(`?q=${slipNo}`);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ docNo: slipNo, customerName: 'Bình', customerPhone: '+84912000031', copies: 2, out: 2, amountVnd: 100000, receivedBy: expect.any(String) });
    slipId = list.items[0].id;
    expect((await slips('?q=0912000031')).items.map((s: { docNo: string }) => s.docNo)).toContain(slipNo);
    expect((await slips('?q=vn-0401-2')).items.map((s: { docNo: string }) => s.docNo)).toEqual([slipNo]);
  });

  it('adds later fees to the slip and shows its receipts', async () => {
    const loan = (await call('GET', `/api/v1/library/slips/${slipId}`, librarian)).body.loans[0];
    h.clock.set(new Date(new Date(loan.dueAt).getTime() + 3 * DAY));
    owner = await h.login('lan', OWNER_PW);
    librarian = await h.login('thuthu', 'mat-khau-moi-456');
    cashier = await h.login('thu', 'mat-khau-moi-456');
    expect((await slips('?filter=overdue')).items.map((s: { docNo: string }) => s.docNo)).toContain(slipNo);
    await call('POST', '/api/v1/library/loans/checkin', librarian, { barcode: 'VN-0401-1' });
    let d = (await call('GET', `/api/v1/library/slips/${slipId}`, librarian)).body;
    expect(d.owed).toEqual([expect.objectContaining({ kind: 'late_fee', amountVnd: 6000, barcode: 'VN-0401-1' })]);
    await call('POST', '/api/v1/library/charges/pay', librarian, { customerId: binh, chargeIds: d.owed.map((c: { id: string }) => c.id), payment: cash });
    d = (await call('GET', `/api/v1/library/slips/${slipId}`, librarian)).body;
    expect(d).toMatchObject({ docNo: slipNo, copies: 2, out: 1, amountVnd: 106000, owed: [] });
    expect(d.payments.map((p: { amountVnd: number; items: string }) => [p.amountVnd, p.items])).toEqual([
      [100000, 'Phí mượn sách ×2'],
      [6000, 'Phí trả trễ'],
    ]);
    expect(d.loans.map((l: { barcode: string; returnedAt: string | null }) => [l.barcode, !!l.returnedAt])).toEqual([
      ['VN-0401-1', true],
      ['VN-0401-2', false],
    ]);
  });

  it('moves a slip to Đã trả hết once every copy is back; a 0 VND slip cannot be refunded', async () => {
    await call('POST', '/api/v1/library/loans/checkin', librarian, { barcode: 'VN-0401-2' });
    const late = (await call('GET', `/api/v1/library/slips/${slipId}`, librarian)).body.owed;
    await call('POST', '/api/v1/library/charges/pay', librarian, { customerId: binh, chargeIds: late.map((c: { id: string }) => c.id), payment: cash });
    expect((await slips('?filter=open')).items.map((s: { docNo: string }) => s.docNo)).not.toContain(slipNo);
    expect((await slips('?filter=returned')).items.map((s: { docNo: string }) => s.docNo)).toContain(slipNo);
    const free = await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: binh, barcodes: ['VN-0401-3'], payment: cash, discount: { kind: 'pct', value: 100 } });
    const freeSlip = (await slips(`?q=${free.body.receiptNo}`)).items[0];
    expect(freeSlip).toMatchObject({ amountVnd: 0, copies: 1 });
    const p = (await call('GET', `/api/v1/library/slips/${freeSlip.id}`, librarian)).body.payments[0];
    expect(p).toMatchObject({ amountVnd: 0, items: 'Phiếu mượn' });
    expect((await call('POST', `/api/v1/library/payments/${p.id}/refund`, owner, { reason: 'thử' })).body.error.code).toBe('nothing_to_refund');
    expect((await call('GET', '/api/v1/library/slips', cashier)).status).toBe(403);
  });
});

describe('customer list: last activity counts library use (FR-CRM-02)', () => {
  it('shows a borrower who never bought as active', async () => {
    const chi = await customer('Chi chỉ mượn', '0912000041');
    const t = (await call('POST', '/api/v1/library/titles', librarian, { code: 'VN-0501', title: 'Sách hoạt động', language: 'vi' })).body.id;
    await call('POST', `/api/v1/library/titles/${t}/copies`, librarian, { count: 1, valueVnd: 50000, acquiredVia: 'purchase', shelf: 'F1' });
    const row = async () => (await call('GET', '/api/v1/customers?q=0912000041', owner)).body.items[0];
    expect((await row()).lastActivityAt).toBeNull();
    expect((await call('POST', '/api/v1/library/loans/checkout', librarian, { customerId: chi, barcodes: ['VN-0501-1'], payment: { method: 'cash' } })).status).toBe(201);
    const r = await row();
    expect(r).toMatchObject({ orders: 0 });
    expect(r.lastActivityAt).toBeTruthy();
    const ids = async (qs: string) => (await call('GET', `/api/v1/customers?${qs}`, owner)).body.items.map((c: { id: string }) => c.id);
    expect(await ids('lastActivity=30d&q=0912000041')).toEqual([chi]);
    expect(await ids('lastActivity=never&q=0912000041')).toEqual([]);
    // Dịch vụ sử dụng: Chi only borrows; Bình (earlier) only borrows too; a buyer with no loans is shop only.
    expect(await ids('services=library&q=0912000041')).toEqual([chi]);
    expect(await ids('services=shop&q=0912000041')).toEqual([]);
  });
});
