import { describe, expect, it } from 'vitest';
import { borrowBlocks, copyBarcode, daysLate, dueAfter, lateFee, loanFee, nextLibraryCode, normalizeLibraryCode } from './library.js';

const rules = { loanFeeVnd: 50000, discountSpendVnd: 5000000, discountPct: 10 };

describe('library codes (FR-LIB-01)', () => {
  it('suggests the next code per language prefix', () => {
    expect(nextLibraryCode('vi', [])).toBe('VN-0001');
    expect(nextLibraryCode('vi', ['VN-0009', 'vn-0123', 'EN-0500', 'VN-ABC'])).toBe('VN-0124');
    expect(nextLibraryCode('en', ['VN-0009'])).toBe('EN-0001');
  });

  it('numbers copies as code plus copy number', () => {
    expect(normalizeLibraryCode(' vn-0123 ')).toBe('VN-0123');
    expect(copyBarcode('vn-0123', 2)).toBe('VN-0123-2');
  });
});

describe('loan fee and buyer discount (BR-13, FR-LIB-18)', () => {
  it('charges the list fee below the threshold and 10% less from it, rounded down to 1,000', () => {
    expect(loanFee(4_999_999, rules)).toEqual({ listVnd: 50000, discountPct: 0, amountVnd: 50000 });
    expect(loanFee(5_000_000, rules)).toEqual({ listVnd: 50000, discountPct: 10, amountVnd: 45000 });
    expect(loanFee(9_000_000, { ...rules, discountPct: 15 }).amountVnd).toBe(42000);
    expect(loanFee(9_000_000, { ...rules, discountPct: 0 }).discountPct).toBe(0);
  });
});

describe('due dates and late fees in store time (BR-13, FR-LIB-10)', () => {
  // 3 Nov 2026 22:30 in Hanoi = 15:30 UTC.
  const lent = new Date('2026-11-03T15:30:00Z');

  it('is due at the end of the store day 30 days later', () => {
    expect(dueAfter(lent, 30).toISOString()).toBe('2026-12-03T16:59:59.999Z');
  });

  it('counts whole store days late, with grace and the copy-value cap', () => {
    const due = dueAfter(lent, 30);
    expect(daysLate(due, new Date('2026-12-03T16:00:00Z'))).toBe(0);
    expect(daysLate(due, new Date('2026-12-03T17:30:00Z'))).toBe(1);
    expect(lateFee(due, new Date('2026-12-06T02:00:00Z'), 80000, { finePerDayVnd: 2000, graceDays: 0 })).toBe(6000);
    expect(lateFee(due, new Date('2026-12-06T02:00:00Z'), 80000, { finePerDayVnd: 2000, graceDays: 1 })).toBe(4000);
    expect(lateFee(due, new Date('2027-06-01T02:00:00Z'), 80000, { finePerDayVnd: 2000, graceDays: 0 })).toBe(80000);
  });
});

describe('eligibility (BR-15)', () => {
  it('blocks on overdue loans, unpaid charges and the loan limit', () => {
    expect(borrowBlocks({ openLoans: 2, overdueLoans: 0, unpaidChargesVnd: 0 }, 3, 1)).toEqual([]);
    expect(borrowBlocks({ openLoans: 2, overdueLoans: 0, unpaidChargesVnd: 0 }, 3, 2)).toEqual(['limit_reached']);
    expect(borrowBlocks({ openLoans: 1, overdueLoans: 1, unpaidChargesVnd: 2000 }, 3, 1)).toEqual(['overdue', 'unpaid_charges']);
  });
});
