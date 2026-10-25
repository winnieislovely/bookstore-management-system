import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocate, applyBp, divRoundHalfUp, formatVnd, parseVnd, vnd } from './money.js';
import { vatIncluded } from './vat.js';

describe('divRoundHalfUp', () => {
  it('rounds half up, symmetric for negatives', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 2)).toBe(2);
    expect(divRoundHalfUp(7, 3)).toBe(2);
    expect(divRoundHalfUp(-5, 2)).toBe(-3);
    expect(divRoundHalfUp(0, 7)).toBe(0);
  });
});

describe('applyBp', () => {
  it('computes percentage discounts in whole dong (BR-01)', () => {
    expect(applyBp(vnd(98000), 1000)).toBe(9800);
    expect(applyBp(vnd(12345), 1500)).toBe(1852); // 1851.75 → 1852
    expect(applyBp(vnd(5), 1000)).toBe(1); // 0.5 → 1
  });
});

describe('allocate', () => {
  it('splits exactly, never losing a dong', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          const parts = allocate(vnd(total), weights);
          expect(parts).toHaveLength(weights.length);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
        },
      ),
    );
  });

  it('is proportional', () => {
    expect(allocate(vnd(100), [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(vnd(10000), [30000, 10000])).toEqual([7500, 2500]);
  });

  it('stays exact beyond 2^53 intermediate products', () => {
    const parts = allocate(vnd(900_000_000_000), [4_000_000, 5_000_000]);
    expect(parts[0]! + parts[1]!).toBe(900_000_000_000);
  });
});

describe('formatting', () => {
  it('formats VND per Design §14.3', () => {
    expect(formatVnd(1234567)).toBe('1.234.567 ₫');
    expect(formatVnd(-50000)).toBe('−50.000 ₫');
  });
  it('parses pasted amounts', () => {
    expect(parseVnd('1,234,567')).toBe(1234567);
    expect(parseVnd('1234567đ')).toBe(1234567);
    expect(parseVnd('1.234.567')).toBe(1234567);
    expect(parseVnd('abc')).toBeNull();
  });
});

describe('VAT (BR-02, prices include VAT)', () => {
  it('extracts VAT from gross', () => {
    expect(vatIncluded(vnd(110000), 1000)).toBe(10000);
    expect(vatIncluded(vnd(105000), 500)).toBe(5000);
    expect(vatIncluded(vnd(98000), 0)).toBe(0);
  });
});
