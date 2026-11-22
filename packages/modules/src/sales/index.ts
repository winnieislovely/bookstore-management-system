import { schema } from '@bookstore/db';
import {
  foldText,
  checkShiftClose,
  countDenominations,
  divRoundHalfUp,
  expectedCash,
  normalizePaymentRef,
  PAYMENT_REF_ALPHABET,
  PAYMENT_REF_LENGTH,
  pointsToReverse,
  priceCart,
  vnd,
  type CartLineInput,
  type PriceCartResult,
} from '@bookstore/domain';
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as customers from '../customers/index.js';
import * as identity from '../identity/index.js';
import * as inventory from '../inventory/index.js';
import * as library from '../library/index.js';
import * as notifications from '../notifications/index.js';
import * as promotions from '../promotions/index.js';
import * as settings from '../settings/index.js';
import { AppError, can, emit, errors, nextDocNo, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/** Point of sale and shifts (FR-POS-01..22, TDD §4.4). Offline sync is in `sales/sync` (TDD §7). */

const money = z.number().int().min(0);

// =============================================================================================
// Registers

export async function listRegisters(ctx: Ctx) {
  requirePermission(ctx, 'sale.create');
  return ctx.db.select().from(schema.register).where(eq(schema.register.active, true)).orderBy(asc(schema.register.code));
}

export const RegisterSchema = z.object({ code: z.string().trim().min(1).max(8), name: z.string().trim().min(1).max(60) });

export async function createRegister(ctx: Ctx, input: z.input<typeof RegisterSchema>) {
  requirePermission(ctx, 'settings.manage');
  const data = RegisterSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [dupe] = await tx.select({ id: schema.register.id }).from(schema.register).where(eq(schema.register.code, data.code));
    if (dupe) throw errors.conflict('duplicate_register', `Mã quầy '${data.code}' đã có.`);
    const [r] = await tx.insert(schema.register).values(data).returning({ id: schema.register.id });
    await audit.record(tx, ctx, { action: 'register.create', entity: 'register', entityId: r!.id, after: data });
    return { id: r!.id };
  });
}

export const RegisterUpdateSchema = z.object({ name: z.string().trim().min(1).max(60) });

/** Rename a register; its code stays, as device codes derive from it (FR-ADM-04). */
export async function updateRegister(ctx: Ctx, id: string, input: z.input<typeof RegisterUpdateSchema>) {
  requirePermission(ctx, 'settings.manage');
  const data = RegisterUpdateSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.register).where(eq(schema.register.id, id));
    if (!before) throw errors.notFound('Quầy');
    await tx.update(schema.register).set({ name: data.name }).where(eq(schema.register.id, id));
    await audit.record(tx, ctx, { action: 'register.update', entity: 'register', entityId: id, before: { name: before.name }, after: data });
    return { id };
  });
}

/** The first-run wizard creates register `Q1` (TDD §6.2). */
export async function seedRegister(tx: Tx): Promise<void> {
  await tx.insert(schema.register).values({ code: 'Q1', name: 'Quầy 1' }).onConflictDoNothing();
}

// =============================================================================================
// Shifts and cash (FR-POS-18..22, BR-06)

export const OpenShiftSchema = z.object({
  registerId: z.uuid(),
  floatVnd: money,
  denominations: z.record(z.string(), z.number().int().min(0)).optional(),
});

export async function openShift(ctx: Ctx, input: z.input<typeof OpenShiftSchema>) {
  const actor = requirePermission(ctx, 'shift.open');
  const data = OpenShiftSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [reg] = await tx.select().from(schema.register).where(eq(schema.register.id, data.registerId));
    if (!reg?.active) throw errors.notFound('Quầy');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bms.shift_no'))`);
    const [open] = await tx.select({ id: schema.shift.id }).from(schema.shift).where(and(eq(schema.shift.registerId, reg.id), sql`${schema.shift.closedAt} is null`));
    if (open) throw errors.conflict('shift_already_open', `Quầy ${reg.code} đang có ca mở. Hãy đóng ca đó trước.`, { shiftId: open.id });
    const [{ next } = { next: 1 }] = await tx.execute<{ next: number }>(sql`select coalesce(max(shift_no), 0)::int + 1 as next from sales.shift`);
    const [s] = await tx
      .insert(schema.shift)
      .values({ shiftNo: next, registerId: reg.id, openedBy: actor.userId, openedAt: ctx.clock.now(), floatVnd: data.floatVnd, denominations: data.denominations ?? null })
      .returning();
    return { id: s!.id, shiftNo: s!.shiftNo, registerCode: reg.code, openedAt: s!.openedAt, floatVnd: s!.floatVnd };
  });
}

export async function shiftCash(tx: Tx, shiftId: string) {
  const [row] = await tx.execute<{ cash_sales: string; cash_refunds: string; cash_in: string; cash_out: string }>(sql`
    select
      coalesce((select sum(p.amount_vnd) from sales.sale_payment p join sales.sale s on s.id = p.sale_id
                where s.shift_id = ${shiftId}::uuid and s.status = 'completed' and p.method = 'cash'), 0) as cash_sales,
      coalesce((select sum(r.refund_vnd) from sales.sale_return r where r.shift_id = ${shiftId}::uuid and r.refund_method = 'cash'), 0) as cash_refunds,
      coalesce((select sum(m.amount_vnd) from sales.cash_movement m where m.shift_id = ${shiftId}::uuid and m.direction = 'in'), 0) as cash_in,
      coalesce((select sum(m.amount_vnd) from sales.cash_movement m where m.shift_id = ${shiftId}::uuid and m.direction = 'out'), 0) as cash_out`);
  return {
    cashSalesVnd: vnd(Number(row!.cash_sales)),
    cashRefundsVnd: vnd(Number(row!.cash_refunds)),
    cashInVnd: vnd(Number(row!.cash_in)),
    cashOutVnd: vnd(Number(row!.cash_out)),
  };
}

async function openShiftRow(tx: Tx, shiftId: string, lock = false) {
  const q = tx.select().from(schema.shift).where(eq(schema.shift.id, shiftId));
  const [s] = lock ? await q.for('update') : await q;
  if (!s) throw errors.notFound('Ca làm');
  if (s.closedAt) throw errors.conflict('shift_closed', 'Ca làm đã đóng. Hãy mở ca mới để tiếp tục bán.');
  return s;
}

export async function currentShift(ctx: Ctx, registerId: string) {
  if (!ctx.actor) throw errors.unauthenticated();
  const [s] = await ctx.db
    .select({ s: schema.shift, openedByName: schema.appUser.displayName })
    .from(schema.shift)
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.shift.openedBy))
    .where(and(eq(schema.shift.registerId, registerId), sql`${schema.shift.closedAt} is null`));
  return s ? { ...s.s, openedByName: s.openedByName } : null;
}

export const CashMovementSchema = z.object({
  shiftId: z.uuid(),
  direction: z.enum(['in', 'out']),
  amountVnd: z.number().int().positive(),
  reason: z.string().trim().min(1, 'Cần nhập lý do.').max(300),
});

/** Cash paid in or out during a shift, with a reason (FR-POS-20). */
export async function cashMovement(ctx: Ctx, input: z.input<typeof CashMovementSchema>) {
  const actor = requirePermission(ctx, 'shift.cash_movement');
  const data = CashMovementSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    await openShiftRow(tx, data.shiftId);
    const [m] = await tx.insert(schema.cashMovement).values({ ...data, createdBy: actor.userId, at: ctx.clock.now() }).returning({ id: schema.cashMovement.id });
    return { id: m!.id };
  });
}

export const CloseShiftSchema = z
  .object({
    shiftId: z.uuid(),
    countedVnd: money.optional(),
    /** Count by denomination (Design §13.6): banknote value → quantity. */
    denominations: z.record(z.string(), z.number().int().min(0)).optional(),
    varianceReason: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.countedVnd !== undefined || d.denominations !== undefined, 'Nhập số tiền đếm được hoặc số tờ theo mệnh giá.');

/**
 * Close is never blocked and needs no approval; a non-zero variance needs a reason; above the
 * threshold users holding `shift.view_all` get an in-app notification (FR-POS-19, BR-06).
 */
export async function closeShift(ctx: Ctx, input: z.input<typeof CloseShiftSchema>) {
  const actor = requirePermission(ctx, 'shift.close');
  const data = CloseShiftSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const s = await openShiftRow(tx, data.shiftId, true);
    const cfg = await settings.snapshot(ctx, tx);
    const expected = expectedCash({ floatVnd: vnd(s.floatVnd), ...(await shiftCash(tx, s.id)) });
    const counted =
      data.denominations !== undefined
        ? countDenominations(Object.fromEntries(Object.entries(data.denominations).map(([k, v]) => [Number(k), v])))
        : vnd(data.countedVnd!);
    const check = checkShiftClose(expected, counted, data.varianceReason, cfg['shift.variance_alert_vnd']);
    if (!check.ok) {
      throw new AppError(400, 'variance_reason_required', 'Tiền đếm được lệch so với số dự kiến. Hãy nhập lý do chênh lệch rồi đóng ca.', {
        expectedVnd: expected,
        countedVnd: counted,
        varianceVnd: check.varianceVnd,
      });
    }
    const now = ctx.clock.now();
    await tx
      .update(schema.shift)
      .set({
        closedAt: now,
        closedBy: actor.userId,
        countedVnd: counted,
        denominations: data.denominations ?? null,
        expectedVnd: expected,
        varianceVnd: check.varianceVnd,
        varianceReason: check.varianceVnd === 0 ? null : data.varianceReason!,
      })
      .where(eq(schema.shift.id, s.id));
    if (check.alert) {
      await notifications.notifyHolders(tx, 'shift.view_all', 'shift.variance_exceeded', {
        shiftId: s.id,
        shiftNo: s.shiftNo,
        varianceVnd: check.varianceVnd,
        reason: data.varianceReason,
        cashier: actor.displayName,
      });
    }
    await emit(tx, 'shift.closed', { shiftId: s.id, varianceVnd: check.varianceVnd });
    return { shiftId: s.id, expectedVnd: expected, countedVnd: counted, varianceVnd: check.varianceVnd, alert: check.alert };
  });
}

/** Shift history with variances, reasons and cashiers (FR-POS-22). */
/** Shift history (FR-POS-22): search by shift number or cashier name, filter by register and opening day (Design §12.1). */
export async function listShifts(ctx: Ctx, q: { from?: Date | undefined; to?: Date | undefined; limit?: number | undefined; q?: string | undefined; registerIds?: string[] | undefined }) {
  requirePermission(ctx, 'shift.view_all');
  const s = schema.shift;
  const where: SQL[] = [];
  if (q.from) where.push(gte(s.openedAt, q.from));
  if (q.to) where.push(lte(s.openedAt, q.to));
  if (q.registerIds?.length) where.push(inArray(s.registerId, q.registerIds));
  const term = foldText(q.q ?? '').trim();
  if (term) {
    const no = /^#?(\d+)$/.exec(term);
    where.push(no ? eq(s.shiftNo, Number(no[1])) : sql`lower(public.f_unaccent(${schema.appUser.displayName})) like ${`%${term}%`}`);
  }
  return ctx.db
    .select({
      id: s.id,
      shiftNo: s.shiftNo,
      registerCode: schema.register.code,
      openedBy: schema.appUser.displayName,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      floatVnd: s.floatVnd,
      expectedVnd: s.expectedVnd,
      countedVnd: s.countedVnd,
      varianceVnd: s.varianceVnd,
      varianceReason: s.varianceReason,
    })
    .from(s)
    .innerJoin(schema.register, eq(schema.register.id, s.registerId))
    .innerJoin(schema.appUser, eq(schema.appUser.id, s.openedBy))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(s.openedAt))
    .limit(Math.min(q.limit ?? 40, 200));
}

/** Shift report: expected cash breakdown, sales totals by method (UC-03). */
export async function shiftReport(ctx: Ctx, shiftId: string) {
  if (!ctx.actor) throw errors.unauthenticated();
  const [s] = await ctx.db.select().from(schema.shift).where(eq(schema.shift.id, shiftId));
  if (!s) throw errors.notFound('Ca làm');
  if (s.openedBy !== ctx.actor.userId && !can(ctx.actor, 'shift.view_all')) throw errors.forbidden('shift.view_all');
  const cash = await shiftCash(ctx.db, shiftId);
  const byMethod = await ctx.db.execute<{ method: string; total: string; n: number }>(sql`
    select p.method, sum(p.amount_vnd) as total, count(distinct s.id)::int as n
    from sales.sale_payment p join sales.sale s on s.id = p.sale_id
    where s.shift_id = ${shiftId}::uuid and s.status = 'completed' group by p.method order by p.method`);
  return {
    ...s,
    cash: { ...cash, expectedVnd: expectedCash({ floatVnd: vnd(s.floatVnd), ...cash }) },
    paymentsByMethod: byMethod.map((r) => ({ method: r.method, totalVnd: Number(r.total), sales: r.n })),
  };
}

// =============================================================================================
// Pricing (FR-POS-02, FR-POS-05)

export const CartLineSchema = z.object({
  lineId: z.string().min(1).max(40),
  variantId: z.uuid(),
  qty: z.number().int().positive(),
  // The selling price cannot be changed at the POS (FR-POS-02).
  priceOverrideVnd: z.null().optional(),
  manualDiscount: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('percent'), bp: z.number().int().min(0).max(10000) }),
      z.object({ kind: z.literal('amount'), vnd: money }),
    ])
    .nullable()
    .optional(),
  note: z.string().trim().max(200).optional(),
});

export const CartSchema = z.object({
  lines: z.array(CartLineSchema).min(1, 'Giỏ hàng đang trống.').max(200),
  customerId: z.uuid().nullable().optional(),
  /** Manual discount on the whole order, a percentage only (FR-POS-02, BR-05). There are no coupon codes (FR-PRM-01). */
  orderManualDiscount: z.object({ kind: z.literal('percent'), bp: z.number().int().min(0).max(10000) }).nullable().optional(),
  redeemPoints: z.number().int().min(0).optional(),
});
export type CartInput = z.input<typeof CartSchema>;

interface VariantInfo {
  id: string;
  itemId: string;
  sku: string;
  title: string;
  priceVnd: number;
  vatBp: number;
  status: string;
  itemStatus: string;
  publishedPos: boolean;
  publisherId: string | null;
  brandId: string | null;
  categoryIds: string[];
  kind: string;
}

async function loadVariants(tx: Tx, ids: string[]): Promise<Map<string, VariantInfo>> {
  if (!ids.length) return new Map();
  const rows = await tx.execute<{
    id: string;
    item_id: string;
    sku: string;
    title: string;
    price_vnd: string;
    vat_bp: number;
    status: string;
    item_status: string;
    published_pos: boolean;
    publisher_id: string | null;
    brand_id: string | null;
    category_ids: string[];
    kind: string;
  }>(sql`
    select v.id, v.item_id, v.sku, i.i18n -> 'en' ->> 'title' as title, v.price_vnd, v.vat_bp, v.status, i.status as item_status,
           v.published_pos, i.publisher_id, i.brand_id, i.kind,
           coalesce((select array_agg(ic.category_id) from catalog.item_category ic where ic.item_id = i.id), '{}') as category_ids
    from catalog.item_variant v join catalog.item i on i.id = v.item_id
    where v.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        itemId: r.item_id,
        sku: r.sku,
        title: r.title,
        priceVnd: Number(r.price_vnd),
        vatBp: r.vat_bp,
        status: r.status,
        itemStatus: r.item_status,
        publishedPos: r.published_pos,
        publisherId: r.publisher_id,
        brandId: r.brand_id,
        categoryIds: r.category_ids,
        kind: r.kind,
      },
    ]),
  );
}

/**
 * `agreed`: unit prices fixed earlier, a collected pre-order's agreed price (FR-POS-09); `noPromotions`
 * prices without today's promotions (the agreed-price side of a collection).
 */
async function priceForCart(tx: Tx, ctx: Ctx, cart: z.infer<typeof CartSchema>, agreed?: ReadonlyMap<string, number>, noPromotions = false) {
  const actor = requirePermission(ctx, 'sale.create');
  const variants = await loadVariants(tx, [...new Set(cart.lines.map((l) => l.variantId))]);
  for (const [variantId, priceVnd] of agreed ?? []) {
    const v = variants.get(variantId);
    if (v) v.priceVnd = priceVnd;
  }
  const lines: CartLineInput[] = cart.lines.map((l) => {
    const v = variants.get(l.variantId);
    if (!v) throw errors.notFound('Sản phẩm');
    if (v.status !== 'active' || v.itemStatus !== 'active' || !v.publishedPos) {
      throw new AppError(409, 'item_not_for_sale', `'${v.title}' (${v.sku}) đang ẩn hoặc ngừng bán tại quầy.`, { variantId: v.id });
    }
    return {
      lineId: l.lineId,
      variantId: v.id,
      itemClass: 'goods',
      categoryIds: v.categoryIds,
      publisherId: v.publisherId,
      brandId: v.brandId,
      qty: l.qty,
      unitPriceVnd: vnd(v.priceVnd),
      vatBp: v.vatBp,
      priceOverrideVnd: l.priceOverrideVnd == null ? null : vnd(l.priceOverrideVnd),
      manualDiscount: l.manualDiscount ? (l.manualDiscount.kind === 'percent' ? l.manualDiscount : { kind: 'amount', vnd: vnd(l.manualDiscount.vnd) }) : null,
    };
  });
  // Without the discount permission a cashier cannot give any manual discount (SRS Appendix A).
  if (!can(actor, 'sale.discount') && (lines.some((l) => l.manualDiscount) || cart.orderManualDiscount)) throw errors.forbidden('sale.discount');
  const cfg = await settings.snapshot(ctx, tx);
  const customer = cart.customerId ? await customers.pricingProfile(tx, cart.customerId) : null;
  const promos = noPromotions ? [] : await promotions.activeSnapshot(tx, ctx.clock.now(), 'counter', cart.customerId ?? null);
  const result = priceCart({
    lines,
    channel: 'counter',
    customer,
    promotions: promos,
    orderManualDiscount: cart.orderManualDiscount ?? null,
    redeemPoints: cart.redeemPoints ?? 0,
    settings: {
      cashierDiscountMaxBp: cfg['sale.cashier_discount_max_bp'],
      earnVndPerPoint: cfg['loyalty.earn_vnd_per_point'],
      pointValueVnd: cfg['loyalty.point_value_vnd'],
      minRedeemPoints: cfg['loyalty.min_redeem_points'],
      // FR-PRM-05: no category cap unless one is set (none configurable yet).
      categoryMaxDiscountBp: {},
    },
    grants: { discountUnlimited: can(actor, 'sale.discount_unlimited'), priceOverride: can(actor, 'sale.price_override') },
  });
  return { result, variants, promos };
}

/** Server-side price calculation, the same engine the POS runs locally (TDD §6.2). */
export async function price(ctx: Ctx, input: CartInput) {
  const cart = CartSchema.parse(input);
  const { result, variants } = await priceForCart(ctx.db, ctx, cart);
  return {
    ...result,
    lines: result.lines.map((l) => ({ ...l, sku: variants.get(l.variantId)!.sku, title: variants.get(l.variantId)!.title })),
  };
}

// =============================================================================================
// Completing a sale (FR-POS-06, UC-01)

export const PaymentInputSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('cash'), amountVnd: z.number().int().positive(), tenderedVnd: money.optional() }),
  /**
   * Bank transfer to the store's printed QR. At the counter the cashier's confirmation is the check that
   * the money arrived, so `ref` is optional (FR-POS-06); one that is sent must be a valid payment reference.
   */
  z.object({
    method: z.literal('transfer'),
    amountVnd: z.number().int().positive(),
    ref: z
      .string()
      .transform(normalizePaymentRef)
      .refine((r) => r.length === PAYMENT_REF_LENGTH && [...r].every((ch) => PAYMENT_REF_ALPHABET.includes(ch)), 'Mã tham chiếu chuyển khoản không hợp lệ.')
      .optional(),
  }),
  /** Card on the standalone terminal: no approval code is asked for (FR-POS-06); `ref` stays optional. */
  z.object({ method: z.literal('card'), amountVnd: z.number().int().positive(), ref: z.string().trim().max(40).optional() }),
]);

export const BuyerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  taxCode: z.string().trim().max(20).optional(),
  address: z.string().trim().max(400).optional(),
  email: z.email().optional(),
});

export const CompleteSaleSchema = CartSchema.extend({
  shiftId: z.uuid(),
  payments: z.array(PaymentInputSchema).max(10),
  /** Part-payment (deposit, FR-POS-06). */
  isDeposit: z.boolean().default(false),
  note: z.string().trim().max(500).optional(),
  /** Supervisor approvals for the cart (FR-ADM-09). */
  approvals: z
    .object({ discount_over_limit: z.string().optional(), price_override: z.string().optional() })
    .default({}),
  /** The customer asks for the e-invoice now (FR-POS-16). */
  einvoiceRequest: BuyerSchema.optional(),
  /** Collecting a pre-order: its line at the agreed price, the deposit counted as paid (FR-POS-09). */
  preorderId: z.uuid().optional(),
});
export type CompleteSaleInput = z.input<typeof CompleteSaleSchema>;

function requestHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Idempotent replay (TDD §6.1): a stored response is returned for the same key and body; the same
 * key with a different body is a 409. The key row is written in the business transaction, so a
 * concurrent duplicate fails on the primary key and then returns the stored result.
 */
export async function idempotent<T>(ctx: Ctx, key: string | undefined, body: unknown, run: (tx: Tx) => Promise<T>): Promise<T> {
  if (!key) return ctx.db.transaction(run);
  const hash = requestHash(body);
  const stored = async () => {
    const [row] = await ctx.db.select().from(schema.idempotencyKey).where(eq(schema.idempotencyKey.key, key));
    if (!row) return undefined;
    if (row.requestHash !== hash) throw errors.conflict('idempotency_key_reused', 'Mã yêu cầu đã được dùng cho một yêu cầu khác.');
    return row.response as T;
  };
  const before = await stored();
  if (before !== undefined) return before;
  try {
    return await ctx.db.transaction(async (tx) => {
      const result = await run(tx);
      await tx.insert(schema.idempotencyKey).values({
        key,
        requestHash: hash,
        status: 200,
        response: result as never,
        createdAt: ctx.clock.now(),
        expiresAt: new Date(ctx.clock.now().getTime() + 24 * 3600_000),
      });
      return result;
    });
  } catch (e) {
    const again = await stored();
    if (again !== undefined) return again;
    throw e;
  }
}

async function useApprovals(tx: Tx, ctx: Ctx, priced: PriceCartResult, tokens: { discount_over_limit?: string | undefined; price_override?: string | undefined }) {
  const needed = new Set(priced.approvalsRequired.map((a) => a.code));
  let approvedBy: string | null = null;
  for (const action of needed) {
    const token = tokens[action];
    if (!token) {
      const reason = priced.approvalsRequired.find((a) => a.code === action)!;
      throw new AppError(403, 'approval_required', action === 'discount_over_limit' ? 'Giảm giá vượt hạn mức của bạn, cần quản lý duyệt.' : 'Sửa giá bán cần quản lý duyệt.', {
        action,
        ...reason,
      });
    }
    approvedBy = await identity.consumeApproval(tx, ctx, token, action);
  }
  return approvedBy;
}

/** Deduct stock for a goods line; bundles deduct their components (FR-CAT-12, `bundle_use`). */
export async function deductStock(tx: Tx, ctx: Ctx, saleId: string, variantId: string, qty: number, allowNegative: boolean, refType = 'sale'): Promise<number> {
  const components = await tx.select().from(schema.bundleComponent).where(eq(schema.bundleComponent.bundleVariantId, variantId)).orderBy(asc(schema.bundleComponent.componentVariantId));
  if (components.length) {
    let cost = 0;
    for (const c of components) {
      const a = await inventory.apply(tx, ctx, { variantId: c.componentVariantId, type: 'bundle_use', qtyDelta: -(c.qty * qty), refType, refId: saleId, force: allowNegative });
      cost += a.costVnd * c.qty;
    }
    return cost;
  }
  const a = await inventory.apply(tx, ctx, { variantId, type: 'sale', qtyDelta: -qty, refType, refId: saleId, force: allowNegative });
  return a.costVnd;
}

/** Allocate sold units of consignment variants to lots, oldest first (TDD §4.3). */
export async function allocateConsignment(tx: Tx, saleLineId: string, variantId: string, qty: number, unitPriceVnd: number, at: Date) {
  const lots = await tx.execute<{ id: string; remaining: number }>(sql`
    select id, (qty_received - qty_sold - qty_returned)::int as remaining from purchasing.consignment_lot
    where variant_id = ${variantId}::uuid and qty_received - qty_sold - qty_returned > 0
    order by created_at, id for update`);
  let left = qty;
  for (const lot of lots) {
    if (left === 0) break;
    const take = Math.min(left, lot.remaining);
    await tx.update(schema.consignmentLot).set({ qtySold: sql`${schema.consignmentLot.qtySold} + ${take}` }).where(eq(schema.consignmentLot.id, lot.id));
    await tx.insert(schema.consignmentAllocation).values({ lotId: lot.id, saleLineId, qty: take, unitPriceVnd, at });
    left -= take;
  }
}

/**
 * A pre-order recalled into the cart (FR-POS-09): Arrived or Contacted, its customer on the sale and,
 * for each of its lines, exactly one cart line with that variant and quantity.
 */
async function preorderToCollect(tx: Tx, data: z.infer<typeof CompleteSaleSchema>) {
  const [p] = await tx.select().from(schema.preorder).where(eq(schema.preorder.id, data.preorderId!)).for('update');
  if (!p) throw errors.notFound('Phiếu đặt trước');
  if (p.status !== 'arrived' && p.status !== 'contacted') throw errors.conflict('preorder_not_ready', `Phiếu đặt trước ${p.docNo} chưa có hàng hoặc đã xử lý xong.`);
  const lines0 = await tx.select().from(schema.preorderLine).where(eq(schema.preorderLine.preorderId, p.id));
  // Statuses are set by hand (FR-ORD-14): unheld books are sold from stock like any sale; every book must be linked and priced.
  if (lines0.some((l) => !l.variantId || l.unitPriceVnd == null)) throw errors.conflict('preorder_not_ready', `Phiếu đặt trước ${p.docNo} còn sách chưa chọn sản phẩm.`);
  if (data.customerId !== p.customerId) throw new AppError(422, 'preorder_customer', `Phiếu ${p.docNo} là của khách khác.`);
  const lines = lines0 as ((typeof lines0)[number] & { variantId: string; unitPriceVnd: number })[];
  for (const pl of lines) {
    const cart = data.lines.filter((l) => l.variantId === pl.variantId);
    if (cart.length !== 1 || cart[0]!.qty !== pl.qty || cart[0]!.priceOverrideVnd != null) {
      throw new AppError(422, 'preorder_line', `Giỏ hàng cần đúng các sản phẩm và số lượng của phiếu ${p.docNo}, theo giá đã thỏa thuận.`);
    }
  }
  return { ...p, agreed: new Map(lines.map((l) => [l.variantId, l.unitPriceVnd])) };
}

export async function completeSale(ctx: Ctx, input: CompleteSaleInput, idempotencyKey?: string) {
  const actor = requirePermission(ctx, 'sale.create');
  const data = CompleteSaleSchema.parse(input);
  return idempotent(ctx, idempotencyKey, data, async (tx) => {
    const shift = await openShiftRow(tx, data.shiftId);
    const cfg = await settings.snapshot(ctx, tx);
    const pre = data.preorderId ? await preorderToCollect(tx, data) : null;
    // A collection costs the cheaper of: agreed prices without promotions, or today's prices with today's promotions (FR-POS-09).
    let { result: priced, variants } = await priceForCart(tx, ctx, data, pre?.agreed, !!pre);
    if (pre) {
      const today = await priceForCart(tx, ctx, data);
      if (today.result.totalVnd < priced.totalVnd) ({ result: priced, variants } = today);
    }
    if (priced.issues.length) {
      throw new AppError(422, 'pricing_issue', 'Không áp dụng được mã giảm giá hoặc điểm. Hãy kiểm tra lại rồi thử lại.', priced.issues);
    }
    const approvedBy = await useApprovals(tx, ctx, priced, data.approvals);
    const totalVnd = priced.totalVnd;

    // Payments: sum equals the total, unless this is a deposit sale (TDD §4.4). A pre-order deposit counts as paid;
    // a deposit above the price at collection is handed back in cash for the difference (FR-POS-09).
    const depositRefundVnd = pre && data.payments.length === 0 && pre.depositVnd > totalVnd ? pre.depositVnd - totalVnd : 0;
    const depositUsedVnd = (pre?.depositVnd ?? 0) - depositRefundVnd;
    const paid = data.payments.reduce((a, p) => a + p.amountVnd, 0) + depositUsedVnd;
    if (data.isDeposit ? paid <= 0 || paid > totalVnd : paid !== totalVnd) {
      throw new AppError(422, 'payment_mismatch', `Tổng thanh toán ${paid} ₫ chưa khớp với số phải trả ${totalVnd} ₫.`, { paidVnd: paid, totalVnd });
    }
    for (const p of data.payments) {
      if (p.method === 'cash' && p.tenderedVnd !== undefined && p.tenderedVnd < p.amountVnd) {
        throw new AppError(422, 'cash_short', 'Tiền khách đưa ít hơn số tiền mặt cần trả.');
      }
    }

    const now = ctx.clock.now();
    const docNo = await nextDocNo(tx, 'SALE', now);
    const pointsEarned = data.customerId && !data.isDeposit ? priced.pointsToEarn : 0;
    const [sale] = await tx
      .insert(schema.sale)
      .values({
        docNo,
        shiftId: shift.id,
        cashierId: actor.userId,
        customerId: data.customerId ?? null,
        subtotalVnd: priced.subtotalVnd,
        discountVnd: priced.discountVnd,
        pointsRedeemed: priced.redeemPoints,
        pointsDiscountVnd: priced.redeemValueVnd,
        pointsEarned,
        totalVnd,
        vatVnd: priced.vatVnd,
        isDeposit: data.isDeposit,
        soldAt: now,
        note: data.note ?? null,
        approvedBy,
        createdAt: now,
      })
      .returning({ id: schema.sale.id });
    const saleId = sale!.id;

    // The pre-order's held copies become this sale's (TDD §4.5).
    if (pre) await inventory.endReservations(tx, ctx, 'preorder', pre.id, 'converted');
    const lineNotes = new Map(data.lines.map((l) => [l.lineId, l]));
    for (const [i, l] of priced.lines.entries()) {
      const v = variants.get(l.variantId)!;
      const cost = await deductStock(tx, ctx, saleId, l.variantId, l.qty, cfg['inventory.allow_negative_pos']);
      const [row] = await tx
        .insert(schema.saleLine)
        .values({
          saleId,
          lineNo: i + 1,
          variantId: l.variantId,
          itemClass: 'goods',
          description: v.title,
          qty: l.qty,
          unitPriceVnd: l.unitPriceVnd,
          discountVnd: l.discountVnd,
          totalVnd: l.totalVnd,
          vatBp: l.vatBp,
          vatVnd: l.vatVnd,
          costVnd: cost * l.qty,
          promotionVersionIds: l.promotionVersionIds,
          priceOverridden: l.unitPriceVnd !== v.priceVnd,
          note: lineNotes.get(l.lineId)?.note ?? null,
        })
        .returning({ id: schema.saleLine.id });
      // Consignors are paid on the selling price before store discounts (TDD §4.3).
      await allocateConsignment(tx, row!.id, l.variantId, l.qty, l.unitPriceVnd, now);
    }

    for (const p of data.payments) {
      await tx.insert(schema.salePayment).values({
        saleId,
        method: p.method,
        amountVnd: p.amountVnd,
        tenderedVnd: p.method === 'cash' ? (p.tenderedVnd ?? p.amountVnd) : null,
        ref: p.method === 'transfer' || p.method === 'card' ? (p.ref || null) : null,
        // Staff confirm transfer receipt on the payment screen ("Đã nhận tiền", FR-POS-06).
        confirmedBy: p.method === 'transfer' ? actor.userId : null,
        confirmedAt: p.method === 'transfer' ? now : null,
      });
    }

    if (pre) {
      if (depositUsedVnd > 0) await tx.insert(schema.salePayment).values({ saleId, method: 'deposit', amountVnd: depositUsedVnd, ref: pre.docNo });
      if (depositRefundVnd > 0) {
        await tx.insert(schema.cashMovement).values({ shiftId: data.shiftId, direction: 'out', amountVnd: depositRefundVnd, reason: `Hoàn chênh cọc ${pre.docNo}`, createdBy: actor.userId, at: now });
      }
      await tx.update(schema.preorder).set({ status: 'collected', saleId }).where(eq(schema.preorder.id, pre.id));
    }

    // Loyalty: redeemed points are a discount; points are credited on payment completion (BR-19).
    if (data.customerId) {
      if (priced.redeemPoints > 0) await customers.post(tx, ctx, { customerId: data.customerId, delta: -priced.redeemPoints, reason: 'redeem', refType: 'sale', refId: saleId });
      if (pointsEarned > 0) await customers.post(tx, ctx, { customerId: data.customerId, delta: pointsEarned, reason: 'earn', refType: 'sale', refId: saleId });
    }

    // Promotion usage (FR-PRM-06).
    const uses = new Map<string, { discountVnd: number; revenueVnd: number }>();
    for (const l of priced.lines) {
      for (const s of l.savings) {
        const u = uses.get(s.promotionId) ?? { discountVnd: 0, revenueVnd: 0 };
        u.discountVnd += s.amountVnd;
        u.revenueVnd += l.totalVnd;
        uses.set(s.promotionId, u);
      }
    }
    await promotions.recordUsage(tx, [...uses].map(([promotionId, u]) => ({ promotionId, ...u })), {
      refType: 'sale',
      refId: saleId,
      customerId: data.customerId ?? null,
    });

    // E-invoice (FR-POS-15/16, BR-24): every sale by default; a buyer request also asks MISA to email it.
    let einvoiceStatus: string | null = null;
    if (cfg['pos.einvoice_mode'] === 'every_sale' || data.einvoiceRequest) {
      await tx.insert(schema.einvoiceJob).values({
        saleId,
        status: 'pending',
        nextAttemptAt: now,
        buyer: data.einvoiceRequest ?? null,
        emailRequested: !!data.einvoiceRequest?.email,
      });
      einvoiceStatus = 'pending';
    }

    await emit(tx, 'sale.completed', { saleId, customerId: data.customerId ?? null, totalVnd });
    const tendered = data.payments.reduce((a, p) => a + (p.method === 'cash' ? (p.tenderedVnd ?? p.amountVnd) - p.amountVnd : 0), 0);
    return {
      id: saleId,
      docNo,
      totalVnd,
      discountVnd: priced.discountVnd,
      vatVnd: priced.vatVnd,
      changeVnd: tendered,
      depositRefundVnd,
      pointsEarned,
      pointsRedeemed: priced.redeemPoints,
      einvoiceStatus,
      printSlip: cfg['pos.print_sales_slip'],
    };
  });
}

// =============================================================================================
// Sales list and record (FR-POS-21)

/** `a,b` (or an already-split array) → ["a", "b"], each checked against the allowed values; empty → undefined. */
const csvEnum = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (Array.isArray(v) ? v : v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).min(1).optional());

export const SalesQuery = z.object({
  q: z.string().trim().max(100).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cashier: z.uuid().optional(),
  // Comma-separated lists: OR within a filter, AND across filters (TDD §6.2).
  status: csvEnum(['completed', 'voided']),
  method: csvEnum(['cash', 'transfer', 'card']),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(40),
});

/** Sale search by number, customer, phone or item; cashiers see their own sales only (TDD §10.3). */
export async function listSales(ctx: Ctx, input: z.input<typeof SalesQuery>) {
  const actor = requirePermission(ctx, 'sale.create');
  const q = SalesQuery.parse(input);
  const s = schema.sale;
  const where: SQL[] = [];
  if (!can(actor, 'sale.view_all')) where.push(eq(s.cashierId, actor.userId));
  else if (q.cashier) where.push(eq(s.cashierId, q.cashier));
  if (q.status) where.push(inArray(s.status, q.status));
  if (q.from) where.push(gte(s.soldAt, new Date(q.from)));
  if (q.to) where.push(lte(s.soldAt, new Date(q.to)));
  if (q.method) where.push(sql`exists (select 1 from sales.sale_payment p where p.sale_id = ${s.id} and p.method in (${sql.join(q.method.map((m) => sql`${m}`), sql`, `)}))`);
  if (q.q) {
    const term = q.q;
    const digits = term.replace(/\D/g, '');
    where.push(sql`(
      ${s.docNo} ilike ${`%${term}%`}
      or exists (select 1 from crm.customer c where c.id = ${s.customerId}
                 and (c.search_text like ${`%${term.toLowerCase()}%`} ${digits.length >= 4 ? sql`or c.phone_e164 like ${`%${digits.slice(-9)}%`}` : sql``}))
      or exists (select 1 from sales.sale_line l join catalog.item_variant v on v.id = l.variant_id
                 join catalog.item i on i.id = v.item_id
                 where l.sale_id = ${s.id} and (v.sku = ${term} or v.isbn13 = ${term} or i.search_text like ${`%${term.toLowerCase()}%`})))`);
  }
  const rows = await ctx.db
    .select({
      id: s.id,
      docNo: s.docNo,
      soldAt: s.soldAt,
      totalVnd: s.totalVnd,
      status: s.status,
      cashier: schema.appUser.displayName,
      customerName: schema.customer.name,
      customerPhone: schema.customer.phoneE164,
      methods: sql<string[]>`(select array_agg(distinct p.method) from sales.sale_payment p where p.sale_id = ${s.id})`,
      einvoiceStatus: sql<string | null>`(select j.status from sales.einvoice_job j where j.sale_id = ${s.id})`,
    })
    .from(s)
    .innerJoin(schema.appUser, eq(schema.appUser.id, s.cashierId))
    .leftJoin(schema.customer, eq(schema.customer.id, s.customerId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(s.soldAt), desc(s.id))
    .limit(q.limit)
    .offset((q.page - 1) * q.limit);
  return { items: rows, page: q.page };
}

export async function getSale(ctx: Ctx, id: string) {
  const actor = requirePermission(ctx, 'sale.create');
  const [s] = await ctx.db.select().from(schema.sale).where(eq(schema.sale.id, id));
  if (!s) throw errors.notFound('Đơn bán');
  if (s.cashierId !== actor.userId && !can(actor, 'sale.view_all')) throw errors.forbidden('sale.view_all');
  const showCost = can(actor, 'report.profit');
  const lines = await ctx.db
    .select({ l: schema.saleLine, sku: schema.itemVariant.sku })
    .from(schema.saleLine)
    .leftJoin(schema.itemVariant, eq(schema.itemVariant.id, schema.saleLine.variantId))
    .where(eq(schema.saleLine.saleId, id))
    .orderBy(asc(schema.saleLine.lineNo));
  const returned = await ctx.db.execute<{ sale_line_id: string; qty: number }>(sql`
    select rl.sale_line_id, sum(rl.qty)::int as qty from sales.sale_return_line rl
    join sales.sale_return r on r.id = rl.return_id where r.sale_id = ${id}::uuid group by rl.sale_line_id`);
  const payments = await ctx.db.select().from(schema.salePayment).where(eq(schema.salePayment.saleId, id));
  const returns = await ctx.db.select().from(schema.saleReturn).where(eq(schema.saleReturn.saleId, id)).orderBy(asc(schema.saleReturn.createdAt));
  const [einvoice] = await ctx.db.select().from(schema.einvoiceJob).where(eq(schema.einvoiceJob.saleId, id));
  return {
    ...s,
    lines: lines.map(({ l, sku }) => {
      const { costVnd, ...rest } = l;
      return { ...rest, sku, returnedQty: returned.find((r) => r.sale_line_id === l.id)?.qty ?? 0, ...(showCost && { costVnd }) };
    }),
    payments,
    returns,
    einvoice: einvoice ? { status: einvoice.status, invoiceNo: einvoice.invoiceNo, emailRequested: einvoice.emailRequested, emailStatus: einvoice.emailStatus, error: einvoice.error, buyerName: (einvoice.buyer as { name?: string } | null)?.name ?? null } : null,
  };
}

// =============================================================================================
// Held carts (FR-POS-03)

export const HoldSchema = z.object({ registerId: z.uuid(), label: z.string().trim().max(60).optional(), payload: z.record(z.string(), z.unknown()) });

export async function holdCart(ctx: Ctx, input: z.input<typeof HoldSchema>) {
  const actor = requirePermission(ctx, 'sale.hold');
  const data = HoldSchema.parse(input);
  const [row] = await ctx.db
    .insert(schema.heldCart)
    .values({ registerId: data.registerId, cashierId: actor.userId, label: data.label ?? null, payload: data.payload, heldAt: ctx.clock.now() })
    .returning({ id: schema.heldCart.id });
  return { id: row!.id };
}

export async function listHeld(ctx: Ctx, registerId: string) {
  requirePermission(ctx, 'sale.hold');
  return ctx.db.select().from(schema.heldCart).where(eq(schema.heldCart.registerId, registerId)).orderBy(asc(schema.heldCart.heldAt));
}

/** Recall removes the held cart and returns it to the POS. */
export async function recallHeld(ctx: Ctx, id: string) {
  requirePermission(ctx, 'sale.hold');
  const [row] = await ctx.db.delete(schema.heldCart).where(eq(schema.heldCart.id, id)).returning();
  if (!row) throw errors.notFound('Giỏ đang giữ');
  return row;
}

// =============================================================================================
// Void (FR-POS-14)

export const VoidSchema = z.object({
  reason: z.string().trim().min(1, 'Cần nhập lý do hủy đơn.').max(500),
  /** The open shift that pays out any cash refund when the sale belongs to an earlier shift. */
  shiftId: z.uuid(),
  approvalToken: z.string().optional(),
});

async function requireOrApprove(tx: Tx, ctx: Ctx, permission: 'sale.void_paid' | 'return.approve', action: identity.ApprovalAction, token: string | undefined, subject: string, message: string) {
  if (can(ctx.actor, permission)) return ctx.actor!.userId;
  if (token) return identity.consumeApproval(tx, ctx, token, action, subject);
  throw new AppError(403, 'approval_required', message, { action });
}

/**
 * Reverse consignment allocations of a sale line for `qty` units, newest lot first. There is one
 * allocation row per sale line and lot (TDD §5.3); it is reduced, and removed when it reaches zero.
 */
export async function reverseConsignment(tx: Tx, saleLineId: string, qty: number) {
  const allocs = await tx
    .select()
    .from(schema.consignmentAllocation)
    .where(eq(schema.consignmentAllocation.saleLineId, saleLineId))
    .orderBy(desc(schema.consignmentAllocation.at), desc(schema.consignmentAllocation.id))
    .for('update');
  let left = qty;
  for (const a of allocs) {
    if (left === 0) break;
    const take = Math.min(left, a.qty);
    await tx.update(schema.consignmentLot).set({ qtySold: sql`${schema.consignmentLot.qtySold} - ${take}` }).where(eq(schema.consignmentLot.id, a.lotId));
    if (take === a.qty) await tx.delete(schema.consignmentAllocation).where(eq(schema.consignmentAllocation.id, a.id));
    else await tx.update(schema.consignmentAllocation).set({ qty: a.qty - take }).where(eq(schema.consignmentAllocation.id, a.id));
    left -= take;
  }
}

export async function restock(tx: Tx, ctx: Ctx, refType: string, refId: string, variantId: string, qty: number, unitCostVnd: number) {
  const components = await tx.select().from(schema.bundleComponent).where(eq(schema.bundleComponent.bundleVariantId, variantId));
  if (components.length) {
    for (const c of components) {
      await inventory.apply(tx, ctx, { variantId: c.componentVariantId, type: 'customer_return', qtyDelta: c.qty * qty, refType, refId, affectsCost: false });
    }
    return;
  }
  await inventory.apply(tx, ctx, { variantId, type: 'customer_return', qtyDelta: qty, unitCostVnd, refType, refId });
}

export async function voidSale(ctx: Ctx, saleId: string, input: z.input<typeof VoidSchema>) {
  requirePermission(ctx, 'sale.create');
  const data = VoidSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(schema.sale).where(eq(schema.sale.id, saleId)).for('update');
    if (!s) throw errors.notFound('Đơn bán');
    if (s.status !== 'completed') throw errors.conflict('sale_not_completed', 'Đơn này đã bị hủy trước đó.');
    const [hasReturn] = await tx.select({ id: schema.saleReturn.id }).from(schema.saleReturn).where(eq(schema.saleReturn.saleId, saleId)).limit(1);
    if (hasReturn) throw errors.conflict('sale_has_returns', 'Đơn đã có hàng trả lại, không thể hủy. Hãy dùng chức năng trả hàng.');
    const approver = await requireOrApprove(tx, ctx, 'sale.void_paid', 'void_sale', data.approvalToken, saleId, 'Hủy đơn đã thanh toán cần quản lý duyệt.');
    const current = await openShiftRow(tx, data.shiftId);
    const now = ctx.clock.now();

    const lines = await tx.select().from(schema.saleLine).where(eq(schema.saleLine.saleId, saleId));
    for (const l of lines) {
      if (!l.variantId) continue;
      await restock(tx, ctx, 'sale_void', saleId, l.variantId, l.qty, l.qty ? divRoundHalfUp(l.costVnd, l.qty) : 0);
      await reverseConsignment(tx, l.id, l.qty);
    }
    if (s.customerId) {
      if (s.pointsEarned > 0) await customers.post(tx, ctx, { customerId: s.customerId, delta: -s.pointsEarned, reason: 'return_reversal', refType: 'sale_void', refId: saleId }, { floorAtZero: true });
      if (s.pointsRedeemed > 0) await customers.post(tx, ctx, { customerId: s.customerId, delta: s.pointsRedeemed, reason: 'redeem_refund', refType: 'sale_void', refId: saleId });
    }
    // A sale voided in a later shift pays its cash back from the current drawer.
    if (s.shiftId !== current.id) {
      const [cash] = await tx.execute<{ total: string }>(sql`select coalesce(sum(amount_vnd), 0) as total from sales.sale_payment where sale_id = ${saleId}::uuid and method = 'cash'`);
      if (Number(cash!.total) > 0) {
        await tx.insert(schema.cashMovement).values({ shiftId: current.id, direction: 'out', amountVnd: Number(cash!.total), reason: `Hủy đơn ${s.docNo}`, createdBy: ctx.actor!.userId, at: now });
      }
    }
    // Library charges paid by a POS sale before 4 Nov 2026 are owed again.
    await library.unpayForVoid(tx, saleId);
    await tx.update(schema.sale).set({ status: 'voided', voidedBy: ctx.actor!.userId, voidedAt: now, voidReason: data.reason, approvedBy: approver }).where(eq(schema.sale.id, saleId));
    // An unissued invoice is withdrawn; an issued one is cancelled by the worker (TDD §8.3).
    await tx
      .update(schema.einvoiceJob)
      .set({ status: sql`case when ${schema.einvoiceJob.status} in ('pending', 'failed') then 'cancelled' else ${schema.einvoiceJob.status} end`, reissueRequested: false, updatedAt: now })
      .where(eq(schema.einvoiceJob.saleId, saleId));
    await audit.record(tx, ctx, { action: 'sale.void', entity: 'sale', entityId: saleId, before: { status: 'completed', totalVnd: s.totalVnd }, after: { status: 'voided', reason: data.reason, approvedBy: approver } });
    await emit(tx, 'sale.voided', { saleId });
    return { id: saleId, status: 'voided' };
  });
}

// =============================================================================================
// Returns and exchanges (FR-POS-12, FR-POS-13, BR-04)

export const ReturnSchema = z.object({
  shiftId: z.uuid(),
  lines: z
    .array(z.object({ saleLineId: z.uuid(), qty: z.number().int().positive(), restock: z.boolean() }))
    .min(1),
  refundMethod: z.enum(['cash', 'transfer', 'card']),
  reason: z.string().trim().max(500).optional(),
  approvalToken: z.string().optional(),
});

export async function returnSale(ctx: Ctx, saleId: string, input: z.input<typeof ReturnSchema>) {
  requirePermission(ctx, 'return.create');
  const data = ReturnSchema.parse(input);
  return ctx.db.transaction((tx) => returnSaleTx(tx, ctx, saleId, data));
}

/** Options for returns recorded offline on the device that sold the sale (TDD §7.1). */
export interface ReturnOptions {
  offline?: { at: Date; approverId: string | null };
}

export async function returnSaleTx(tx: Tx, ctx: Ctx, saleId: string, data: z.infer<typeof ReturnSchema>, opts: ReturnOptions = {}) {
  const [s] = await tx.select().from(schema.sale).where(eq(schema.sale.id, saleId)).for('update');
  if (!s) throw errors.notFound('Đơn bán');
  if (s.status !== 'completed') throw errors.conflict('sale_not_completed', 'Đơn đã bị hủy, không thể trả hàng.');
  if (!opts.offline) await openShiftRow(tx, data.shiftId);
  const cfg = await settings.snapshot(ctx, tx);
  const now = opts.offline?.at ?? ctx.clock.now();

  // Return window (BR-04): exceptions need approval (FR-POS-12).
  const windowEnd = s.soldAt.getTime() + cfg['sale.return_window_days'] * 86_400_000;
  let approvedBy: string | null = null;
  if (now.getTime() > windowEnd) {
    // Offline returns were approved on the device; the sync processor re-checks the approver (TDD §7.6).
    approvedBy = opts.offline
      ? opts.offline.approverId
      : await requireOrApprove(tx, ctx, 'return.approve', 'return_exception', data.approvalToken, saleId, `Đơn đã quá hạn đổi trả ${cfg['sale.return_window_days']} ngày, cần quản lý duyệt.`);
  }
  // Refund to the original payment method (FR-POS-13).
  const methods = (await tx.select({ m: schema.salePayment.method }).from(schema.salePayment).where(eq(schema.salePayment.saleId, saleId))).map((p) => p.m);
  if (!methods.includes(data.refundMethod)) {
    throw new AppError(422, 'refund_method_mismatch', 'Chỉ hoàn tiền theo phương thức khách đã thanh toán.', { paidWith: methods });
  }

  const saleLines = await tx.select().from(schema.saleLine).where(eq(schema.saleLine.saleId, saleId));
  const prior = await tx.execute<{ sale_line_id: string; qty: number }>(sql`
    select rl.sale_line_id, sum(rl.qty)::int as qty from sales.sale_return_line rl
    join sales.sale_return r on r.id = rl.return_id where r.sale_id = ${saleId}::uuid group by rl.sale_line_id`);
  const priorQty = (id: string) => prior.find((p) => p.sale_line_id === id)?.qty ?? 0;

  // Cumulative refund of n units of a line: exact once the whole line is returned.
  const refundOf = (total: number, lineQty: number, n: number) => divRoundHalfUp(total * n, lineQty);
  let refund = 0;
  let earningBefore = 0;
  let earningAfter = 0;
  let pointsDiscBefore = 0;
  let pointsDiscAfter = 0;
  const planned: { line: (typeof saleLines)[number]; qty: number; amount: number; restock: boolean }[] = [];
  for (const r of data.lines) {
    const line = saleLines.find((l) => l.id === r.saleLineId);
    if (!line) throw new AppError(400, 'line_not_in_sale', 'Dòng hàng không thuộc đơn này.');
    if (line.itemClass === 'library_charge') throw new AppError(422, 'not_returnable', 'Phí thư viện không trả lại được. Nếu thu nhầm, hãy hủy đơn hoặc nhờ quản lý miễn phí.');
    const done = priorQty(line.id);
    if (done + r.qty > line.qty) {
      throw new AppError(422, 'return_exceeds_sold', `Chỉ còn ${line.qty - done} sản phẩm '${line.description}' có thể trả.`);
    }
    const amount = refundOf(line.totalVnd, line.qty, done + r.qty) - refundOf(line.totalVnd, line.qty, done);
    refund += amount;
    planned.push({ line, qty: r.qty, amount, restock: r.restock });
  }
  // Points reversal on the share of point-earning value returned, cumulative so it never over-reverses (BR-19).
  const earningTotal = saleLines.filter((l) => l.itemClass === 'goods').reduce((a, l) => a + l.totalVnd, 0);
  for (const l of saleLines.filter((x) => x.itemClass === 'goods')) {
    const done = priorQty(l.id);
    const now2 = done + (planned.find((p) => p.line.id === l.id)?.qty ?? 0);
    earningBefore += refundOf(l.totalVnd, l.qty, done);
    earningAfter += refundOf(l.totalVnd, l.qty, now2);
    const lineGross = l.unitPriceVnd * l.qty;
    pointsDiscBefore += refundOf(lineGross, l.qty, done);
    pointsDiscAfter += refundOf(lineGross, l.qty, now2);
  }
  const reverse = pointsToReverse(s.pointsEarned, earningTotal, earningAfter) - pointsToReverse(s.pointsEarned, earningTotal, earningBefore);
  const grossTotal = saleLines.filter((x) => x.itemClass === 'goods').reduce((a, l) => a + l.unitPriceVnd * l.qty, 0);
  const pointsBack =
    s.pointsRedeemed > 0 ? pointsToReverse(s.pointsRedeemed, grossTotal, pointsDiscAfter) - pointsToReverse(s.pointsRedeemed, grossTotal, pointsDiscBefore) : 0;

  const docNo = await nextDocNo(tx, 'RET', now);
  const [ret] = await tx
    .insert(schema.saleReturn)
    .values({ docNo, saleId, shiftId: data.shiftId, refundMethod: data.refundMethod, refundVnd: refund, pointsReversed: reverse, reason: data.reason ?? null, approvedBy, createdBy: ctx.actor!.userId, createdAt: now })
    .returning({ id: schema.saleReturn.id });
  for (const p of planned) {
    await tx.insert(schema.saleReturnLine).values({ returnId: ret!.id, saleLineId: p.line.id, qty: p.qty, refundVnd: p.amount, restock: p.restock });
    // Damaged returns do not restock (BR-04); they stay off the shelf.
    if (p.restock && p.line.variantId) await restock(tx, ctx, 'sale_return', ret!.id, p.line.variantId, p.qty, p.line.qty ? divRoundHalfUp(p.line.costVnd, p.line.qty) : 0);
    await reverseConsignment(tx, p.line.id, p.qty);
  }
  if (s.customerId) {
    if (reverse > 0) await customers.post(tx, ctx, { customerId: s.customerId, delta: -reverse, reason: 'return_reversal', refType: 'sale_return', refId: ret!.id }, { floorAtZero: true });
    if (pointsBack > 0) await customers.post(tx, ctx, { customerId: s.customerId, delta: pointsBack, reason: 'redeem_refund', refType: 'sale_return', refId: ret!.id });
  }
  await audit.record(tx, ctx, { action: 'sale.return', entity: 'sale', entityId: saleId, after: { docNo, refundVnd: refund, refundMethod: data.refundMethod, approvedBy, pointsReversed: reverse } });
  await emit(tx, 'sale.returned', { saleId, returnId: ret!.id });
  return { id: ret!.id, docNo, refundVnd: refund, pointsReversed: reverse, pointsRefunded: pointsBack };
}

// =============================================================================================
// E-invoice (FR-POS-15..17)

/** The customer asks for the invoice: buyer details and, if given, email delivery by MISA (FR-POS-16). */
export async function requestEinvoice(ctx: Ctx, saleId: string, input: z.input<typeof BuyerSchema>) {
  requirePermission(ctx, 'sale.create');
  const buyer = BuyerSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [s] = await tx.select({ id: schema.sale.id, status: schema.sale.status }).from(schema.sale).where(eq(schema.sale.id, saleId));
    if (!s) throw errors.notFound('Đơn bán');
    if (s.status !== 'completed') throw errors.conflict('sale_not_completed', 'Đơn đã bị hủy, không xuất hóa đơn.');
    const [job] = await tx.select().from(schema.einvoiceJob).where(eq(schema.einvoiceJob.saleId, saleId)).for('update');
    const now = ctx.clock.now();
    if (!job) {
      await tx.insert(schema.einvoiceJob).values({ saleId, status: 'pending', nextAttemptAt: now, buyer, emailRequested: !!buyer.email });
    } else if (job.status === 'issued') {
      await tx.update(schema.einvoiceJob).set({ buyer, emailRequested: !!buyer.email, emailStatus: null, reissueRequested: true, nextAttemptAt: now, updatedAt: now }).where(eq(schema.einvoiceJob.id, job.id));
    } else if (job.status === 'cancelled' || job.status === 'adjusted') {
      throw errors.conflict('einvoice_closed', 'Hóa đơn đã hủy hoặc điều chỉnh, không thể gửi lại.');
    } else {
      await tx.update(schema.einvoiceJob).set({ buyer, emailRequested: !!buyer.email, status: 'pending', nextAttemptAt: now, updatedAt: now }).where(eq(schema.einvoiceJob.id, job.id));
    }
    return { saleId, status: job?.status === 'issued' ? 'issued' : 'pending', emailRequested: !!buyer.email };
  });
}

export async function retryEinvoice(ctx: Ctx, saleId: string) {
  requirePermission(ctx, 'einvoice.manage');
  const [row] = await ctx.db
    .update(schema.einvoiceJob)
    .set({ status: 'pending', nextAttemptAt: ctx.clock.now(), error: null, updatedAt: ctx.clock.now() })
    .where(and(eq(schema.einvoiceJob.saleId, saleId), eq(schema.einvoiceJob.status, 'failed')))
    .returning({ id: schema.einvoiceJob.id });
  if (!row) throw errors.conflict('einvoice_not_failed', 'Chỉ thử lại được hóa đơn đang lỗi.');
  return { status: 'pending' };
}

export async function listEinvoices(ctx: Ctx, status?: string) {
  requirePermission(ctx, 'einvoice.manage');
  const j = schema.einvoiceJob;
  return ctx.db
    .select({ id: j.id, saleId: j.saleId, docNo: schema.sale.docNo, status: j.status, attempts: j.attempts, invoiceNo: j.invoiceNo, error: j.error, emailRequested: j.emailRequested, emailStatus: j.emailStatus, updatedAt: j.updatedAt })
    .from(j)
    .leftJoin(schema.sale, eq(schema.sale.id, j.saleId))
    .where(status ? eq(j.status, status) : undefined)
    .orderBy(desc(j.updatedAt))
    .limit(200);
}

// =============================================================================================
// Optional sales slip (FR-POS-07, Design §16.2)

export async function slip(ctx: Ctx, saleId: string) {
  requirePermission(ctx, 'sale.reprint');
  const sale = await getSale(ctx, saleId);
  const cfg = await settings.snapshot(ctx);
  const [cashier] = await ctx.db.select({ name: schema.appUser.displayName }).from(schema.appUser).where(eq(schema.appUser.id, sale.cashierId));
  const customer = sale.customerId ? await customers.getCustomer(ctx, sale.customerId).catch(() => null) : null;
  return {
    store: { name: cfg['store.name'], address: cfg['store.address'], taxCode: cfg['store.tax_code'], phone: cfg['store.phone'] },
    docNo: sale.docNo,
    soldAt: sale.soldAt,
    cashier: cashier?.name ?? '',
    lines: sale.lines.map((l) => ({ description: l.description, qty: l.qty, unitPriceVnd: l.unitPriceVnd, discountVnd: l.discountVnd, totalVnd: l.totalVnd })),
    subtotalVnd: sale.subtotalVnd,
    discountVnd: sale.discountVnd,
    totalVnd: sale.totalVnd,
    payments: sale.payments.map((p) => ({ method: p.method, amountVnd: p.amountVnd, tenderedVnd: p.tenderedVnd })),
    customer: customer ? { name: customer.name, tierName: customer.tierName, pointsEarned: sale.pointsEarned, pointsBalance: customer.pointsBalance } : null,
    footer: cfg['pos.sales_slip_footer'],
  };
}

