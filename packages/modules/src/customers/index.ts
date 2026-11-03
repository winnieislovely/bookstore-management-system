import { schema } from '@bookstore/db';
import { defaultTiers, foldText, normalizePhone, pointsExpiry } from '@bookstore/domain';
import { and, asc, desc, eq, ne, sql, type SQL } from 'drizzle-orm';
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

export const CustomerUpdateSchema = CustomerSchema.partial()
  .extend({ email: z.email().nullable().optional(), birthDate: z.iso.date().nullable().optional(), note: z.string().trim().max(1000).nullable().optional(), version: z.number().int() });

/** Edit a profile (FR-CRM-01); the phone stays unique (BR-16), optimistic concurrency by version. */
export async function updateCustomer(ctx: Ctx, id: string, input: z.input<typeof CustomerUpdateSchema>) {
  requirePermission(ctx, 'customer.manage');
  const data = CustomerUpdateSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.customer).where(eq(schema.customer.id, id)).for('update');
    if (!before || before.anonymisedAt || before.mergedInto) throw errors.notFound('Khách hàng');
    if (before.version !== data.version) throw errors.stale();
    let phoneE164 = before.phoneE164;
    if (data.phone !== undefined) {
      phoneE164 = normalizePhone(data.phone);
      if (!phoneE164) throw new AppError(400, 'invalid_phone', `Số điện thoại '${data.phone}' không hợp lệ.`);
      const [dup] = await tx.select({ id: schema.customer.id, name: schema.customer.name }).from(schema.customer).where(and(eq(schema.customer.phoneE164, phoneE164), ne(schema.customer.id, id)));
      if (dup) throw errors.conflict('duplicate_phone', `Đã có khách hàng với số này: ${dup.name}.`, { customerId: dup.id });
    }
    const next = {
      name: data.name ?? before.name,
      phoneE164,
      email: data.email === undefined ? before.email : data.email,
      birthDate: data.birthDate === undefined ? before.birthDate : data.birthDate,
      note: data.note === undefined ? before.note : data.note,
      tags: data.tags ?? before.tags,
      source: data.source ?? before.source,
    };
    await tx
      .update(schema.customer)
      .set({ ...next, searchText: searchTextOf(next), updatedAt: ctx.clock.now(), version: before.version + 1 })
      .where(eq(schema.customer.id, id));
    await audit.record(tx, ctx, { action: 'customer.update', entity: 'customer', entityId: id, before: { name: before.name, phoneE164: before.phoneE164, email: before.email }, after: { name: next.name, phoneE164: next.phoneE164, email: next.email } });
    return { version: before.version + 1 };
  });
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

/** `a,b` (or an already-split list) → list; empty → undefined. */
const csv = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
const csvField = z.union([z.string(), z.array(z.string())]).optional().transform(csv);
/** A count range: `0`, `2-5`, `11+`. */
const RANGE = /^(\d+)(?:-(\d+)|(\+))?$/;
const csvRanges = csvField.pipe(z.array(z.string().regex(RANGE, 'Khoảng không hợp lệ (vd. 0, 2-5, 11+)')).optional());

export const CustomerListQuery = z.object({
  q: z.string().optional(),
  tier: csvField,
  lastPurchase: z.enum(['30d', '90d', '180d', 'over180d', 'never']).optional(),
  orders: csvRanges,
  points: csvRanges,
});

/** `col` within any of the ranges (OR). */
function inRanges(col: SQL, ranges: string[]): SQL {
  const parts = ranges.map((r) => {
    const [, lo, hi, plus] = RANGE.exec(r)!;
    if (plus) return sql`${col} >= ${Number(lo)}`;
    if (hi) return sql`${col} between ${Number(lo)} and ${Number(hi)}`;
    return sql`${col} = ${Number(lo)}`;
  });
  return sql`(${sql.join(parts, sql` or `)})`;
}

/**
 * Customer list (FR-CRM-02): diacritic-insensitive search on name, phone and email, purchase stats
 * from completed counter sales (online orders join in R2) and filters by tier, last purchase, order count and points.
 */
export async function search(ctx: Ctx, input: z.input<typeof CustomerListQuery> = {}, limit = 40) {
  requirePermission(ctx, 'customer.view');
  const f = CustomerListQuery.parse(input);
  const q = f.q ?? '';
  const term = foldText(q).replace(/\s+/g, ' ');
  const digits = q.replace(/\D/g, '');
  const where: SQL[] = [sql`c.anonymised_at is null`];
  if (term) where.push(digits.length >= 4 ? sql`(c.search_text like ${`%${term}%`} or c.phone_e164 like ${`%${digits.slice(-9)}%`})` : sql`c.search_text like ${`%${term}%`}`);
  if (f.tier) where.push(sql`t.code in (${sql.join(f.tier.map((x) => sql`${x}`), sql`, `)})`);
  if (f.orders) where.push(inRanges(sql`coalesce(st.orders, 0)`, f.orders));
  if (f.points) where.push(inRanges(sql`c.points_balance`, f.points));
  if (f.lastPurchase === 'never') where.push(sql`st.last_at is null`);
  else if (f.lastPurchase === 'over180d') where.push(sql`st.last_at < now() - interval '180 days'`);
  else if (f.lastPurchase) where.push(sql`st.last_at >= now() - ${`${parseInt(f.lastPurchase)} days`}::interval`);
  const rows = await ctx.db.execute<{
    id: string;
    name: string;
    phone_e164: string | null;
    email: string | null;
    points_balance: number;
    tier_code: string | null;
    tier_name: string | null;
    orders: number | null;
    orders_vnd: string | null;
    last_at: Date | string | null;
  }>(sql`
    select c.id, c.name, c.phone_e164, c.email, c.points_balance, t.code as tier_code, t.name as tier_name,
           st.orders, st.orders_vnd, st.last_at
    from crm.customer c
    left join crm.tier t on t.id = c.tier_id
    left join lateral (
      select count(*)::int as orders, sum(s.total_vnd) as orders_vnd, max(s.sold_at) as last_at
      from reports.sale_doc s where s.customer_id = c.id
    ) st on true
    where ${and(...where)}
    order by c.name asc
    limit ${limit}`);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phoneE164: r.phone_e164,
    email: r.email,
    pointsBalance: r.points_balance,
    tierCode: r.tier_code,
    tierName: r.tier_name,
    orders: r.orders ?? 0,
    ordersVnd: Number(r.orders_vnd ?? 0),
    lastPurchaseAt: r.last_at ? new Date(r.last_at).toISOString() : null,
  }));
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
  // Store credit was withdrawn (FR-CRM-10); its legacy column is not exposed.
  const { storeCreditVnd: _unused, ...profile } = c.c;
  return { ...profile, tierCode: c.tierCode, tierName: c.tierName, tierBenefits: c.benefits, pointsLedger: ledger };
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


export * from './privacy.js';

export * from './merge.js';
