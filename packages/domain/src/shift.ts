import { vnd, type Vnd } from './money.js';

/**
 * Shift cash (FR-POS-18..20, BR-06, TDD §4.4). Closing is never blocked and needs no approval;
 * a non-zero variance needs a reason; above the threshold managers are notified.
 */
export interface ShiftCashInputs {
  floatVnd: Vnd;
  cashSalesVnd: Vnd;
  cashRefundsVnd: Vnd;
  cashInVnd: Vnd;
  cashOutVnd: Vnd;
}

export function expectedCash(s: ShiftCashInputs): Vnd {
  return vnd(s.floatVnd + s.cashSalesVnd - s.cashRefundsVnd + s.cashInVnd - s.cashOutVnd);
}

/** Vietnamese banknotes for the denomination counter (Design §13.6). */
export const DENOMINATIONS_VND = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000] as const;

export function countDenominations(counts: Readonly<Partial<Record<number, number>>>): Vnd {
  let total = 0;
  for (const d of DENOMINATIONS_VND) total += d * (counts[d] ?? 0);
  return vnd(total);
}

export type ShiftCloseCheck =
  | { ok: true; varianceVnd: Vnd; alert: boolean }
  | { ok: false; code: 'variance_reason_required'; varianceVnd: Vnd };

export function checkShiftClose(
  expected: Vnd,
  counted: Vnd,
  reason: string | null | undefined,
  alertThresholdVnd: number,
): ShiftCloseCheck {
  const variance = vnd(counted - expected);
  if (variance !== 0 && !reason?.trim()) return { ok: false, code: 'variance_reason_required', varianceVnd: variance };
  return { ok: true, varianceVnd: variance, alert: Math.abs(variance) > alertThresholdVnd };
}
