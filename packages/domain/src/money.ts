/**
 * Money is integer VND (TDD §3.6, BR-01). Amounts are whole dong; percentages are basis points
 * (1 % = 100 bp). Every division goes through `divRoundHalfUp`, so no floating-point arithmetic
 * ever touches money.
 */

declare const vndBrand: unique symbol;
export type Vnd = number & { readonly [vndBrand]: 'Vnd' };

/** Basis points: 10000 = 100 %. */
export type Bp = number;

export const BP_100 = 10_000;

export function vnd(n: number): Vnd {
  if (!Number.isSafeInteger(n)) throw new RangeError(`VND amount must be a safe integer, got ${n}`);
  return n as Vnd;
}

/** Integer division rounded half-up (away from zero for .5), BR-01. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new RangeError('divRoundHalfUp expects safe integers');
  }
  if (denominator === 0) throw new RangeError('Division by zero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.trunc(n / d);
  const r = n - q * d;
  const rounded = r * 2 >= d ? q + 1 : q;
  return sign * rounded || 0;
}

/** amount × bp / 10000, rounded half-up. */
export function applyBp(amount: Vnd, bp: Bp): Vnd {
  return vnd(divRoundHalfUp(amount * bp, BP_100));
}

export function sum(values: readonly Vnd[]): Vnd {
  let total = 0;
  for (const v of values) total += v;
  return vnd(total);
}

/**
 * Split `total` across `weights` proportionally so that the parts always add up to `total`
 * exactly (largest-remainder method). Used to spread order-level discounts over lines and to
 * reverse points proportionally on returns, so rounding never loses a dong.
 */
export function allocate(total: Vnd, weights: readonly number[]): Vnd[] {
  if (weights.length === 0) return [];
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
    throw new RangeError('allocate expects non-negative integer weights');
  }
  // BigInt keeps total × weight exact even when it exceeds 2^53.
  const big = weights.map((w) => BigInt(w));
  const weightSum = big.reduce((a, b) => a + b, 0n);
  if (weightSum === 0n) return weights.map((_, i) => vnd(i === 0 ? total : 0));
  const sign = total < 0 ? -1 : 1;
  const abs = BigInt(Math.abs(total));
  const parts = big.map((w) => (abs * w) / weightSum);
  let remainder = abs - parts.reduce((a, b) => a + b, 0n);
  const order = big
    .map((w, i) => ({ i, frac: (abs * w) % weightSum }))
    .sort((a, b) => (a.frac === b.frac ? a.i - b.i : a.frac > b.frac ? -1 : 1));
  for (let k = 0; remainder > 0n; k = (k + 1) % order.length, remainder--) {
    const idx = order[k]!.i;
    parts[idx] = parts[idx]! + 1n;
  }
  return parts.map((p) => vnd(sign * Number(p)));
}

const vndFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/** `1.234.567 ₫`, negative as `−50.000 ₫` (Design §14.3). */
export function formatVnd(amount: Vnd | number): string {
  const s = vndFormatter.format(Math.abs(amount));
  return `${amount < 0 ? '−' : ''}${s} ₫`;
}

/**
 * Parse staff input such as "1.234.567", "1,234,567" or "1234567đ" into whole VND
 * (Design §10.3, money input normalisation). Returns null when the input has no digits.
 */
export function parseVnd(input: string): Vnd | null {
  const negative = /^\s*[-−]/.test(input);
  const digits = input.replace(/[^0-9]/g, '');
  if (digits === '') return null;
  return vnd((negative ? -1 : 1) * Number(digits));
}
