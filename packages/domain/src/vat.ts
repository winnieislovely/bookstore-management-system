import { BP_100, divRoundHalfUp, vnd, type Bp, type Vnd } from './money.js';

/**
 * Selling prices include VAT (BR-02). The VAT contained in a gross amount is
 * gross × rate / (1 + rate), rounded half-up to the dong.
 */
export function vatIncluded(gross: Vnd, vatBp: Bp): Vnd {
  if (vatBp === 0) return vnd(0);
  return vnd(divRoundHalfUp(gross * vatBp, BP_100 + vatBp));
}

export function netOfVat(gross: Vnd, vatBp: Bp): Vnd {
  return vnd(gross - vatIncluded(gross, vatBp));
}

/** Standard Vietnamese VAT rates in basis points. */
export const VAT_RATES_BP = [0, 500, 800, 1000] as const;
