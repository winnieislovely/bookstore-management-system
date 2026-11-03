import { describe, expect, it } from 'vitest';
import { initialOrderStatus, pickupCodeFromBytes, pricingChannel, reviewReasons, type ReviewInput } from './orders.js';

const base: ReviewInput = {
  allReserved: true,
  delivery: 'ship',
  addressResolvable: true,
  paymentMethod: 'cod',
  paid: false,
  totalVnd: 150_000,
  failedDeliveries: 0,
  settings: { highValueVnd: 2_000_000, failedDeliveries: 2 },
};

describe('order review flags (FR-ORD-04, BR-30)', () => {
  it('passes a clean COD order', () => {
    expect(reviewReasons(base)).toEqual([]);
    expect(initialOrderStatus([])).toBe('new');
  });

  it('flags each rule', () => {
    expect(reviewReasons({ ...base, allReserved: false })).toEqual(['out_of_stock']);
    expect(reviewReasons({ ...base, addressResolvable: false })).toEqual(['incomplete_address']);
    expect(reviewReasons({ ...base, delivery: 'pickup', addressResolvable: false })).toEqual([]);
    expect(reviewReasons({ ...base, paymentMethod: 'transfer' })).toEqual(['unpaid_transfer']);
    expect(reviewReasons({ ...base, paymentMethod: 'transfer', paid: true })).toEqual([]);
    expect(reviewReasons({ ...base, totalVnd: 2_000_000 })).toEqual(['high_value']);
    expect(reviewReasons({ ...base, failedDeliveries: 2 })).toEqual(['suspected_abuse']);
  });

  it('turns a flag off with 0', () => {
    expect(reviewReasons({ ...base, totalVnd: 9_000_000, failedDeliveries: 9, settings: { highValueVnd: 0, failedDeliveries: 0 } })).toEqual([]);
  });

  it('keeps an unpaid transfer order New, anything else goes to review (UC-08)', () => {
    expect(initialOrderStatus(['unpaid_transfer'])).toBe('new');
    expect(initialOrderStatus(['unpaid_transfer', 'high_value'])).toBe('pending_review');
  });
});

describe('order helpers', () => {
  it('prices website orders on the website channel and the rest as social (FR-PRM-03)', () => {
    expect(pricingChannel('website')).toBe('website');
    expect(pricingChannel('zalo')).toBe('social');
    expect(pricingChannel('phone')).toBe('social');
  });

  it('makes six-digit pickup codes', () => {
    expect(pickupCodeFromBytes(new Uint8Array([0, 0, 0, 7]))).toBe('000007');
    expect(pickupCodeFromBytes(new Uint8Array([255, 255, 255, 255]))).toMatch(/^\d{6}$/);
  });
});
