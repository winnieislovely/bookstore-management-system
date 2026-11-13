import { z } from 'zod';

/**
 * Promotion rules (FR-PRM-01..05, TDD §4.9): a Zod discriminated union stored as JSON on each
 * `promotion_version`. Sales record the version ids they applied.
 */
const id = z.string().min(1);

export const PromotionScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('order') }),
  z.object({ kind: z.literal('product'), variantIds: z.array(id).min(1) }),
  z.object({ kind: z.literal('category'), categoryIds: z.array(id).min(1) }),
  z.object({ kind: z.literal('publisher'), publisherIds: z.array(id).min(1) }),
  z.object({ kind: z.literal('brand'), brandIds: z.array(id).min(1) }),
  z.object({ kind: z.literal('event_ticket') }),
  z.object({ kind: z.literal('tier'), tierCodes: z.array(z.string()).min(1) }),
]);
export type PromotionScope = z.infer<typeof PromotionScope>;

export const SalesChannel = z.enum(['counter', 'website', 'social']);
export type SalesChannel = z.infer<typeof SalesChannel>;

export const PromotionConditions = z.object({
  minOrderVnd: z.number().int().min(0).optional(),
  channels: z.array(SalesChannel).min(1).optional(),
  /** Withdrawn 13 Nov 2026 (FR-PRM-01): kept only so old versions still parse; a rule with a code never applies. */
  couponCode: z.string().min(1).optional(),
  perCustomerLimit: z.number().int().min(1).optional(),
  totalLimit: z.number().int().min(1).optional(),
});

const base = {
  scope: PromotionScope,
  conditions: PromotionConditions.default({}),
  /** Higher priority is applied first. */
  priority: z.number().int().default(0),
  /** A non-stackable promotion never combines with another promotion on the same line. */
  stackable: z.boolean().default(false),
};

export const PromotionRule = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), percentBp: z.number().int().min(1).max(10000), ...base }),
  /** Fixed amount: taken once per order, spread over the lines in scope (FR-PRM-01). */
  z.object({ type: z.literal('fixed'), amountVnd: z.number().int().min(1), ...base }),
  z.object({
    type: z.literal('buy_x_get_y'),
    buyQty: z.number().int().min(1),
    getQty: z.number().int().min(1),
    /** Discount on the "get" units; 10000 = free. */
    getDiscountBp: z.number().int().min(1).max(10000).default(10000),
    ...base,
  }),
  z.object({
    type: z.literal('bundle_price'),
    bundleQty: z.number().int().min(2),
    bundlePriceVnd: z.number().int().min(0),
    ...base,
  }),
  z.object({ type: z.literal('free_shipping'), ...base }),
  z.object({
    type: z.literal('gift'),
    giftVariantId: id,
    giftQty: z.number().int().min(1).default(1),
    ...base,
  }),
]);
export type PromotionRule = z.infer<typeof PromotionRule>;

/** Visible promotion state (FR-PRM-04). */
export type PromotionState = 'scheduled' | 'running' | 'paused' | 'expired';

export function promotionState(
  p: { paused: boolean; startsAt: Date; endsAt: Date | null },
  now: Date,
): PromotionState {
  if (p.endsAt && now >= p.endsAt) return 'expired';
  if (now < p.startsAt) return 'scheduled';
  return p.paused ? 'paused' : 'running';
}
