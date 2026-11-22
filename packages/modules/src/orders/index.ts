import { schema } from '@bookstore/db';
import {
  canTransition,
  CHANNEL_KINDS,
  DELIVERY_MODES,
  foldText,
  initialOrderStatus,
  isVnMobile,
  normalizePhone,
  ORDER_PAYMENT_METHODS,
  ORDER_SOURCES,
  ORDERS_NEEDING_ACTION,
  PAYMENT_REF_LENGTH,
  paymentRefFromBytes,
  pickupCodeFromBytes,
  priceCart,
  pricingChannel,
  RECIPIENT_MOBILE_MESSAGE,
  reviewReasons,
  vnd,
  WEB_ORDER,
  type CartLineInput,
  type ReviewReason,
} from '@bookstore/domain';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql, type SQL } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as customers from '../customers/index.js';
import * as identity from '../identity/index.js';
import * as inventory from '../inventory/index.js';
import * as notifications from '../notifications/index.js';
import * as promotions from '../promotions/index.js';
import * as sales from '../sales/index.js';
import * as settings from '../settings/index.js';
import { AppError, can, emit, errors, nextDocNo, requirePermission, sha256, type Ctx, type Tx } from '../platform/index.js';

/**
 * Online and social orders (FR-ORD-01..18, FR-SOC-01..04, TDD §4.5). Staff order entry and the
 * website checkout (release R2b) share `createOrderTx`; the source channel is an input, not the UI.
 */

export type OrderStatus = keyof typeof WEB_ORDER;
type OrderRow = typeof schema.webOrder.$inferSelect;

const money = z.number().int().min(0);
const REF = 'web_order';

/** Viewing and confirming an order: online staff, or anyone allowed to confirm website orders (FR-ORD-03). */
function requireOrderAccess(ctx: Ctx) {
  if (!ctx.actor) throw errors.unauthenticated();
  if (!can(ctx.actor, 'online.manage') && !can(ctx.actor, 'online.confirm')) throw errors.forbidden('online.confirm');
  return ctx.actor;
}

/** `a,b` (or an already-split array) → ["a", "b"], each checked against the allowed values; empty → undefined. */
const csvEnum = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (Array.isArray(v) ? v : v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).min(1).optional());

// =============================================================================================
// Channel profiles (FR-SOC-01)

export const ChannelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(CHANNEL_KINDS),
  url: z.url().max(300).nullable().optional(),
  handle: z.string().trim().max(80).nullable().optional(),
  active: z.boolean().default(true),
});

export async function listChannels(ctx: Ctx, opts: { activeOnly?: boolean } = {}) {
  requirePermission(ctx, 'online.manage');
  const c = schema.channel;
  return ctx.db
    .select()
    .from(c)
    .where(opts.activeOnly ? eq(c.active, true) : undefined)
    .orderBy(asc(c.kind), asc(c.name));
}

export async function createChannel(ctx: Ctx, input: z.input<typeof ChannelSchema>) {
  requirePermission(ctx, 'online.manage');
  const data = ChannelSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [dupe] = await tx.select({ id: schema.channel.id }).from(schema.channel).where(eq(schema.channel.name, data.name));
    if (dupe) throw errors.conflict('duplicate_channel', `Đã có kênh tên '${data.name}'.`);
    const [row] = await tx.insert(schema.channel).values({ ...data, url: data.url ?? null, handle: data.handle ?? null, createdAt: ctx.clock.now() }).returning({ id: schema.channel.id });
    await audit.record(tx, ctx, { action: 'channel.create', entity: 'channel', entityId: row!.id, after: data });
    return { id: row!.id };
  });
}

export async function updateChannel(ctx: Ctx, id: string, input: z.input<ReturnType<typeof ChannelSchema.partial>>) {
  requirePermission(ctx, 'online.manage');
  const data = ChannelSchema.partial().parse(input);
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.channel).where(eq(schema.channel.id, id)).for('update');
    if (!before) throw errors.notFound('Kênh bán');
    if (data.name && data.name !== before.name) {
      const [dupe] = await tx.select({ id: schema.channel.id }).from(schema.channel).where(eq(schema.channel.name, data.name));
      if (dupe) throw errors.conflict('duplicate_channel', `Đã có kênh tên '${data.name}'.`);
    }
    await tx.update(schema.channel).set(data).where(eq(schema.channel.id, id));
    await audit.record(tx, ctx, { action: 'channel.update', entity: 'channel', entityId: id, before, after: data });
    return { id };
  });
}

// =============================================================================================
// Address data (FR-ORD-06, TDD §8.2)

export async function listProvinces(ctx: Ctx) {
  if (!ctx.actor) throw errors.unauthenticated();
  return ctx.db.select({ id: schema.geoProvince.id, name: schema.geoProvince.name }).from(schema.geoProvince).orderBy(asc(schema.geoProvince.name));
}

/** Wards of a province; a name that occurs twice carries its old district to tell them apart (Design §10.3). */
export async function listWards(ctx: Ctx, provinceId: number) {
  if (!ctx.actor) throw errors.unauthenticated();
  const rows = await ctx.db
    .select({ code: schema.geoWard.code, name: schema.geoWard.name, districtName: schema.geoWard.districtName })
    .from(schema.geoWard)
    .where(eq(schema.geoWard.provinceId, provinceId))
    .orderBy(asc(schema.geoWard.name));
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(foldText(r.name), (seen.get(foldText(r.name)) ?? 0) + 1);
  return rows.map((r) => ({ code: r.code, name: r.name, label: (seen.get(foldText(r.name)) ?? 0) > 1 ? `${r.name} (${r.districtName})` : r.name }));
}

/** Province and ward of a delivery address, or null when the carrier data does not know them. */
async function resolveAddress(tx: Tx, a: { provinceId?: number | undefined; wardCode?: string | undefined; line: string }) {
  if (a.provinceId === undefined || !a.wardCode) return null;
  const [w] = await tx
    .select({ code: schema.geoWard.code, name: schema.geoWard.name, provinceId: schema.geoWard.provinceId, provinceName: schema.geoProvince.name })
    .from(schema.geoWard)
    .innerJoin(schema.geoProvince, eq(schema.geoProvince.id, schema.geoWard.provinceId))
    .where(and(eq(schema.geoWard.code, a.wardCode), eq(schema.geoWard.provinceId, a.provinceId)));
  return w ? { provinceId: w.provinceId, provinceName: w.provinceName, wardCode: w.code, wardName: w.name, line: a.line } : null;
}

// =============================================================================================
// Creating an order (FR-ORD-02, FR-SOC-03, UC-09)

const ManualDiscountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percent'), bp: z.number().int().min(0).max(10000) }),
  z.object({ kind: z.literal('amount'), vnd: money }),
]);

export const OrderLineSchema = z.object({
  lineId: z.string().min(1).max(40).optional(),
  variantId: z.uuid(),
  qty: z.number().int().positive(),
  manualDiscount: ManualDiscountSchema.nullable().optional(),
});

const OrderPricingSchema = z.object({
  source: z.enum(ORDER_SOURCES),
  customerId: z.uuid().nullable().optional(),
  lines: z.array(OrderLineSchema).min(1, 'Đơn chưa có sản phẩm.').max(200),
  shippingVnd: money.default(0),
  /** Manual discount on the whole order, a percentage only, within the role limit (FR-ORD-02, BR-05). */
  orderManualDiscount: z.object({ kind: z.literal('percent'), bp: z.number().int().min(0).max(10000) }).nullable().optional(),
  redeemPoints: z.number().int().min(0).optional(),
  /** An order slip at Chờ nhận handed to delivery (FR-ORD-14): its lines, customer and agreed prices. */
  preorderId: z.uuid().optional(),
});

export const CreateOrderSchema = OrderPricingSchema.extend({
  channelId: z.uuid().nullable().optional(),
  sourceRef: z.string().trim().max(300).nullable().optional(),
  externalId: z.string().trim().max(80).nullable().optional(),
  recipient: z.object({ name: z.string().trim().min(1, 'Cần nhập tên người nhận.').max(160), phone: z.string().trim().min(6, 'Cần nhập số điện thoại.') }),
  /** Chat handle, stored on the customer as an additional contact (FR-SOC-03). */
  contactHandle: z.string().trim().max(120).nullable().optional(),
  delivery: z.enum(DELIVERY_MODES).default('ship'),
  address: z
    .object({ provinceId: z.number().int().optional(), wardCode: z.string().trim().max(20).optional(), line: z.string().trim().max(300).default('') })
    .nullable()
    .optional(),
  paymentMethod: z.enum(ORDER_PAYMENT_METHODS),
  note: z.string().trim().max(1000).nullable().optional(),
  approvals: z.object({ discount_over_limit: z.string().optional() }).default({}),
});
export type CreateOrderInput = z.input<typeof CreateOrderSchema>;

interface VariantInfo {
  id: string;
  sku: string;
  title: string;
  priceVnd: number;
  vatBp: number;
  sellable: boolean;
  publisherId: string | null;
  brandId: string | null;
  categoryIds: string[];
}

async function loadVariants(tx: Tx, ids: string[]): Promise<Map<string, VariantInfo>> {
  const rows = await tx.execute<{
    id: string;
    sku: string;
    title: string;
    price_vnd: string;
    vat_bp: number;
    sellable: boolean;
    publisher_id: string | null;
    brand_id: string | null;
    category_ids: string[];
  }>(sql`
    select v.id, v.sku, i.i18n -> 'en' ->> 'title' as title, v.price_vnd, v.vat_bp,
           (v.status = 'active' and i.status = 'active') as sellable, i.publisher_id, i.brand_id,
           coalesce((select array_agg(ic.category_id) from catalog.item_category ic where ic.item_id = i.id), '{}') as category_ids
    from catalog.item_variant v join catalog.item i on i.id = v.item_id
    where v.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, sku: r.sku, title: r.title, priceVnd: Number(r.price_vnd), vatBp: r.vat_bp, sellable: r.sellable, publisherId: r.publisher_id, brandId: r.brand_id, categoryIds: r.category_ids },
    ]),
  );
}

/**
 * Price an order like a counter sale, with the channel of its source (TDD §4.5): promotions for
 * that channel, tier discount, points, line discounts within the role limit, shipping.
 */
async function priceOrder(tx: Tx, ctx: Ctx, data: z.infer<typeof OrderPricingSchema>, agreed?: ReadonlyMap<string, number>) {
  const variants = await loadVariants(tx, [...new Set(data.lines.map((l) => l.variantId))]);
  // A slip's agreed prices, without promotions (FR-ORD-14, FR-POS-09).
  for (const [variantId, priceVnd] of agreed ?? []) {
    const v = variants.get(variantId);
    if (v) v.priceVnd = priceVnd;
  }
  const lines: CartLineInput[] = data.lines.map((l, i) => {
    const v = variants.get(l.variantId);
    if (!v) throw errors.notFound('Sản phẩm');
    if (!v.sellable) throw new AppError(409, 'item_not_for_sale', `'${v.title}' (${v.sku}) đang ẩn hoặc ngừng bán.`, { variantId: v.id });
    return {
      lineId: l.lineId ?? String(i + 1),
      variantId: v.id,
      itemClass: 'goods',
      categoryIds: v.categoryIds,
      publisherId: v.publisherId,
      brandId: v.brandId,
      qty: l.qty,
      unitPriceVnd: vnd(v.priceVnd),
      vatBp: v.vatBp,
      priceOverrideVnd: null,
      manualDiscount: l.manualDiscount ? (l.manualDiscount.kind === 'percent' ? l.manualDiscount : { kind: 'amount', vnd: vnd(l.manualDiscount.vnd) }) : null,
    };
  });
  const cfg = await settings.snapshot(ctx, tx);
  const customerId = data.customerId ?? null;
  const channel = pricingChannel(data.source);
  const result = priceCart({
    lines,
    channel,
    customer: customerId ? await customers.pricingProfile(tx, customerId) : null,
    promotions: agreed ? [] : await promotions.activeSnapshot(tx, ctx.clock.now(), channel, customerId),
    orderManualDiscount: data.orderManualDiscount ?? null,
    redeemPoints: data.redeemPoints ?? 0,
    shippingVnd: vnd(data.shippingVnd),
    settings: {
      cashierDiscountMaxBp: cfg['sale.cashier_discount_max_bp'],
      earnVndPerPoint: cfg['loyalty.earn_vnd_per_point'],
      pointValueVnd: cfg['loyalty.point_value_vnd'],
      minRedeemPoints: cfg['loyalty.min_redeem_points'],
      categoryMaxDiscountBp: {},
    },
    grants: { discountUnlimited: can(ctx.actor, 'sale.discount_unlimited'), priceOverride: false },
  });
  return { result, variants, cfg };
}

/**
 * An order slip handed to delivery (FR-ORD-14): Chờ nhận, every book linked and priced, the order for
 * the slip's customer with exactly its books and quantities, and no manual discount.
 */
async function preorderForDelivery(tx: Tx, data: z.infer<typeof OrderPricingSchema>, lock: boolean) {
  if (!data.preorderId) return null;
  const q = tx.select().from(schema.preorder).where(eq(schema.preorder.id, data.preorderId));
  const [p] = lock ? await q.for('update') : await q;
  if (!p) throw errors.notFound('Phiếu đặt trước');
  // A hold (Contacted) is collected in store only; an order must be Chờ nhận.
  if (p.status !== 'arrived') throw errors.conflict('preorder_not_ready', `Phiếu ${p.docNo} chưa ở trạng thái Chờ nhận, là phiếu giữ sách hoặc đã xử lý xong.`);
  const slipLines = await tx.select().from(schema.preorderLine).where(eq(schema.preorderLine.preorderId, p.id));
  if (slipLines.some((l) => !l.variantId || l.unitPriceVnd == null)) throw errors.conflict('preorder_not_ready', `Phiếu ${p.docNo} còn sách chưa chọn sản phẩm.`);
  if (data.customerId && data.customerId !== p.customerId) throw new AppError(422, 'preorder_customer', `Phiếu ${p.docNo} là của khách khác.`);
  const same = slipLines.length === data.lines.length && slipLines.every((pl) => data.lines.filter((l) => l.variantId === pl.variantId && l.qty === pl.qty && !l.manualDiscount).length === 1);
  if (!same || data.orderManualDiscount) throw new AppError(422, 'preorder_line', `Đơn giao cần đúng các sách và số lượng của phiếu ${p.docNo}, theo giá đã thỏa thuận, không giảm giá thêm.`);
  return { ...p, agreed: new Map(slipLines.map((l) => [l.variantId!, l.unitPriceVnd!])) };
}

/** The cheaper of the slip's agreed prices without promotions and today's online prices with promotions (FR-ORD-14). */
async function priceForOrder(tx: Tx, ctx: Ctx, data: z.infer<typeof OrderPricingSchema>, pre: Awaited<ReturnType<typeof preorderForDelivery>>) {
  const today = await priceOrder(tx, ctx, data);
  if (!pre) return today;
  const agreed = await priceOrder(tx, ctx, data, pre.agreed);
  return agreed.result.totalVnd <= today.result.totalVnd ? agreed : today;
}

export const QuoteSchema = OrderPricingSchema;

/** Price preview for the order form (same engine as `createOrder`). */
export async function quote(ctx: Ctx, input: z.input<typeof QuoteSchema>) {
  requirePermission(ctx, 'online.manage');
  const data = QuoteSchema.parse(input);
  const pre = await preorderForDelivery(ctx.db, data, false);
  const { result, variants } = await priceForOrder(ctx.db, ctx, { ...data, customerId: pre?.customerId ?? data.customerId }, pre);
  return { ...result, depositVnd: pre?.depositVnd ?? 0, lines: result.lines.map((l) => ({ ...l, sku: variants.get(l.variantId)!.sku, title: variants.get(l.variantId)!.title })) };
}

async function newPaymentRef(tx: Tx): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const ref = paymentRefFromBytes(randomBytes(PAYMENT_REF_LENGTH));
    const [taken] = await tx.select({ id: schema.webOrder.id }).from(schema.webOrder).where(eq(schema.webOrder.paymentRef, ref));
    if (!taken) return ref;
  }
  throw new AppError(409, 'payment_ref_exhausted', 'Chưa tạo được mã chuyển khoản. Hãy thử lại.');
}

/** Earlier orders to the same phone that the carrier brought back (BR-30, suspected abuse). */
async function failedDeliveries(tx: Tx, phoneE164: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`
    select count(distinct o.id)::int as n from orders.web_order o join orders.shipment s on s.order_id = o.id
    where o.recipient ->> 'phone' = ${phoneE164} and s.status = 'returned'`);
  return r?.n ?? 0;
}

/** Find the customer by phone or create one (BR-16, FR-SOC-03); store the chat handle as a contact. */
async function resolveCustomer(tx: Tx, ctx: Ctx, data: z.infer<typeof CreateOrderSchema>, phoneE164: string): Promise<string> {
  let customerId = data.customerId ?? null;
  if (customerId) {
    const [c] = await tx.select({ id: schema.customer.id }).from(schema.customer).where(eq(schema.customer.id, customerId));
    if (!c) throw errors.notFound('Khách hàng');
  } else {
    const [c] = await tx.select({ id: schema.customer.id }).from(schema.customer).where(eq(schema.customer.phoneE164, phoneE164));
    customerId = c?.id ?? (await customers.createCustomerTx(tx, ctx, { name: data.recipient.name, phone: phoneE164, source: data.source })).id;
  }
  const handle = data.contactHandle?.trim();
  if (handle) {
    const kind = data.source;
    const [known] = await tx
      .select({ id: schema.customerContact.id })
      .from(schema.customerContact)
      .where(and(eq(schema.customerContact.customerId, customerId), eq(schema.customerContact.kind, kind), eq(schema.customerContact.value, handle)));
    if (!known) await tx.insert(schema.customerContact).values({ customerId, kind, value: handle });
  }
  return customerId;
}

/** Stock-holding units an order still needs to reserve, per variant (bundles resolve to components). */
async function missingUnits(tx: Tx, orderId: string): Promise<Map<string, number>> {
  const lines = await tx.select().from(schema.orderLine).where(eq(schema.orderLine.orderId, orderId));
  const need = new Map<string, number>();
  for (const l of lines) for (const u of await inventory.stockUnits(tx, l.variantId, l.qty)) need.set(u.variantId, (need.get(u.variantId) ?? 0) + u.qty);
  const held = await tx
    .select({ variantId: schema.stockReservation.variantId, qty: schema.stockReservation.qty })
    .from(schema.stockReservation)
    .where(and(eq(schema.stockReservation.refType, REF), eq(schema.stockReservation.refId, orderId), eq(schema.stockReservation.status, 'active')));
  for (const h of held) need.set(h.variantId, (need.get(h.variantId) ?? 0) - h.qty);
  for (const [k, v] of need) if (v <= 0) need.delete(k);
  return need;
}

/** Reserve what an order still lacks; true when it is fully reserved afterwards. */
async function reserveMissing(tx: Tx, ctx: Ctx, orderId: string): Promise<boolean> {
  let all = true;
  for (const [variantId, qty] of [...(await missingUnits(tx, orderId))].sort(([a], [b]) => a.localeCompare(b))) {
    if (!(await inventory.reserve(tx, ctx, REF, orderId, variantId, qty))) all = false;
  }
  return all;
}

export interface CreateOrderOptions {
  /** Staff member keying the order; null for website checkout (R2b). */
  createdBy: string | null;
}

/** The order service shared by staff entry and the website checkout (release R2b). */
export async function createOrderTx(tx: Tx, ctx: Ctx, data: z.infer<typeof CreateOrderSchema>, opts: CreateOrderOptions) {
  const phoneE164 = normalizePhone(data.recipient.phone);
  if (!phoneE164) throw new AppError(400, 'invalid_phone', `Số điện thoại '${data.recipient.phone}' không hợp lệ.`);
  // The carrier takes only Vietnamese mobile numbers (FR-ORD-02).
  if (data.delivery === 'ship' && !isVnMobile(phoneE164)) throw new AppError(422, 'invalid_recipient_phone', RECIPIENT_MOBILE_MESSAGE);
  if (data.externalId) {
    const [dupe] = await tx.select({ id: schema.webOrder.id, docNo: schema.webOrder.docNo }).from(schema.webOrder).where(and(eq(schema.webOrder.source, data.source), eq(schema.webOrder.externalId, data.externalId)));
    if (dupe) throw errors.conflict('duplicate_external_id', `Đơn này đã được nhập: ${dupe.docNo}.`, { orderId: dupe.id });
  }
  if (data.channelId) {
    const [ch] = await tx.select({ kind: schema.channel.kind }).from(schema.channel).where(eq(schema.channel.id, data.channelId));
    if (!ch) throw errors.notFound('Kênh bán');
  }
  const pre = await preorderForDelivery(tx, data, true);
  // From a slip the order is the slip's customer, whatever recipient name and phone staff enter (FR-ORD-14).
  const customerId = pre ? pre.customerId : await resolveCustomer(tx, ctx, data, phoneE164);
  const { result: priced, variants, cfg } = await priceForOrder(tx, ctx, { ...data, customerId }, pre);
  const depositVnd = pre?.depositVnd ?? 0;
  if (depositVnd > priced.totalVnd) {
    throw new AppError(422, 'deposit_exceeds_total', `Tiền cọc ${depositVnd} ₫ lớn hơn tổng đơn ${priced.totalVnd} ₫. Hãy để khách nhận tại quầy.`, { depositVnd, totalVnd: priced.totalVnd });
  }
  if (priced.issues.length) throw new AppError(422, 'pricing_issue', 'Không áp dụng được mã giảm giá hoặc điểm. Hãy kiểm tra lại rồi thử lại.', priced.issues);
  if (priced.approvalsRequired.length) {
    const token = data.approvals.discount_over_limit;
    if (!token) throw new AppError(403, 'approval_required', 'Giảm giá vượt hạn mức của bạn, cần quản lý duyệt.', { action: 'discount_over_limit', ...priced.approvalsRequired[0] });
    await identity.consumeApproval(tx, ctx, token, 'discount_over_limit');
  }
  const address = data.delivery === 'ship' ? await resolveAddress(tx, data.address ?? { line: '' }) : null;
  const now = ctx.clock.now();
  const docNo = await nextDocNo(tx, 'ORD', now);
  const [order] = await tx
    .insert(schema.webOrder)
    .values({
      docNo,
      source: data.source,
      sourceRef: data.sourceRef ?? (pre ? pre.docNo : null),
      externalId: data.externalId ?? null,
      channelId: data.channelId ?? null,
      customerId,
      preorderId: pre?.id ?? null,
      depositVnd,
      recipient: { name: data.recipient.name, phone: phoneE164 },
      delivery: data.delivery,
      // An unresolvable address is still kept, so staff can complete it (incomplete_address).
      address: data.delivery === 'ship' ? (address ?? { provinceId: data.address?.provinceId ?? 0, provinceName: '', wardCode: data.address?.wardCode ?? '', wardName: '', line: data.address?.line ?? '' }) : null,
      status: 'new',
      paymentMethod: data.paymentMethod,
      paymentRef: data.paymentMethod === 'transfer' ? await newPaymentRef(tx) : null,
      subtotalVnd: priced.subtotalVnd,
      discountVnd: priced.discountVnd,
      shippingVnd: priced.shippingVnd - priced.shippingDiscountVnd,
      totalVnd: priced.totalVnd,
      vatVnd: priced.vatVnd,
      pointsRedeemed: priced.redeemPoints,
      pointsDiscountVnd: priced.redeemValueVnd,
      // Points to credit when the order is Done (BR-19, BR-29).
      pointsEarned: priced.pointsToEarn,
      note: data.note ?? null,
      createdBy: opts.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const orderId = order!.id;
  for (const [i, l] of priced.lines.entries()) {
    await tx.insert(schema.orderLine).values({
      orderId,
      lineNo: i + 1,
      variantId: l.variantId,
      description: variants.get(l.variantId)!.title,
      qty: l.qty,
      unitPriceVnd: l.unitPriceVnd,
      discountVnd: l.discountVnd,
      totalVnd: l.totalVnd,
      vatBp: l.vatBp,
      vatVnd: l.vatVnd,
      promotionVersionIds: l.promotionVersionIds,
    });
  }
  // The slip is settled by this order (FR-ORD-14): Đã nhận, linked; anything it held passes to the order.
  if (pre) {
    await inventory.endReservations(tx, ctx, 'preorder', pre.id, 'converted');
    await tx.update(schema.preorder).set({ status: 'collected', orderId }).where(eq(schema.preorder.id, pre.id));
    await audit.record(tx, ctx, { action: 'preorder.to_delivery', entity: 'preorder', entityId: pre.id, before: { status: pre.status }, after: { status: 'collected', orderId, docNo } });
  }
  // Hold what is available now (BR-29); confirming reserves the rest.
  const allReserved = await reserveMissing(tx, ctx, orderId);
  const reasons = reviewReasons({
    allReserved,
    delivery: data.delivery,
    addressResolvable: address !== null && address.line.trim() !== '',
    paymentMethod: data.paymentMethod,
    paid: false,
    totalVnd: priced.totalVnd,
    failedDeliveries: await failedDeliveries(tx, phoneE164),
    settings: { highValueVnd: cfg['order.review_high_value_vnd'], failedDeliveries: cfg['order.review_failed_deliveries'] },
  });
  // A social or phone order keyed by staff (“Tạo đơn giao”) is confirmed at once – no review and no
  // transfer check before the shipment (FR-ORD-02). It needs its stock held; otherwise it waits for
  // stock like any order. Website orders go through review and confirmation on Orders (FR-ORD-03).
  const staffConfirmed = opts.createdBy !== null && data.source !== 'website' && allReserved;
  const status = staffConfirmed ? 'confirmed' : initialOrderStatus(reasons);
  if (staffConfirmed) reasons.length = 0;
  await tx.update(schema.webOrder).set({ status, reviewReasons: reasons }).where(eq(schema.webOrder.id, orderId));
  await tx.insert(schema.orderEvent).values({ orderId, fromStatus: null, toStatus: status, actorId: opts.createdBy, at: now, reason: reasons.length ? reasons.join(',') : null });
  // An order waiting for confirmation or review tells the staff who work orders (FR-ADM-08, TDD §4.12).
  if (status === 'new' || status === 'pending_review') {
    await notifications.notifyHolders(tx, ['online.confirm', 'online.manage'], 'order.needs_action', { kind: 'web_order', id: orderId, docNo, reason: status === 'new' ? 'confirm' : 'review' });
  }
  // A new order to ship by carrier, keyed on Tạo đơn giao and confirmed at once (FR-ADM-08, TDD §4.12).
  if (status === 'confirmed' && data.delivery === 'ship') {
    await notifications.notifyHolders(tx, 'online.manage', 'delivery.update', { id: orderId, docNo, event: 'new' }, { except: opts.createdBy });
  }

  if (priced.redeemPoints > 0) await customers.post(tx, ctx, { customerId, delta: -priced.redeemPoints, reason: 'redeem', refType: REF, refId: orderId });
  const uses = new Map<string, { discountVnd: number; revenueVnd: number }>();
  for (const l of priced.lines) {
    for (const s of l.savings) {
      const u = uses.get(s.promotionId) ?? { discountVnd: 0, revenueVnd: 0 };
      u.discountVnd += s.amountVnd;
      u.revenueVnd += l.totalVnd;
      uses.set(s.promotionId, u);
    }
  }
  await promotions.recordUsage(tx, [...uses].map(([promotionId, u]) => ({ promotionId, ...u })), { refType: REF, refId: orderId, customerId });
  await audit.record(tx, ctx, { action: 'order.create', entity: REF, entityId: orderId, after: { docNo, source: data.source, totalVnd: priced.totalVnd, status } });
  await emit(tx, 'order.status_changed', { orderId, from: null, to: status });
  return { id: orderId, docNo, status, totalVnd: priced.totalVnd, paymentRef: order!.paymentRef, reviewReasons: reasons, customerId };
}

export async function createOrder(ctx: Ctx, input: CreateOrderInput, idempotencyKey?: string) {
  const actor = requirePermission(ctx, 'online.manage');
  const data = CreateOrderSchema.parse(input);
  return sales.idempotent(ctx, idempotencyKey, data, (tx) => createOrderTx(tx, ctx, data, { createdBy: actor.userId }));
}

// =============================================================================================
// Inbox (FR-ORD-05) and order record

export const OrdersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: csvEnum(Object.keys(WEB_ORDER) as [OrderStatus, ...OrderStatus[]]),
  source: csvEnum(ORDER_SOURCES),
  /** The Delivery screen: confirmed orders shipped by carrier, by stage (FR-ORD-01). */
  scope: z.enum(['all', 'delivery']).default('all'),
  stage: csvEnum(['waiting', 'shipping', 'delivered', 'failed'] as const),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(40),
});

const needsAction = sql`(${schema.webOrder.status} in (${sql.join(ORDERS_NEEDING_ACTION.map((s) => sql`${s}`), sql`, `)}))`;

/** Search by order code, recipient, phone and tracking number; filter by status, source, dates; action first. */
export async function listOrders(ctx: Ctx, input: z.input<typeof OrdersQuery>) {
  requirePermission(ctx, 'online.manage');
  const q = OrdersQuery.parse(input);
  const o = schema.webOrder;
  const where: SQL[] = [];
  if (q.source) where.push(inArray(o.source, q.source));
  if (q.scope === 'delivery') where.push(sql`${o.delivery} = 'ship' and ${o.status} not in ('new', 'pending_review', 'cancelled')`);
  if (q.from) where.push(gte(o.createdAt, new Date(q.from)));
  if (q.to) where.push(lte(o.createdAt, new Date(q.to)));
  if (q.q) {
    const term = q.q;
    const digits = term.replace(/\D/g, '');
    where.push(sql`(
      ${o.docNo} ilike ${`%${term}%`}
      or lower(public.f_unaccent(${o.recipient} ->> 'name')) like ${`%${foldText(term)}%`}
      ${digits.length >= 4 ? sql`or ${o.recipient} ->> 'phone' like ${`%${digits.slice(-9)}%`}` : sql``}
      or exists (select 1 from orders.shipment s where s.order_id = ${o.id} and s.tracking_no ilike ${`%${term}%`}))`);
  }
  const base = where.length ? and(...where) : undefined;
  const counts = await ctx.db.select({ status: o.status, n: sql<number>`count(*)::int` }).from(o).where(base).groupBy(o.status);
  const stageOf = sql<string>`(case
      when ${o.status} in ('confirmed', 'packing') then 'waiting'
      when ${o.status} = 'shipping' then 'shipping'
      when ${o.status} = 'done' then 'delivered'
      else 'failed' end)`;
  const stageCounts = q.scope === 'delivery' ? await ctx.db.select({ stage: stageOf, n: sql<number>`count(*)::int` }).from(o).where(base).groupBy(stageOf) : [];
  let filtered = q.status ? and(base, inArray(o.status, q.status)) : base;
  if (q.stage) filtered = and(filtered, sql`${stageOf} in (${sql.join(q.stage.map((x) => sql`${x}`), sql`, `)})`);
  const items = await ctx.db
    .select({
      id: o.id,
      docNo: o.docNo,
      createdAt: o.createdAt,
      recipient: o.recipient,
      source: o.source,
      channelName: schema.channel.name,
      items: sql<number>`(select coalesce(sum(l.qty), 0)::int from orders.order_line l where l.order_id = ${o.id})`,
      totalVnd: o.totalVnd,
      paymentMethod: o.paymentMethod,
      paidAt: o.paidAt,
      status: o.status,
      reviewReasons: o.reviewReasons,
      delivery: o.delivery,
      readAt: o.readAt,
      trackingNo: sql<string | null>`(select s.tracking_no from orders.shipment s where s.order_id = ${o.id} and s.status <> 'cancelled' order by s.created_at desc limit 1)`,
    })
    .from(o)
    .leftJoin(schema.channel, eq(schema.channel.id, o.channelId))
    .where(filtered)
    .orderBy(desc(needsAction), desc(o.createdAt), desc(o.id))
    .limit(q.limit)
    .offset((q.page - 1) * q.limit);
  const [total] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(o).where(filtered);
  return {
    items,
    page: q.page,
    total: total?.n ?? 0,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<OrderStatus, number>>,
    ...(q.scope === 'delivery' && { stages: Object.fromEntries(stageCounts.map((c) => [c.stage, c.n])) as Record<string, number> }),
  };
}

export const LastAddressQuery = z.object({ customerId: z.uuid() });

/** Address of the customer's most recent delivery order, to prefill “Tạo đơn giao” (FR-SOC-03). */
export async function lastAddress(ctx: Ctx, input: z.input<typeof LastAddressQuery>) {
  requirePermission(ctx, 'online.manage');
  const q = LastAddressQuery.parse(input);
  const [o] = await ctx.db
    .select({ address: schema.webOrder.address })
    .from(schema.webOrder)
    .where(and(eq(schema.webOrder.customerId, q.customerId), eq(schema.webOrder.delivery, 'ship')))
    .orderBy(desc(schema.webOrder.createdAt))
    .limit(1);
  return { address: o?.address ?? null };
}

export async function getOrder(ctx: Ctx, id: string, opts: { markRead?: boolean } = { markRead: true }) {
  requireOrderAccess(ctx);
  const [o] = await ctx.db.select().from(schema.webOrder).where(eq(schema.webOrder.id, id));
  if (!o) throw errors.notFound('Đơn hàng');
  if (opts.markRead && !o.readAt) await ctx.db.update(schema.webOrder).set({ readAt: ctx.clock.now() }).where(eq(schema.webOrder.id, id));
  const showCost = can(ctx.actor, 'report.profit');
  const lines = await ctx.db
    .select({ l: schema.orderLine, sku: schema.itemVariant.sku })
    .from(schema.orderLine)
    .innerJoin(schema.itemVariant, eq(schema.itemVariant.id, schema.orderLine.variantId))
    .where(eq(schema.orderLine.orderId, id))
    .orderBy(asc(schema.orderLine.lineNo));
  const events = await ctx.db
    .select({ id: schema.orderEvent.id, fromStatus: schema.orderEvent.fromStatus, toStatus: schema.orderEvent.toStatus, at: schema.orderEvent.at, reason: schema.orderEvent.reason, actor: schema.appUser.displayName })
    .from(schema.orderEvent)
    .leftJoin(schema.appUser, eq(schema.appUser.id, schema.orderEvent.actorId))
    .where(eq(schema.orderEvent.orderId, id))
    .orderBy(desc(schema.orderEvent.at), desc(schema.orderEvent.id));
  const shipments = await ctx.db.select().from(schema.shipment).where(eq(schema.shipment.orderId, id)).orderBy(desc(schema.shipment.createdAt));
  const returns = await ctx.db.select().from(schema.returnRequest).where(eq(schema.returnRequest.orderId, id)).orderBy(desc(schema.returnRequest.createdAt));
  const [customer] = o.customerId
    ? await ctx.db
        .select({ id: schema.customer.id, name: schema.customer.name, phoneE164: schema.customer.phoneE164, tierName: schema.tier.name, pointsBalance: schema.customer.pointsBalance })
        .from(schema.customer)
        .leftJoin(schema.tier, eq(schema.tier.id, schema.customer.tierId))
        .where(eq(schema.customer.id, o.customerId))
    : [];
  const [ch] = o.channelId ? await ctx.db.select({ name: schema.channel.name }).from(schema.channel).where(eq(schema.channel.id, o.channelId)) : [];
  const { pickupCodeHash, ...rest } = o;
  return {
    ...rest,
    hasPickupCode: pickupCodeHash !== null,
    channelName: ch?.name ?? null,
    customer: customer ?? null,
    lines: lines.map(({ l, sku }) => {
      const { costVnd, ...line } = l;
      return { ...line, sku, ...(showCost && { costVnd }) };
    }),
    events,
    shipments,
    returns,
  };
}

// =============================================================================================
// Lifecycle (FR-ORD-07..09, SRS Appendix B.1)

async function lockOrder(tx: Tx, id: string): Promise<OrderRow> {
  const [o] = await tx.select().from(schema.webOrder).where(eq(schema.webOrder.id, id)).for('update');
  if (!o) throw errors.notFound('Đơn hàng');
  return o;
}

const STATUS_VI: Record<OrderStatus, string> = {
  new: 'Mới',
  pending_review: 'Cần xem xét',
  confirmed: 'Đã xác nhận',
  packing: 'Đang đóng gói',
  shipping: 'Đang giao',
  done: 'Hoàn tất',
  return_requested: 'Yêu cầu trả',
  return_approved: 'Đã duyệt trả',
  returned: 'Đã trả hàng',
  cancelled: 'Đã hủy',
};

/** Change status: checked against the state machine, time-stamped and attributed (FR-ORD-07). */
export async function transition(tx: Tx, ctx: Ctx, o: OrderRow, to: OrderStatus, reason: string | null = null, extra: Partial<typeof schema.webOrder.$inferInsert> = {}): Promise<void> {
  const from = o.status as OrderStatus;
  if (!canTransition(WEB_ORDER, from, to)) {
    throw errors.conflict('invalid_transition', `Đơn ${o.docNo} đang ở trạng thái “${STATUS_VI[from]}”, không chuyển sang “${STATUS_VI[to]}” được.`, { from, to });
  }
  const now = ctx.clock.now();
  await tx
    .update(schema.webOrder)
    .set({ ...extra, status: to, updatedAt: now, version: sql`${schema.webOrder.version} + 1` })
    .where(eq(schema.webOrder.id, o.id));
  await tx.insert(schema.orderEvent).values({ orderId: o.id, fromStatus: from, toStatus: to, actorId: ctx.actor?.userId ?? null, at: now, reason });
  await emit(tx, 'order.status_changed', { orderId: o.id, from, to });
  o.status = to;
}

async function confirmTx(tx: Tx, ctx: Ctx, o: OrderRow): Promise<void> {
  if (o.status !== 'new' && o.status !== 'pending_review') {
    throw errors.conflict('invalid_transition', `Đơn ${o.docNo} đang ở trạng thái “${STATUS_VI[o.status as OrderStatus]}”, không xác nhận được.`);
  }
  if (o.paymentMethod === 'transfer' && !o.paidAt) {
    throw errors.conflict('payment_required', `Đơn ${o.docNo} chưa nhận được chuyển khoản. Hãy xác nhận chuyển khoản trước.`);
  }
  if (!(await reserveMissing(tx, ctx, o.id))) {
    throw new AppError(409, 'insufficient_stock', `Đơn ${o.docNo} chưa đủ hàng để xác nhận. Giảm số lượng, chờ nhập hàng hoặc chuyển thành đơn đặt trước.`);
  }
  await transition(tx, ctx, o, 'confirmed', null, { reviewReasons: [] });
  // A confirmed order to ship by carrier is a new delivery order (FR-ADM-08, TDD §4.12).
  if (o.delivery === 'ship') {
    await notifications.notifyHolders(tx, 'online.manage', 'delivery.update', { id: o.id, docNo: o.docNo, event: 'new' }, { except: ctx.actor?.userId ?? null });
  }
}

export async function confirm(ctx: Ctx, id: string) {
  requireOrderAccess(ctx);
  return ctx.db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    await confirmTx(tx, ctx, o);
    return { id, status: o.status };
  });
}

export const BulkConfirmSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100) });

/** Confirm several orders, each in its own transaction, with a result per order (FR-ORD-13). */
export async function bulkConfirm(ctx: Ctx, input: z.input<typeof BulkConfirmSchema>) {
  requireOrderAccess(ctx);
  const { ids } = BulkConfirmSchema.parse(input);
  const results: { id: string; ok: boolean; code?: string; message?: string }[] = [];
  for (const id of ids) {
    try {
      await confirm(ctx, id);
      results.push({ id, ok: true });
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      results.push({ id, ok: false, code: e.code, message: e.message });
    }
  }
  return { results, confirmed: results.filter((r) => r.ok).length };
}

export async function pack(ctx: Ctx, id: string) {
  requirePermission(ctx, 'online.manage');
  return ctx.db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    await transition(tx, ctx, o, 'packing');
    return { id, status: o.status };
  });
}

export const CancelSchema = z.object({ reason: z.string().trim().min(1, 'Cần nhập lý do hủy đơn.').max(500) });

async function cancelTx(tx: Tx, ctx: Ctx, o: OrderRow, reason: string) {
  await inventory.endReservations(tx, ctx, REF, o.id, 'released');
  if (o.customerId && o.pointsRedeemed > 0) {
    await customers.post(tx, ctx, { customerId: o.customerId, delta: o.pointsRedeemed, reason: 'redeem_refund', refType: REF, refId: o.id });
  }
  // Promotion usage counts only orders that go ahead (FR-PRM-06).
  await tx.delete(schema.promotionUsage).where(and(eq(schema.promotionUsage.refType, REF), eq(schema.promotionUsage.refId, o.id)));
  await transition(tx, ctx, o, 'cancelled', reason, { cancelledAt: ctx.clock.now(), cancelReason: reason, reviewReasons: [] });
  await audit.record(tx, ctx, { action: 'order.cancel', entity: REF, entityId: o.id, after: { reason } });
  // A paid transfer is refunded outside the system (no payment gateway, SRS §2.6).
  return { id: o.id, status: o.status, refundDueVnd: o.paidAt ? o.totalVnd : 0 };
}

export async function cancel(ctx: Ctx, id: string, input: z.input<typeof CancelSchema>) {
  requirePermission(ctx, 'online.manage');
  const { reason } = CancelSchema.parse(input);
  return ctx.db.transaction(async (tx) => cancelTx(tx, ctx, await lockOrder(tx, id), reason));
}

// =============================================================================================
// Bank transfer (FR-ORD-08, TDD §8.4)

export const ConfirmPaymentSchema = z.object({ amountVnd: z.number().int().positive() });

/** Staff saw the transfer with the reference and amount; a clean order becomes Confirmed (UC-08). */
export async function confirmPayment(ctx: Ctx, id: string, input: z.input<typeof ConfirmPaymentSchema>) {
  const actor = requirePermission(ctx, 'online.confirm_payment');
  const data = ConfirmPaymentSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.paymentMethod !== 'transfer') throw errors.conflict('not_transfer', `Đơn ${o.docNo} thanh toán khi nhận hàng (COD), không cần xác nhận chuyển khoản.`);
    if (o.paidAt) throw errors.conflict('already_paid', `Đơn ${o.docNo} đã được xác nhận chuyển khoản.`);
    if (o.status === 'cancelled') throw errors.conflict('order_cancelled', `Đơn ${o.docNo} đã hủy. Hãy hoàn tiền cho khách ngoài hệ thống.`);
    // A pre-order's deposit counts as paid (FR-ORD-14).
    const dueVnd = o.totalVnd - o.depositVnd;
    if (data.amountVnd !== dueVnd) {
      throw new AppError(422, 'amount_mismatch', `Số tiền nhận ${data.amountVnd} ₫ chưa khớp với số còn phải thu ${dueVnd} ₫.`, { amountVnd: data.amountVnd, totalVnd: o.totalVnd, depositVnd: o.depositVnd });
    }
    const now = ctx.clock.now();
    const reasons = (o.reviewReasons as ReviewReason[]).filter((r) => r !== 'unpaid_transfer');
    await tx.update(schema.webOrder).set({ paidAt: now, paidConfirmedBy: actor.userId, reviewReasons: reasons, updatedAt: now }).where(eq(schema.webOrder.id, id));
    o.paidAt = now;
    o.reviewReasons = reasons;
    await audit.record(tx, ctx, { action: 'order.confirm_payment', entity: REF, entityId: id, after: { amountVnd: data.amountVnd, paymentRef: o.paymentRef } });
    if (o.status === 'new' || o.status === 'pending_review') {
      if (reasons.length === 0 && (await reserveMissing(tx, ctx, id))) await transition(tx, ctx, o, 'confirmed', 'payment_confirmed');
      else if (o.status === 'new') {
        const left: ReviewReason[] = reasons.length ? reasons : ['out_of_stock'];
        await transition(tx, ctx, o, 'pending_review', left.join(','), { reviewReasons: left });
      }
    }
    return { id, status: o.status, paidAt: now };
  });
}

/** `order.autocancel` (TDD §9.1, BR-09): unpaid transfer orders past the timeout release their stock. */
export async function autocancelUnpaid(ctx: Ctx): Promise<number> {
  const cfg = await settings.snapshot(ctx);
  const cutoff = new Date(ctx.clock.now().getTime() - cfg['order.transfer_timeout_h'] * 3600_000);
  const due = await ctx.db
    .select({ id: schema.webOrder.id })
    .from(schema.webOrder)
    .where(and(eq(schema.webOrder.paymentMethod, 'transfer'), sql`${schema.webOrder.paidAt} is null`, inArray(schema.webOrder.status, ['new', 'pending_review']), lt(schema.webOrder.createdAt, cutoff)))
    .limit(200);
  let n = 0;
  for (const { id } of due) {
    await ctx.db.transaction(async (tx) => {
      const o = await lockOrder(tx, id);
      if (o.paidAt || (o.status !== 'new' && o.status !== 'pending_review')) return;
      await cancelTx(tx, ctx, o, `Quá ${cfg['order.transfer_timeout_h']} giờ chưa nhận chuyển khoản`);
      n++;
    });
  }
  return n;
}

// =============================================================================================
// Handover, shipments and completion (FR-ORD-10..12, BR-29)

/** Take the order's stock out: reservations become `sale` movements; record cost and consignment. */
async function takeStockOut(tx: Tx, ctx: Ctx, o: OrderRow): Promise<void> {
  const missing = await missingUnits(tx, o.id);
  if (missing.size) throw new AppError(409, 'insufficient_stock', `Đơn ${o.docNo} chưa giữ đủ hàng.`);
  await inventory.endReservations(tx, ctx, REF, o.id, 'converted');
  const lines = await tx.select().from(schema.orderLine).where(eq(schema.orderLine.orderId, o.id)).orderBy(asc(schema.orderLine.lineNo));
  const now = ctx.clock.now();
  for (const l of lines) {
    const unitCost = await sales.deductStock(tx, ctx, o.id, l.variantId, l.qty, false, REF);
    await tx.update(schema.orderLine).set({ costVnd: unitCost * l.qty }).where(eq(schema.orderLine.id, l.id));
    // Consignors are paid on the selling price before store discounts (TDD §4.3).
    await sales.allocateConsignment(tx, l.id, l.variantId, l.qty, l.unitPriceVnd, now);
  }
}

/** Done: the order counts as revenue, earns points and is e-invoiced (BR-29). */
async function completeTx(tx: Tx, ctx: Ctx, o: OrderRow, reason: string | null): Promise<void> {
  const now = ctx.clock.now();
  await transition(tx, ctx, o, 'done', reason, { doneAt: now, ...(o.paymentMethod === 'cod' && !o.paidAt && { paidAt: now }) });
  if (o.customerId && o.pointsEarned > 0) {
    await customers.post(tx, ctx, { customerId: o.customerId, delta: o.pointsEarned, reason: 'earn', refType: REF, refId: o.id });
  }
  const cfg = await settings.snapshot(ctx, tx);
  if (cfg['pos.einvoice_mode'] === 'every_sale') {
    await tx.insert(schema.einvoiceJob).values({ orderId: o.id, status: 'pending', nextAttemptAt: now }).onConflictDoNothing();
  }
  await emit(tx, 'order.done', { orderId: o.id, customerId: o.customerId, totalVnd: o.totalVnd });
}

export const ShipmentSchema = z.object({
  carrier: z.literal('manual'),
  trackingNo: z.string().trim().min(4, 'Cần nhập mã vận đơn.').max(40),
  feeVnd: money.default(0),
});

/** Hand the parcel to the carrier: stock out, shipment with the COD amount, Shipping. */
export async function handToCarrierTx(tx: Tx, ctx: Ctx, o: OrderRow, s: { carrier: 'ghn' | 'manual'; trackingNo: string; feeVnd: number; carrierStatus?: string | null }) {
  if (o.delivery !== 'ship') throw errors.conflict('pickup_order', `Đơn ${o.docNo} là đơn nhận tại cửa hàng, không tạo vận đơn.`);
  if (o.status === 'confirmed') await transition(tx, ctx, o, 'packing');
  if (o.status !== 'packing') throw errors.conflict('invalid_transition', `Đơn ${o.docNo} cần ở trạng thái “Đã xác nhận” hoặc “Đang đóng gói” để giao cho vận chuyển.`);
  const [dupe] = await tx.select({ id: schema.shipment.id }).from(schema.shipment).where(and(eq(schema.shipment.carrier, s.carrier), eq(schema.shipment.trackingNo, s.trackingNo)));
  if (dupe) throw errors.conflict('duplicate_tracking_no', `Mã vận đơn ${s.trackingNo} đã dùng cho đơn khác.`);
  await takeStockOut(tx, ctx, o);
  const now = ctx.clock.now();
  const [row] = await tx
    .insert(schema.shipment)
    .values({
      orderId: o.id,
      carrier: s.carrier,
      trackingNo: s.trackingNo,
      feeVnd: s.feeVnd,
      codVnd: o.paymentMethod === 'cod' ? o.totalVnd - o.depositVnd : 0,
      status: 'created',
      carrierStatus: s.carrierStatus ?? null,
      statusAt: now,
      createdBy: ctx.actor?.userId ?? null,
      createdAt: now,
    })
    .returning({ id: schema.shipment.id });
  await transition(tx, ctx, o, 'shipping', s.carrier === 'manual' ? `Vận đơn ${s.trackingNo}` : `GHN ${s.trackingNo}`, { shippedAt: now });
  return { id: row!.id, trackingNo: s.trackingNo };
}

/** Record a manual shipment by typing the tracking number (GHN unavailable, FR-ORD-10). */
export async function recordShipment(ctx: Ctx, id: string, input: z.input<typeof ShipmentSchema>) {
  requirePermission(ctx, 'online.manage');
  const data = ShipmentSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    const s = await handToCarrierTx(tx, ctx, o, data);
    return { id, status: o.status, shipment: s };
  });
}

/** Carrier delivered the parcel: COD to reconcile and the order is Done (FR-ORD-11). */
export async function deliveredTx(tx: Tx, ctx: Ctx, o: OrderRow, shipmentId: string): Promise<void> {
  const [s] = await tx.select().from(schema.shipment).where(eq(schema.shipment.id, shipmentId)).for('update');
  if (!s) throw errors.notFound('Vận đơn');
  if (s.status !== 'delivered') await tx.update(schema.shipment).set({ status: 'delivered', statusAt: ctx.clock.now() }).where(eq(schema.shipment.id, s.id));
  if (s.codVnd > 0) await tx.insert(schema.codRemittance).values({ shipmentId: s.id, expectedVnd: s.codVnd, createdAt: ctx.clock.now() }).onConflictDoNothing();
  if (o.status === 'shipping') {
    await completeTx(tx, ctx, o, 'delivered');
    // Delivered, by the carrier or marked by staff: once, not to the staff member who marked it (TDD §4.12).
    await notifications.notifyHolders(tx, 'online.manage', 'delivery.update', { id: o.id, docNo: o.docNo, event: 'delivered' }, { except: ctx.actor?.userId ?? null });
  }
}

/** Staff mark a manual shipment delivered (GHN shipments update themselves). */
export async function markDelivered(ctx: Ctx, id: string) {
  requirePermission(ctx, 'online.manage');
  return ctx.db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== 'shipping') throw errors.conflict('invalid_transition', `Đơn ${o.docNo} không ở trạng thái “Đang giao”.`);
    const [s] = await tx
      .select()
      .from(schema.shipment)
      .where(and(eq(schema.shipment.orderId, id), sql`${schema.shipment.status} not in ('cancelled', 'returned', 'returning')`))
      .orderBy(desc(schema.shipment.createdAt))
      .limit(1);
    if (!s) throw errors.notFound('Vận đơn');
    await deliveredTx(tx, ctx, o, s.id);
    return { id, status: o.status };
  });
}

// =============================================================================================
// Store pickup (FR-ORD-12)

/** Packed and ready: a 6-digit pickup code (stored hashed) for staff to give the customer when they call. */
export async function pickupReady(ctx: Ctx, id: string) {
  requirePermission(ctx, 'online.manage');
  return ctx.db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.delivery !== 'pickup') throw errors.conflict('not_pickup', `Đơn ${o.docNo} là đơn giao hàng, không nhận tại cửa hàng.`);
    if (o.status === 'confirmed') await transition(tx, ctx, o, 'packing');
    if (o.status !== 'packing') throw errors.conflict('invalid_transition', `Đơn ${o.docNo} cần được xác nhận trước khi báo sẵn sàng nhận hàng.`);
    const code = pickupCodeFromBytes(randomBytes(4));
    const now = ctx.clock.now();
    await tx.update(schema.webOrder).set({ readyAt: now, pickupCodeHash: sha256(`${o.id}:${code}`), updatedAt: now }).where(eq(schema.webOrder.id, id));
    return { id, pickupCode: code };
  });
}

export const HandoverSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Mã nhận hàng gồm 6 chữ số.') });

/** The customer collects: code checked, stock out, Done. */
export async function handover(ctx: Ctx, id: string, input: z.input<typeof HandoverSchema>) {
  requirePermission(ctx, 'online.manage');
  const { code } = HandoverSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.delivery !== 'pickup' || o.status !== 'packing' || !o.pickupCodeHash) throw errors.conflict('not_ready', `Đơn ${o.docNo} chưa sẵn sàng để khách nhận.`);
    if (o.pickupCodeHash !== sha256(`${o.id}:${code}`)) throw new AppError(422, 'pickup_code_mismatch', 'Mã nhận hàng không đúng. Hãy hỏi lại khách.');
    if (o.paymentMethod === 'transfer' && !o.paidAt) throw errors.conflict('payment_required', `Đơn ${o.docNo} chưa nhận được chuyển khoản.`);
    await takeStockOut(tx, ctx, o);
    await completeTx(tx, ctx, o, 'picked_up');
    return { id, status: o.status };
  });
}


export * from './all.js';
export * from './delivery.js';
export * from './returns.js';
export * from './preorders.js';
export * from './social.js';
