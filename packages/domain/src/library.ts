/**
 * Library rules (SRS §3.9, BR-13..15, TDD §4.8). Pure functions: loan fee with the buyer discount,
 * due dates, late fees, borrowing eligibility and library codes.
 */

export const LIB_LANGUAGES = ['vi', 'en'] as const;
export type LibLanguage = (typeof LIB_LANGUAGES)[number];

/** Copy statuses (SRS B.4); overdue belongs to the loan, not the copy. */
export const LIB_COPY_STATUSES = ['available', 'reserved', 'on_loan', 'lost', 'damaged'] as const;
export type LibCopyStatus = (typeof LIB_COPY_STATUSES)[number];

export const LIB_ACQUIRED_VIA = ['purchase', 'donation', 'transfer'] as const;
export const LIB_CHARGE_KINDS = ['loan_fee', 'late_fee', 'lost', 'damage'] as const;
export type LibChargeKind = (typeof LIB_CHARGE_KINDS)[number];
export const LIB_CHARGE_STATUSES = ['unpaid', 'paid', 'waived', 'cancelled'] as const;
export const LIB_RESERVATION_STATUSES = ['queued', 'held', 'collected', 'expired', 'cancelled'] as const;
/** How an open loan was closed. */
export const LOAN_CLOSED_AS = ['returned', 'lost'] as const;
/** Library cash book (FR-LIB-09a): collected at the desk, never through the POS. */
export const LIB_PAYMENT_METHODS = ['cash', 'transfer', 'card'] as const;
export type LibPaymentMethod = (typeof LIB_PAYMENT_METHODS)[number];
export const LIB_PAYMENT_KINDS = ['receipt', 'refund'] as const;

// =============================================================================================
// Library codes and copy barcodes (FR-LIB-01)

const PREFIX: Record<LibLanguage, string> = { vi: 'VN-', en: 'EN-' };

export function normalizeLibraryCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/** Next free code for the language prefix: one above the highest `PREFIX` + digits code, 4 digits. */
export function nextLibraryCode(language: LibLanguage, existing: readonly string[]): string {
  const prefix = PREFIX[language];
  let max = 0;
  for (const c of existing) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(normalizeLibraryCode(c));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** Copy barcode: library code plus copy number (`VN-0123-2`). */
export function copyBarcode(code: string, copyNo: number): string {
  return `${normalizeLibraryCode(code)}-${copyNo}`;
}

// =============================================================================================
// Dates in store time (Asia/Ho_Chi_Minh, UTC+7, no DST)

const DAY = 86_400_000;
const OFFSET = 7 * 3600_000;

/** Days since the epoch of the store-local calendar day of `at`. */
export function storeDayNumber(at: Date): number {
  return Math.floor((at.getTime() + OFFSET) / DAY);
}

/** The last moment of the store day `days` after the day of `from` (a due date is a whole day). */
export function dueAfter(from: Date, days: number): Date {
  return new Date((storeDayNumber(from) + days + 1) * DAY - OFFSET - 1);
}

export function isOverdue(dueAt: Date, now: Date): boolean {
  return now.getTime() > dueAt.getTime();
}

// =============================================================================================
// Fees (BR-13, FR-LIB-10, FR-LIB-18)

export interface LoanFeeRules {
  loanFeeVnd: number;
  discountSpendVnd: number;
  discountPct: number;
}

/**
 * Loan fee for one copy and one loan period. A borrower whose lifetime net spend on goods has
 * reached the threshold pays it less the discount, rounded down to 1,000 VND (FR-LIB-18).
 */
export function loanFee(lifetimeSpendVnd: number, r: LoanFeeRules): { listVnd: number; discountPct: number; amountVnd: number } {
  const discounted = r.discountPct > 0 && lifetimeSpendVnd >= r.discountSpendVnd;
  if (!discounted) return { listVnd: r.loanFeeVnd, discountPct: 0, amountVnd: r.loanFeeVnd };
  const off = r.loanFeeVnd * r.discountPct / 100;
  return { listVnd: r.loanFeeVnd, discountPct: r.discountPct, amountVnd: Math.floor((r.loanFeeVnd - off) / 1000) * 1000 };
}

export interface LateFeeRules {
  finePerDayVnd: number;
  graceDays: number;
}

/** Whole store days past the due date. */
export function daysLate(dueAt: Date, at: Date): number {
  return Math.max(0, storeDayNumber(at) - storeDayNumber(dueAt));
}

/** `min(cap, max(0, days_late − grace) × rate)`, the cap being the copy value (TDD §4.8). */
export function lateFee(dueAt: Date, at: Date, copyValueVnd: number, r: LateFeeRules): number {
  const fee = Math.max(0, daysLate(dueAt, at) - r.graceDays) * r.finePerDayVnd;
  return copyValueVnd > 0 ? Math.min(copyValueVnd, fee) : fee;
}

/** Lost or damaged copy: replacement value plus the processing fee (FR-LIB-11). */
export function replacementCharge(copyValueVnd: number, processingFeeVnd: number): number {
  return copyValueVnd + processingFeeVnd;
}

// =============================================================================================
// Eligibility (FR-LIB-07, FR-LIB-12, BR-15)

export type BorrowBlock = 'limit_reached' | 'overdue' | 'unpaid_charges';

export interface BorrowerState {
  openLoans: number;
  overdueLoans: number;
  unpaidChargesVnd: number;
}

/** Reasons a borrower cannot take `adding` more copies; empty when allowed. */
export function borrowBlocks(b: BorrowerState, maxLoans: number, adding = 1): BorrowBlock[] {
  const out: BorrowBlock[] = [];
  if (b.overdueLoans > 0) out.push('overdue');
  if (b.unpaidChargesVnd > 0) out.push('unpaid_charges');
  if (b.openLoans + adding > maxLoans) out.push('limit_reached');
  return out;
}

export const BORROW_BLOCK_TEXT: Record<BorrowBlock, string> = {
  overdue: 'Khách đang có sách quá hạn.',
  unpaid_charges: 'Khách còn phí thư viện chưa thanh toán.',
  limit_reached: 'Khách đã mượn đủ số cuốn tối đa.',
};

