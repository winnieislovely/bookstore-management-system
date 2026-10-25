import { schema } from '@bookstore/db';
import { defaultTiers, foldText, normalizePhone, pointsExpiry } from '@bookstore/domain';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as settings from '../settings/index.js';
import { AppError, errors, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/**
 * Customers and loyalty (FR-CRM-01..06, TDD §4.9). Phone is the unique key (BR-16). The points
 * ledger is append-only and `customer.points_balance` is kept equal to its sum in the same transaction.
 */

export const CustomerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(6),
  email: z.email().optional(),
  birthDate: z.iso.date().optional(),
  note: z.string().trim().max(1000).optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  source: z.string().trim().max(60).optional(),
});

function searchTextOf(c: { name: string; phoneE164: string | null; email: string | null }): string {
  const local = c.phoneE164?.startsWith('+84') ? `0${c.phoneE164.slice(3)}` : (c.phoneE164 ?? '');
  return foldText([c.name, c.phoneE164 ?? '', local, c.email ?? ''].join(' '));
}

export async function createCustomerTx(tx: Tx, ctx: Ctx, input: z.input<typeof CustomerSchema>) {
  const data = CustomerSchema.parse(input);
  const phoneE164 = normalizePhone(data.phone);
  if (!phoneE164) throw new AppError(400, 'invalid_phone', `Số điện thoại '${data.phone}' không hợp lệ.`);
  const [existing] = await tx.select({ id: schema.customer.id, name: schema.customer.name }).from(schema.customer).where(eq(schema.customer.phoneE164, phoneE164));
  if (existing) {
    throw errors.conflict('duplicate_phone', `Đã có khách hàng với số này: ${existing.name}.`, { customerId: existing.id });
  }
  const [standard] = await tx.select({ id: schema.tier.id }).from(schema.tier).orderBy(asc(schema.tier.minSpendVnd)).limit(1);
  const [row] = await tx
    .insert(schema.customer)
    .values({
      name: data.name,
      phoneE164,
      email: data.email ?? null,
      birthDate: data.birthDate ?? null,
      note: data.note ?? null,
      tags: data.tags,
      source: data.source ?? null,
      tierId: standard?.id ?? null,
      searchText: searchTextOf({ name: data.name, phoneE164, email: data.email ?? null }),
    })
    .returning();
  await audit.record(tx, ctx, { action: 'customer.create', entity: 'customer', entityId: row!.id });
  return row!;
}

export async function createCustomer(ctx: Ctx, input: z.input<typeof CustomerSchema>) {
  requirePermission(ctx, 'customer.manage');
  const row = await ctx.db.transaction((tx) => createCustomerTx(tx, ctx, input));
  return { id: row.id };
}

/** Find by phone (POS attach, FR-POS-04): exact on the normalised number. */
export async function findByPhone(ctx: Ctx, phone: string) {
  requirePermission(ctx, 'customer.view');
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  const [c] = await ctx.db
    .select({ c: schema.customer, tierCode: schema.tier.code, tierName: schema.tier.name })
    .from(schema.customer)
    .leftJoin(schema.tier, eq(schema.tier.id, schema.customer.tierId))
    .where(eq(schema.customer.phoneE164, e164));
  return c ? { ...c.c, tierCode: c.tierCode, tierName: c.tierName } : null;
}

/** Diacritic-insensitive search on name, phone and email (FR-CRM-02). */
export async function search(ctx: Ctx, q: string, limit = 40) {
  requirePermission(ctx, 'customer.view');
  const term = foldText(q).replace(/\s+/g, ' ');
  const digits = q.replace(/\D/g, '');
  return ctx.db
    .select({
      id: schema.customer.id,
      name: schema.customer.name,
      phoneE164: schema.customer.phoneE164,
      email: schema.customer.email,
      pointsBalance: schema.customer.pointsBalance,
      tierName: schema.tier.name,
    })
    .from(schema.customer)
    .leftJoin(schema.tier, eq(schema.tier.id, schema.customer.tierId))
    .where(
      and(
        sql`${schema.customer.anonymisedAt} is null`,
        digits.length >= 4 ? sql`(${schema.customer.searchText} like ${`%${term}%`} or ${schema.customer.phoneE164} like ${`%${digits.slice(-9)}%`})` : sql`${schema.customer.searchText} like ${`%${term}%`}`,
      ),
    )
    .orderBy(asc(schema.customer.name))
    .limit(limit);
}

export async function getCustomer(ctx: Ctx, id: string) {
  requirePermission(ctx, 'customer.view');
  const [c] = await ctx.db
    .select({ c: schema.customer, tierCode: schema.tier.code, tierName: schema.tier.name, benefits: schema.tier.benefits })
    .from(schema.customer)
    .leftJoin(schema.tier, eq(schema.tier.id, schema.customer.tierId))
    .where(eq(schema.customer.id, id));
  if (!c) throw errors.notFound('Khách hàng');
  const ledger = await ctx.db.select().from(schema.pointsLedger).where(eq(schema.pointsLedger.customerId, id)).orderBy(desc(schema.pointsLedger.at)).limit(50);
  const credit = await ctx.db.select().from(schema.storeCreditLedger).where(eq(schema.storeCreditLedger.customerId, id)).orderBy(desc(schema.storeCreditLedger.at)).limit(50);
  return { ...c.c, tierCode: c.tierCode, tierName: c.tierName, tierBenefits: c.benefits, pointsLedger: ledger, storeCreditLedger: credit };
}

/** Tier and points snapshot for the pricing engine. */
export async function pricingProfile(tx: Tx, customerId: string) {
  const [c] = await tx
    .select({ id: schema.customer.id, balance: schema.customer.pointsBalance, tierCode: schema.tier.code, benefits: schema.tier.benefits })
    .from(schema.customer)
    .leftJoin(schema.tier, eq(schema.tier.id, schema.customer.tierId))
    .where(eq(schema.customer.id, customerId));
  if (!c) throw errors.notFound('Khách hàng');
  return {
    tierCode: c.tierCode ?? 'standard',
    tierDiscountBp: c.benefits?.discountBp ?? 0,
    pointsMultiplierBp: c.benefits?.pointsMultiplierBp ?? 10000,
    pointsBalance: c.balance,
  };
}

// ---------------------------------------------------------------------------------------------
// Points ledger (FR-CRM-04, FR-CRM-06, BR-07, BR-19)

export interface PointsEntry {
  customerId: string;
  delta: number;
  reason: 'earn' | 'redeem' | 'return_reversal' | 'redeem_refund' | 'expire' | 'adjust' | 'import';
  refType?: string;
  refId?: string;
  note?: string;
}

/**
 * Append a ledger row and move the balance in the same statement pair. Debits are atomic and
 * conditional, so a balance never goes below zero; `floorAtZero` clamps instead of failing
 * (offline redemption over the real balance, TDD §7.6).
 */
export async function post(tx: Tx, ctx: Ctx, e: PointsEntry, opts: { floorAtZero?: boolean } = {}): Promise<number> {
  if (e.delta === 0) return 0;
  const c = schema.customer;
  let delta = e.delta;
  if (delta < 0) {
    const [row] = await tx
      .update(c)
      .set({ pointsBalance: sql`${c.pointsBalance} + ${delta}` })
      .where(and(eq(c.id, e.customerId), sql`${c.pointsBalance} + ${delta} >= 0`))
      .returning({ balance: c.pointsBalance });
    if (!row) {
      if (!opts.floorAtZero) throw new AppError(409, 'points_insufficient', 'Khách hàng không đủ điểm để đổi.');
      const [cur] = await tx.select({ b: c.pointsBalance }).from(c).where(eq(c.id, e.customerId)).for('update');
      delta = -(cur?.b ?? 0);
      if (delta === 0) return 0;
      await tx.update(c).set({ pointsBalance: 0 }).where(eq(c.id, e.customerId));
    }
  } else {
    await tx.update(c).set({ pointsBalance: sql`${c.pointsBalance} + ${delta}` }).where(eq(c.id, e.customerId));
  }
  const cfg = await settings.snapshot(ctx, tx);
  const now = ctx.clock.now();
  await tx.insert(schema.pointsLedger).values({
    customerId: e.customerId,
    delta,
    reason: e.reason,
    refType: e.refType ?? null,
    refId: e.refId ?? null,
    note: e.note ?? null,
    // Earned and imported points expire (BR-07); imported ones count from the import date (TDD §4.12).
    expiresAt: e.reason === 'earn' || e.reason === 'import' ? pointsExpiry(now, cfg['loyalty.expiry_months']) : null,
    actorId: ctx.actor?.userId ?? null,
    at: now,
  });
  return delta;
}

/** Seed Standard/Silver/Gold from the BR-08 thresholds, with no benefits until the owner sets them. */
export async function seedTiers(tx: Tx, ctx: Ctx): Promise<void> {
  const [any] = await tx.select({ id: schema.tier.id }).from(schema.tier).limit(1);
  if (any) return;
  const cfg = await settings.snapshot(ctx, tx);
  const tiers = defaultTiers(cfg['loyalty.tier_silver_vnd'], cfg['loyalty.tier_gold_vnd']);
  await tx.insert(schema.tier).values(
    tiers.map((t, sort) => ({ code: t.code, name: t.name, minSpendVnd: t.minSpendVnd, benefits: { discountBp: 0, pointsMultiplierBp: 10000 }, sort })),
  );
}

export async function listTiers(ctx: Ctx) {
  requirePermission(ctx, 'customer.view');
  return ctx.db.select().from(schema.tier).orderBy(asc(schema.tier.sort));
}

// ---------------------------------------------------------------------------------------------
// Store credit (FR-CRM-10, TDD §4.9)

export interface CreditEntry {
  customerId: string;
  deltaVnd: number;
  reason: 'refund' | 'spend' | 'spend_reversal' | 'adjust';
  refType?: string;
  refId?: string;
  note?: string;
}

/**
 * Append a store-credit ledger row and move `store_credit_vnd` with it. Debits are one atomic
 * conditional update, so the balance never goes below zero. Returns the new balance.
 */
export async function postCredit(tx: Tx, ctx: Ctx, e: CreditEntry): Promise<number> {
  if (!Number.isSafeInteger(e.deltaVnd) || e.deltaVnd === 0) throw new RangeError('deltaVnd must be a non-zero integer');
  const c = schema.customer;
  const [row] = await tx
    .update(c)
    .set({ storeCreditVnd: sql`${c.storeCreditVnd} + ${e.deltaVnd}` })
    .where(and(eq(c.id, e.customerId), sql`${c.storeCreditVnd} + ${e.deltaVnd} >= 0`))
    .returning({ balance: c.storeCreditVnd });
  if (!row) {
    const [cur] = await tx.select({ b: c.storeCreditVnd }).from(c).where(eq(c.id, e.customerId));
    if (!cur) throw errors.notFound('Khách hàng');
    throw new AppError(409, 'store_credit_insufficient', `Khách chỉ còn ${cur.b} ₫ tiền ghi có.`, { balanceVnd: cur.b });
  }
  await tx.insert(schema.storeCreditLedger).values({
    customerId: e.customerId,
    deltaVnd: e.deltaVnd,
    reason: e.reason,
    refType: e.refType ?? null,
    refId: e.refId ?? null,
    note: e.note ?? null,
    actorId: ctx.actor?.userId ?? null,
    at: ctx.clock.now(),
  });
  return row.balance;
}

export const CreditAdjustSchema = z.object({
  deltaVnd: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Số tiền điều chỉnh phải khác 0.'),
  reason: z.string().trim().min(1, 'Cần nhập lý do điều chỉnh.').max(300),
});

/** Manual adjustment with permission and a reason, audited (FR-CRM-10). */
export async function adjustCredit(ctx: Ctx, customerId: string, input: z.input<typeof CreditAdjustSchema>) {
  requirePermission(ctx, 'customer.adjust_points');
  const data = CreditAdjustSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const balance = await postCredit(tx, ctx, { customerId, deltaVnd: data.deltaVnd, reason: 'adjust', note: data.reason });
    await audit.record(tx, ctx, { action: 'store_credit.adjust', entity: 'customer', entityId: customerId, after: { deltaVnd: data.deltaVnd, reason: data.reason, balanceVnd: balance } });
    return { balanceVnd: balance };
  });
}

export * from './privacy.js';
