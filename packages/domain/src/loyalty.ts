import { allocate, vnd, type Vnd } from './money.js';

/**
 * Loyalty (FR-CRM-04..07, BR-07, BR-08, BR-19). The points ledger is append-only; these helpers
 * compute the deltas the ledger records.
 */

export interface TierDef {
  code: string;
  name: string;
  minSpendVnd: Vnd;
}

/** Default tiers (BR-08); thresholds come from settings. */
export function defaultTiers(silverVnd: number, goldVnd: number): TierDef[] {
  return [
    { code: 'standard', name: 'Thường', minSpendVnd: vnd(0) },
    { code: 'silver', name: 'Bạc', minSpendVnd: vnd(silverVnd) },
    { code: 'gold', name: 'Vàng', minSpendVnd: vnd(goldVnd) },
  ];
}

/** Highest tier whose threshold the rolling-12-month net spend reaches. */
export function tierForSpend(spend12mVnd: number, tiers: readonly TierDef[]): TierDef {
  const sorted = [...tiers].sort((a, b) => b.minSpendVnd - a.minSpendVnd);
  const tier = sorted.find((t) => spend12mVnd >= t.minSpendVnd) ?? sorted[sorted.length - 1];
  if (!tier) throw new Error('No tiers configured');
  return tier;
}

/**
 * Points to reverse when part of a sale is returned (FR-POS-13, BR-19): proportional to the share
 * of the earning amount returned, never more than was earned, rounded half-up.
 */
export function pointsToReverse(earned: number, earningTotalVnd: number, returnedEarningVnd: number): number {
  if (earned <= 0 || earningTotalVnd <= 0 || returnedEarningVnd <= 0) return 0;
  if (returnedEarningVnd >= earningTotalVnd) return earned;
  const [reversed] = allocate(vnd(earned), [returnedEarningVnd, earningTotalVnd - returnedEarningVnd]);
  return reversed ?? 0;
}

/** Expiry date for points earned at `earnedAt` (BR-07: 12 months by default). */
export function pointsExpiry(earnedAt: Date, expiryMonths: number): Date {
  const d = new Date(earnedAt.getTime());
  d.setUTCMonth(d.getUTCMonth() + expiryMonths);
  return d;
}
