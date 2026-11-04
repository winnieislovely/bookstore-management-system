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
    expect(csv.replace(/^﻿/, '').split('\r\n')[0]).toBe('Mã bản,Tên sách,Kệ,Trạng thái hệ thống,Có mặt');
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
    const expected = { copies: 3, available: 1, onLoan: 1, overdue: 0 };
    expect((await call('GET', '/api/v1/library/overview', librarian)).body).toEqual(expected);
    expect((await call('GET', '/api/v1/reports/dashboard', owner)).body.libraryOverview).toEqual(expected);
    expect((await call('GET', '/api/v1/library/overview', cashier)).status).toBe(403);
  });
});
