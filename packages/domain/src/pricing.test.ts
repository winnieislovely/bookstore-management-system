import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { vnd } from './money.js';
import { priceCart, type CartLineInput, type PriceCartInput, type PromotionSnapshot } from './pricing.js';
import { PromotionRule } from './promotions.js';

const settings: PriceCartInput['settings'] = {
  cashierDiscountMaxBp: 1000,
  earnVndPerPoint: 10000,
  pointValueVnd: 100,
  minRedeemPoints: 50,
  categoryMaxDiscountBp: {},
};

const book = (over: Partial<CartLineInput> = {}): CartLineInput => ({
  lineId: 'l1',
  variantId: 'v-book',
  itemClass: 'goods',
  categoryIds: ['c-children'],
  qty: 1,
  unitPriceVnd: vnd(98000),
  vatBp: 0,
  ...over,
});

const pen = (over: Partial<CartLineInput> = {}): CartLineInput => ({
  lineId: 'l2',
  variantId: 'v-pen',
  itemClass: 'goods',
  categoryIds: ['c-stationery'],
  qty: 3,
  unitPriceVnd: vnd(6000),
  vatBp: 1000,
  ...over,
});

const promo = (id: string, rule: unknown, name = id): PromotionSnapshot => ({
  promotionId: id,
  versionId: `${id}-v1`,
  name,
  rule: PromotionRule.parse(rule),
});

const run = (over: Partial<PriceCartInput>) =>
  priceCart({
    lines: [book(), pen()],
    channel: 'counter',
    promotions: [],
    settings,
    grants: { discountUnlimited: false, priceOverride: false },
    ...over,
  });

describe('priceCart', () => {
  it('totals a plain cart with VAT included (BR-02)', () => {
    const r = run({});
    expect(r.subtotalVnd).toBe(116000);
    expect(r.totalVnd).toBe(116000);
    expect(r.lines[1]!.vatVnd).toBe(1636); // 18000 × 10/110 = 1636.36
    expect(r.pointsToEarn).toBe(0); // no customer attached
  });

  it('applies percent promotions on a category', () => {
    const r = run({ promotions: [promo('p1', { type: 'percent', percentBp: 1000, scope: { kind: 'category', categoryIds: ['c-children'] } })] });
    expect(r.lines[0]!.promoDiscountVnd).toBe(9800);
    expect(r.totalVnd).toBe(116000 - 9800);
    expect(r.appliedPromotionVersionIds).toEqual(['p1-v1']);
  });

  it('buy 2 get 1 free on the cheapest units', () => {
    const r = run({ promotions: [promo('p2', { type: 'buy_x_get_y', buyQty: 2, getQty: 1, scope: { kind: 'product', variantIds: ['v-pen'] } })] });
    expect(r.lines[1]!.promoDiscountVnd).toBe(6000);
    expect(r.lines[1]!.savings[0]!.amountVnd).toBe(6000);
  });

  it('bundle price', () => {
    const r = run({
      lines: [pen({ qty: 5 })],
      promotions: [promo('p3', { type: 'bundle_price', bundleQty: 2, bundlePriceVnd: 10000, scope: { kind: 'product', variantIds: ['v-pen'] } })],
    });
    expect(r.lines[0]!.promoDiscountVnd).toBe(4000); // two bundles save 2000 each
  });

  it('non-stackable promotions do not combine; stackable ones do', () => {
    const a = promo('a', { type: 'percent', percentBp: 1000, priority: 2, scope: { kind: 'category', categoryIds: ['c-children'] } });
    const b = promo('b', { type: 'fixed', amountVnd: 5000, priority: 1, scope: { kind: 'product', variantIds: ['v-book'] } });
    expect(run({ promotions: [a, b] }).lines[0]!.promoDiscountVnd).toBe(9800);
    const bStack = promo('b', { type: 'fixed', amountVnd: 5000, priority: 1, stackable: true, scope: { kind: 'product', variantIds: ['v-book'] } });
    const aStack = { ...a, rule: { ...a.rule, stackable: true } } as PromotionSnapshot;
    expect(run({ promotions: [aStack, bStack] }).lines[0]!.discountVnd).toBe(14800);
  });

  it('fixed amounts are taken once per order, whatever the scope (FR-PRM-01)', () => {
    const r = run({ promotions: [promo('f', { type: 'fixed', amountVnd: 2000, scope: { kind: 'product', variantIds: ['v-pen'] } })] });
    expect(r.lines[1]!.discountVnd).toBe(2000); // not 2000 × 3 units
    expect(r.discountVnd).toBe(2000);
  });

  it('order-level discount is allocated across lines and sums exactly', () => {
    const r = run({ promotions: [promo('o', { type: 'fixed', amountVnd: 10000, scope: { kind: 'order' } })] });
    expect(r.discountVnd).toBe(10000);
    expect(r.lines.reduce((a, l) => a + l.orderDiscountVnd, 0)).toBe(10000);
    expect(r.totalVnd).toBe(106000);
  });

  it('respects minimum order value and channel conditions', () => {
    const p = promo('m', { type: 'percent', percentBp: 500, scope: { kind: 'order' }, conditions: { minOrderVnd: 200000 } });
    expect(run({ promotions: [p] }).discountVnd).toBe(0);
    const w = promo('w', { type: 'percent', percentBp: 500, scope: { kind: 'order' }, conditions: { channels: ['website'] } });
    expect(run({ promotions: [w] }).discountVnd).toBe(0);
  });

  it('coupon codes must match (case-insensitive) and unknown coupons are reported', () => {
    const c = promo('c', { type: 'fixed', amountVnd: 20000, scope: { kind: 'order' }, conditions: { couponCode: 'SACH20' } });
    expect(run({ promotions: [c] }).discountVnd).toBe(0);
    const ok = run({ promotions: [c], couponCode: 'sach20' });
    expect(ok.discountVnd).toBe(20000);
    expect(ok.couponApplied).toBe(true);
    expect(run({ promotions: [c], couponCode: 'NOPE' }).issues).toContainEqual({ code: 'coupon_not_found', couponCode: 'NOPE' });
  });

  it('caps automatic discounts per category (FR-PRM-05)', () => {
    const r = run({
      promotions: [promo('big', { type: 'percent', percentBp: 3000, scope: { kind: 'category', categoryIds: ['c-children'] } })],
      settings: { ...settings, categoryMaxDiscountBp: { 'c-children': 1500 } },
    });
    expect(r.lines[0]!.promoDiscountVnd).toBe(14700);
  });

  it('requires approval above the cashier limit (BR-05) unless unlimited', () => {
    const lines = [book({ manualDiscount: { kind: 'percent', bp: 1500 } })];
    expect(run({ lines }).approvalsRequired).toEqual([{ code: 'discount_over_limit', lineId: 'l1', discountBp: 1500, limitBp: 1000 }]);
    expect(run({ lines, grants: { discountUnlimited: true, priceOverride: false } }).approvalsRequired).toEqual([]);
    expect(run({ lines: [book({ manualDiscount: { kind: 'percent', bp: 1000 } })] }).approvalsRequired).toEqual([]);
  });

  it('price override needs permission or approval', () => {
    const r = run({ lines: [book({ priceOverrideVnd: vnd(80000) })] });
    expect(r.totalVnd).toBe(80000);
    expect(r.approvalsRequired).toEqual([{ code: 'price_override', lineId: 'l1' }]);
  });

  it('applies tier discounts to goods and earns points on net spend (BR-07)', () => {
    const customer = { tierCode: 'silver', tierDiscountBp: 500, pointsMultiplierBp: 10000, pointsBalance: 120 };
    const r = run({ customer });
    expect(r.lines[0]!.tierDiscountVnd).toBe(4900);
    expect(r.totalVnd).toBe(116000 - 4900 - 900);
    expect(r.pointsToEarn).toBe(11); // 110.200 / 10.000
  });

  it('event tickets, deposits and fines earn no points; deposits are never discounted', () => {
    const customer = { tierCode: 'gold', tierDiscountBp: 1000, pointsMultiplierBp: 10000, pointsBalance: 0 };
    const r = run({
      customer,
      lines: [
        { lineId: 'd', variantId: 'svc-deposit', itemClass: 'library_deposit', categoryIds: [], qty: 1, unitPriceVnd: vnd(200000), vatBp: 0 },
        { lineId: 't', variantId: 'svc-ticket', itemClass: 'event_ticket', categoryIds: [], qty: 1, unitPriceVnd: vnd(100000), vatBp: 0 },
      ],
      promotions: [promo('o', { type: 'percent', percentBp: 1000, scope: { kind: 'order' } })],
    });
    expect(r.discountVnd).toBe(0);
    expect(r.pointsToEarn).toBe(0);
  });

  it('redeemed points are a discount, not a payment (FR-POS-05, BR-07)', () => {
    const customer = { tierCode: 'standard', tierDiscountBp: 0, pointsMultiplierBp: 10000, pointsBalance: 500 };
    const r = run({ customer, redeemPoints: 110 }); // 11.000 ₫
    expect(r.redeemValueVnd).toBe(11000);
    expect(r.discountVnd).toBe(11000);
    expect(r.totalVnd).toBe(105000);
    expect(r.lines.reduce((a, l) => a + l.pointsDiscountVnd, 0)).toBe(11000);
    // VAT is computed on the net line amount after the points discount.
    const pen = r.lines[1]!;
    expect(pen.vatVnd).toBe(Math.round((pen.totalVnd * 1000) / 11000));
  });

  it('validates points redemption (BR-07)', () => {
    const customer = { tierCode: 'standard', tierDiscountBp: 0, pointsMultiplierBp: 10000, pointsBalance: 120 };
    expect(run({ customer, redeemPoints: 40 }).issues).toContainEqual({ code: 'points_below_minimum', minimum: 50 });
    expect(run({ customer, redeemPoints: 200 }).issues).toContainEqual({ code: 'points_exceed_balance', balance: 120 });
    const ok = run({ customer, redeemPoints: 100 });
    expect(ok.redeemValueVnd).toBe(10000);
    expect(ok.totalVnd).toBe(106000);
    expect(ok.pointsToEarn).toBe(10); // earned on net spend after the points discount
  });

  it('free shipping and gifts', () => {
    const r = run({
      shippingVnd: vnd(30000),
      promotions: [
        promo('fs', { type: 'free_shipping', scope: { kind: 'order' } }),
        promo('g', { type: 'gift', giftVariantId: 'v-bookmark', scope: { kind: 'order' } }),
      ],
    });
    expect(r.shippingDiscountVnd).toBe(30000);
    expect(r.totalVnd).toBe(116000);
    expect(r.gifts).toEqual([{ variantId: 'v-bookmark', qty: 1, promotionId: 'g' }]);
  });

  it('property: total = sum of line totals, no line negative, VAT ≤ line total', () => {
    const lineArb = fc.record({
      qty: fc.integer({ min: 1, max: 20 }),
      price: fc.integer({ min: 0, max: 2_000_000 }),
      vat: fc.constantFrom(0, 500, 800, 1000),
      cat: fc.constantFrom('c1', 'c2'),
      manualBp: fc.option(fc.integer({ min: 0, max: 10000 }), { nil: undefined }),
    });
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 8 }), fc.integer({ min: 1, max: 10000 }), (ls, pct) => {
        const lines: CartLineInput[] = ls.map((l, i) => ({
          lineId: `l${i}`,
          variantId: `v${i}`,
          itemClass: 'goods',
          categoryIds: [l.cat],
          qty: l.qty,
          unitPriceVnd: vnd(l.price),
          vatBp: l.vat,
          manualDiscount: l.manualBp === undefined ? null : { kind: 'percent', bp: l.manualBp },
        }));
        const r = run({
          lines,
          promotions: [
            promo('a', { type: 'percent', percentBp: pct, scope: { kind: 'category', categoryIds: ['c1'] } }),
            promo('o', { type: 'fixed', amountVnd: 15000, stackable: true, scope: { kind: 'order' } }),
          ],
        });
        expect(r.lines.reduce((a, l) => a + l.totalVnd, 0)).toBe(r.totalVnd);
        expect(r.subtotalVnd - r.discountVnd).toBe(r.totalVnd);
        for (const l of r.lines) {
          expect(l.totalVnd).toBeGreaterThanOrEqual(0);
          expect(l.vatVnd).toBeLessThanOrEqual(l.totalVnd);
          expect(Number.isInteger(l.totalVnd)).toBe(true);
        }
      }),
    );
  });
});
