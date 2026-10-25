import { BP_100, divRoundHalfUp, vnd, type Bp, type Vnd } from './money.js';

/** Movement types (FR-INV-03, TDD §4.2). */
export const MOVEMENT_TYPES = [
  'stock_in',
  'sale',
  'customer_return',
  'consignment_receipt',
  'consignment_return',
  'adjustment',
  'count',
  'write_off',
  'bundle_use',
  'library_transfer',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Moving-average cost on stock-in (FR-INV-08, TDD §4.2):
 * avg = round_half_up((on_hand × avg + qty × unit) / (on_hand + qty)).
 * When on hand is zero or negative (offline oversell), the new unit cost becomes the average.
 */
export function movingAverageCost(onHand: number, avgCost: Vnd, qtyIn: number, unitCost: Vnd): Vnd {
  if (qtyIn <= 0) throw new RangeError('Stock-in quantity must be positive');
  if (onHand <= 0) return unitCost;
  return vnd(divRoundHalfUp(onHand * avgCost + qtyIn * unitCost, onHand + qtyIn));
}

export function available(onHand: number, reserved: number): number {
  return onHand - reserved;
}

/**
 * Margin check at stock-in (FR-PUR-05): flag when the selling price, net of VAT, leaves less than
 * `minMarginBp` over the cost (and always when it is at or below cost).
 */
export function marginBp(sellingNetVnd: Vnd, costVnd: Vnd): Bp {
  if (sellingNetVnd <= 0) return -BP_100;
  return Math.floor(((sellingNetVnd - costVnd) * BP_100) / sellingNetVnd);
}

export function isMarginTooLow(sellingNetVnd: Vnd, costVnd: Vnd, minMarginBp: Bp): boolean {
  if (sellingNetVnd <= costVnd) return true;
  return marginBp(sellingNetVnd, costVnd) < minMarginBp;
}

/** Value of an adjustment for the approval threshold (FR-INV-07). */
export function adjustmentValue(qtyDelta: number, avgCost: Vnd): Vnd {
  return vnd(Math.abs(qtyDelta) * avgCost);
}
