import { schema } from '@bookstore/db';
import { promotionState, PromotionRule, type PromotionSnapshot, type SalesChannel } from '@bookstore/domain';
import { and, asc, count, desc, eq, inArray, isNull, lte, or, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import { errors, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/**
 * Promotions (FR-PRM-01..06, TDD §4.9). Each edit creates a `promotion_version`; sales store the
 * version they applied. There are no coupon codes (FR-PRM-01).
 */

export const PromotionSchema = z.object({
  name: z.string().trim().min(1).max(160),
  // No coupon codes (FR-PRM-01): a programme applies by itself to the orders that meet its conditions.
  rule: PromotionRule.refine((r) => !r.conditions.couponCode, { message: 'Khuyến mãi không dùng mã giảm giá.' }),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable().default(null),
});

export async function create(ctx: Ctx, input: z.input<typeof PromotionSchema>) {
  const actor = requirePermission(ctx, 'promotion.manage');
  const data = PromotionSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.insert(schema.promotion).values({ name: data.name, createdBy: actor.userId }).returning({ id: schema.promotion.id });
    const [v] = await tx
      .insert(schema.promotionVersion)
      .values({ promotionId: p!.id, version: 1, rule: data.rule, startsAt: new Date(data.startsAt), endsAt: data.endsAt ? new Date(data.endsAt) : null, createdBy: actor.userId })
      .returning({ id: schema.promotionVersion.id });
    await tx.update(schema.promotion).set({ currentVersionId: v!.id }).where(eq(schema.promotion.id, p!.id));
    await audit.record(tx, ctx, { action: 'promotion.create', entity: 'promotion', entityId: p!.id, after: data });
    return { id: p!.id, versionId: v!.id };
  });
}

export const PromotionUpdateSchema = PromotionSchema.extend({ version: z.number().int() });

/** Edit = a new version (TDD §4.9); sales keep pointing at the version they applied. */
export async function update(ctx: Ctx, id: string, input: z.input<typeof PromotionUpdateSchema>) {
  const actor = requirePermission(ctx, 'promotion.manage');
  const data = PromotionUpdateSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.promotion).where(eq(schema.promotion.id, id)).for('update');
    if (!p) throw errors.notFound('Khuyến mãi');
    if (p.version !== data.version) throw errors.stale();
    const [last] = await tx.select({ n: sql<number>`max(${schema.promotionVersion.version})::int` }).from(schema.promotionVersion).where(eq(schema.promotionVersion.promotionId, id));
    const [v] = await tx
      .insert(schema.promotionVersion)
      .values({ promotionId: id, version: (last?.n ?? 0) + 1, rule: data.rule, startsAt: new Date(data.startsAt), endsAt: data.endsAt ? new Date(data.endsAt) : null, createdBy: actor.userId })
      .returning({ id: schema.promotionVersion.id });
    await tx.update(schema.promotion).set({ name: data.name, currentVersionId: v!.id, updatedAt: ctx.clock.now(), version: p.version + 1 }).where(eq(schema.promotion.id, id));
    await audit.record(tx, ctx, { action: 'promotion.update', entity: 'promotion', entityId: id, after: data });
    return { versionId: v!.id, version: p.version + 1 };
  });
}

export async function setPaused(ctx: Ctx, id: string, paused: boolean) {
  requirePermission(ctx, 'promotion.manage');
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx.update(schema.promotion).set({ paused, updatedAt: ctx.clock.now() }).where(eq(schema.promotion.id, id)).returning({ id: schema.promotion.id });
    if (!row) throw errors.notFound('Khuyến mãi');
    await audit.record(tx, ctx, { action: paused ? 'promotion.pause' : 'promotion.resume', entity: 'promotion', entityId: id });
  });
}

export async function list(ctx: Ctx) {
  requirePermission(ctx, 'promotion.manage');
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select({ p: schema.promotion, v: schema.promotionVersion })
    .from(schema.promotion)
    .innerJoin(schema.promotionVersion, eq(schema.promotionVersion.id, schema.promotion.currentVersionId))
    .orderBy(desc(schema.promotion.createdAt));
  return rows.map(({ p, v }) => ({
    id: p.id,
    name: p.name,
    state: promotionState({ paused: p.paused, startsAt: v.startsAt, endsAt: v.endsAt }, now),
    rule: v.rule,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    versionId: v.id,
    version: p.version,
  }));
}

/**
 * Snapshot of the promotions running now, as the pricing engine takes it (TDD §4.4). Usage limits
 * (FR-PRM-03) are counted here so the pure engine only sees whether a promotion is used up.
 */
export async function activeSnapshot(tx: Tx, now: Date, _channel: SalesChannel, customerId: string | null): Promise<PromotionSnapshot[]> {
  const p = schema.promotion;
  const v = schema.promotionVersion;
  const rows = await tx
    .select({ promotionId: p.id, name: p.name, versionId: v.id, rule: v.rule })
    .from(p)
    .innerJoin(v, eq(v.id, p.currentVersionId))
    .where(and(eq(p.paused, false), lte(v.startsAt, now), or(isNull(v.endsAt), gt(v.endsAt, now))))
    .orderBy(asc(p.createdAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.promotionId);
  const totals = await tx.select({ id: schema.promotionUsage.promotionId, n: count() }).from(schema.promotionUsage).where(inArray(schema.promotionUsage.promotionId, ids)).groupBy(schema.promotionUsage.promotionId);
  const mine = customerId
    ? await tx
        .select({ id: schema.promotionUsage.promotionId, n: count() })
        .from(schema.promotionUsage)
        .where(and(inArray(schema.promotionUsage.promotionId, ids), eq(schema.promotionUsage.customerId, customerId)))
        .groupBy(schema.promotionUsage.promotionId)
    : [];
  return rows.map((r) => {
    const rule = PromotionRule.parse(r.rule);
    const used = totals.find((t) => t.id === r.promotionId)?.n ?? 0;
    const usedByCustomer = mine.find((t) => t.id === r.promotionId)?.n ?? 0;
    const exhausted =
      (rule.conditions.totalLimit != null && used >= rule.conditions.totalLimit) ||
      (rule.conditions.perCustomerLimit != null && (customerId === null || usedByCustomer >= rule.conditions.perCustomerLimit));
    return { promotionId: r.promotionId, versionId: r.versionId, name: r.name, rule, usageExhausted: exhausted };
  });
}

/** Record use of the promotions a sale or order applied (FR-PRM-06). */
export async function recordUsage(
  tx: Tx,
  uses: { promotionId: string; discountVnd: number; revenueVnd: number }[],
  ref: { refType: string; refId: string; customerId: string | null },
): Promise<void> {
  for (const u of uses) {
    await tx.insert(schema.promotionUsage).values({ promotionId: u.promotionId, customerId: ref.customerId, refType: ref.refType, refId: ref.refId, discountVnd: u.discountVnd, revenueVnd: u.revenueVnd });
  }
}
