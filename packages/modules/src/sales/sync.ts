import { schema } from '@bookstore/db';
import { checkShiftClose, countDenominations, expectedCash, vnd } from '@bookstore/domain';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as customers from '../customers/index.js';
import * as identity from '../identity/index.js';
import * as notifications from '../notifications/index.js';
import * as promotions from '../promotions/index.js';
import * as settings from '../settings/index.js';
import { AppError, can, emit, errors, requirePermission, tsParam, type Ctx, type Tx } from '../platform/index.js';
import { allocateConsignment, deductStock, returnSaleTx, shiftCash } from './index.js';

/**
 * Offline POS (FR-POS-23..26, NFR-OFF-01..03, TDD §7). A completed offline sale is a fact: the
 * server never rejects it for business reasons; it records it and raises exceptions for a manager.
 */

const MAX_SKEW_MS = 5 * 60_000;

// =============================================================================================
// Devices (TDD §7.2)

export const RegisterDeviceSchema = z.object({
  registerId: z.uuid(),
  /** ECDSA P-256 public key, SPKI DER, base64. */
  publicKey: z.string().min(80).max(400),
});

/**
 * Device code from the register code (TDD §7.2): upper-case letters and digits, at most 5 characters
 * (`Q1`); when taken by another device – active or revoked, whose offline numbers must stay unique –
 * B, C, … Z is appended (`Q1B`), and `M` + a number is the last resort. Codes stay within 1–6 characters.
 */
export function deviceCodeFor(registerCode: string, taken: Set<string>): string {
  const base = registerCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (base) {
    if (!taken.has(base)) return base;
    for (let c = 66; c <= 90; c++) {
      const code = base + String.fromCharCode(c);
      if (!taken.has(code)) return code;
    }
  }
  for (let i = 1; ; i++) if (!taken.has(`M${i}`)) return `M${i}`;
}

function importKey(spkiBase64: string) {
  const key = createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new AppError(400, 'invalid_device_key', 'Khóa thiết bị phải là ECDSA P-256.');
  }
  return key;
}

export async function registerDevice(ctx: Ctx, input: z.input<typeof RegisterDeviceSchema>) {
  requirePermission(ctx, 'pos.offline.manage');
  const data = RegisterDeviceSchema.parse(input);
  importKey(data.publicKey);
  return ctx.db.transaction(async (tx) => {
    const [reg] = await tx.select({ code: schema.register.code }).from(schema.register).where(eq(schema.register.id, data.registerId));
    if (!reg) throw errors.notFound('Không tìm thấy quầy.');
    // Serialise registrations so two devices never pick the same code.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('pos_device_code'))`);
    const taken = new Set((await tx.select({ code: schema.posDevice.deviceCode }).from(schema.posDevice)).map((r) => r.code));
    const deviceCode = deviceCodeFor(reg.code, taken);
    const cfg = await settings.snapshot(ctx, tx);
    const now = ctx.clock.now();
    const [d] = await tx
      .insert(schema.posDevice)
      .values({ ...data, deviceCode, lastSeenAt: now, leaseExpiresAt: new Date(now.getTime() + cfg['pos.offline_lease_hours'] * 3600_000) })
      .returning();
    await audit.record(tx, ctx, { action: 'pos_device.register', entity: 'pos_device', entityId: d!.id, after: { deviceCode, registerId: data.registerId } });
    return { id: d!.id, deviceCode: d!.deviceCode, leaseExpiresAt: d!.leaseExpiresAt };
  });
}

export async function listDevices(ctx: Ctx) {
  requirePermission(ctx, 'pos.offline.manage');
  return ctx.db
    .select({
      id: schema.posDevice.id,
      deviceCode: schema.posDevice.deviceCode,
      registerCode: schema.register.code,
      lastSeenAt: schema.posDevice.lastSeenAt,
      leaseExpiresAt: schema.posDevice.leaseExpiresAt,
      revokedAt: schema.posDevice.revokedAt,
    })
    .from(schema.posDevice)
    .innerJoin(schema.register, eq(schema.register.id, schema.posDevice.registerId))
    .orderBy(asc(schema.posDevice.deviceCode));
}

/** A revoked device is told to wipe its local data on its next contact (NFR-OFF-02). */
export async function revokeDevice(ctx: Ctx, id: string) {
  requirePermission(ctx, 'pos.offline.manage');
  await ctx.db.transaction(async (tx) => {
    const [d] = await tx.update(schema.posDevice).set({ revokedAt: ctx.clock.now() }).where(and(eq(schema.posDevice.id, id), isNull(schema.posDevice.revokedAt))).returning();
    if (!d) throw errors.conflict('device_not_active', 'Thiết bị không tồn tại hoặc đã bị thu hồi.');
    await audit.record(tx, ctx, { action: 'pos_device.revoke', entity: 'pos_device', entityId: id });
  });
}

export interface DeviceRequest {
  code: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  method: string;
  path: string;
  body: Uint8Array;
}

export interface Device {
  id: string;
  deviceCode: string;
  registerId: string;
  leaseExpiresAt: Date;
  /** Device clock minus server clock at this request (TDD §7.6 `clock_skew`). */
  skewMs: number;
}

/**
 * Verify the device signature over `METHOD\nPATH\nTIMESTAMP\nSHA-256(body)` (TDD §7.2), refuse
 * revoked devices, and extend the offline lease (`pos.offline_lease_hours`).
 */
export async function authenticateDevice(ctx: Ctx, req: DeviceRequest): Promise<Device> {
  if (!req.code || !req.timestamp || !req.signature) throw new AppError(401, 'device_auth_required', 'Thiết bị chưa được đăng ký. Hãy nhờ quản lý đăng ký thiết bị này.');
  const [d] = await ctx.db.select().from(schema.posDevice).where(eq(schema.posDevice.deviceCode, req.code));
  if (!d) throw new AppError(401, 'device_unknown', 'Thiết bị chưa được đăng ký. Hãy nhờ quản lý đăng ký thiết bị này.');
  if (d.revokedAt) throw new AppError(401, 'device_revoked', 'Thiết bị đã bị thu hồi. Dữ liệu trên máy sẽ được xóa.', { wipe: true });
  const bodyHash = createHash('sha256').update(req.body).digest('hex');
  const message = `${req.method.toUpperCase()}\n${req.path}\n${req.timestamp}\n${bodyHash}`;
  let ok: boolean;
  try {
    ok = verifySignature('sha256', Buffer.from(message), { key: importKey(d.publicKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(req.signature, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) throw new AppError(401, 'device_signature_invalid', 'Chữ ký thiết bị không hợp lệ.');
  const now = ctx.clock.now();
  const cfg = await settings.snapshot(ctx);
  const leaseExpiresAt = new Date(now.getTime() + cfg['pos.offline_lease_hours'] * 3600_000);
  await ctx.db.update(schema.posDevice).set({ lastSeenAt: now, leaseExpiresAt }).where(eq(schema.posDevice.id, d.id));
  const ts = Date.parse(req.timestamp);
  return { id: d.id, deviceCode: d.deviceCode, registerId: d.registerId, leaseExpiresAt, skewMs: Number.isFinite(ts) ? ts - now.getTime() : 0 };
}

// =============================================================================================
// Bootstrap and catalogue delta (TDD §7.3)

interface CachedVariant {
  variantId: string;
  itemId: string;
  sku: string;
  title: string;
  /** Vietnamese title, null when the item has none (TDD §7.3). */
  titleVi: string | null;
  authors: string[];
  priceVnd: number;
  vatBp: number;
  barcodes: string[];
  categoryIds: string[];
  publisherId: string | null;
  brandId: string | null;
  isBundle: boolean;
  /** Item kind, and its first photo (null when none), for the POS search results (TDD §7.3). */
  kind: string;
  imageFileId: string | null;
  /** The shelf's name, so staff know where to fetch it (FR-CAT-01); null when none. */
  shelfName: string | null;
}

async function sellableVariants(tx: Tx, itemIds?: string[]): Promise<CachedVariant[]> {
  const rows = await tx.execute<{
    id: string;
    item_id: string;
    sku: string;
    title: string;
    title_vi: string | null;
    authors: string[];
    price_vnd: string;
    vat_bp: number;
    barcodes: string[] | null;
    category_ids: string[] | null;
    publisher_id: string | null;
    brand_id: string | null;
    kind: string;
    image_file_id: string | null;
    shelf_name: string | null;
  }>(sql`
    select v.id, v.item_id, v.sku, i.i18n -> 'en' ->> 'title' as title, nullif(i.i18n -> 'vi' ->> 'title', '') as title_vi, i.authors, v.price_vnd, v.vat_bp, i.publisher_id, i.brand_id, i.kind,
           (select array_agg(b.code) from catalog.barcode b where b.variant_id = v.id) as barcodes,
           (select array_agg(ic.category_id) from catalog.item_category ic where ic.item_id = i.id) as category_ids,
           (select im.file_id from catalog.item_image im where im.item_id = i.id order by im.sort limit 1) as image_file_id,
           (select md.i18n -> 'vi' ->> 'name' from platform.master_data md where md.kind = 'shelf' and md.code = v.shelf_code) as shelf_name
    from catalog.item_variant v join catalog.item i on i.id = v.item_id
    where v.status = 'active' and i.status = 'active' and v.published_pos
      ${itemIds ? sql`and i.id in (${sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
    order by v.sku`);
  return rows.map((r) => ({
    variantId: r.id,
    itemId: r.item_id,
    sku: r.sku,
    title: r.title,
    titleVi: r.title_vi,
    authors: r.authors,
    priceVnd: Number(r.price_vnd),
    vatBp: r.vat_bp,
    barcodes: r.barcodes ?? [],
    categoryIds: r.category_ids ?? [],
    publisherId: r.publisher_id,
    brandId: r.brand_id,
    isBundle: r.kind === 'bundle',
    kind: r.kind,
    imageFileId: r.image_file_id,
    shelfName: r.shelf_name,
  }));
}

async function currentCursor(tx: Tx): Promise<number> {
  const [r] = await tx.execute<{ seq: string | null }>(sql`select max(seq) as seq from catalog.catalog_change`);
  return Number(r?.seq ?? 0);
}

/**
 * Full snapshot for a new or reset device: sellable variants, promotions, tiers, a minimal
 * customer list, the settings the pricing engine needs, and the PIN verifiers of users who can
 * approve at the counter. No payroll or cost data is sent to devices (TDD §7.7).
 */
export async function bootstrap(ctx: Ctx, device: Device) {
  requirePermission(ctx, 'sale.create');
  const now = ctx.clock.now();
  const cfg = await settings.snapshot(ctx);
  const cursor = await currentCursor(ctx.db);
  const items = await sellableVariants(ctx.db);
  const promos = await promotions.activeSnapshot(ctx.db, now, 'counter', null);
  const tiers = await ctx.db.select({ code: schema.tier.code, name: schema.tier.name, benefits: schema.tier.benefits }).from(schema.tier);
  const customerRows = await ctx.db
    .select({ id: schema.customer.id, name: schema.customer.name, phoneE164: schema.customer.phoneE164, tierCode: schema.tier.code, pointsBalance: schema.customer.pointsBalance })
    .from(schema.customer)
    .leftJoin(schema.tier, eq(schema.tier.id, schema.customer.tierId))
    .where(isNull(schema.customer.anonymisedAt));
  // Offline approvals are verified against these salted, slow verifiers on the device (TDD §7.7).
  const approverRows = await ctx.db.execute<{ id: string; username: string; display_name: string; pin_hash: string; permissions: string[] | null; is_owner: boolean }>(sql`
    select u.id, u.username, u.display_name, u.pin_hash, r.is_owner,
           (select array_agg(rp.permission) from platform.role_permission rp where rp.role_id = r.id) as permissions
    from platform.app_user u join platform.role r on r.id = u.role_id
    where u.status = 'active' and u.pin_hash is not null`);
  const approvalPerms = Object.values(identity.APPROVAL_ACTIONS) as string[];
  const approvers = approverRows
    .filter((a) => a.is_owner || (a.permissions ?? []).some((p) => approvalPerms.includes(p)))
    .map((a) => ({
      userId: a.id,
      username: a.username,
      displayName: a.display_name,
      pinVerifier: a.pin_hash,
      actions: Object.entries(identity.APPROVAL_ACTIONS)
        .filter(([, perm]) => a.is_owner || (a.permissions ?? []).includes(perm))
        .map(([action]) => action),
    }));
  return {
    device: { id: device.id, deviceCode: device.deviceCode, registerId: device.registerId, leaseExpiresAt: device.leaseExpiresAt },
    cursor,
    items,
    promotions: promos,
    tiers,
    customers: customerRows,
    approvers,
    settings: {
      cashierDiscountMaxBp: cfg['sale.cashier_discount_max_bp'],
      earnVndPerPoint: cfg['loyalty.earn_vnd_per_point'],
      pointValueVnd: cfg['loyalty.point_value_vnd'],
      minRedeemPoints: cfg['loyalty.min_redeem_points'],
      allowNegativePos: cfg['inventory.allow_negative_pos'],
      printSalesSlip: cfg['pos.print_sales_slip'],
      lockMinutes: cfg['pos.lock_minutes'],
      offlineLeaseHours: cfg['pos.offline_lease_hours'],
      storeName: cfg['store.name'],
    },
  };
}

/** Changes after `cursor`: upserts of sellable variants and deletes of the rest (tombstones). */
export async function delta(ctx: Ctx, cursor: number) {
  const changed = await ctx.db.execute<{ entity_id: string }>(sql`select distinct entity_id from catalog.catalog_change where seq > ${cursor} and entity = 'item'`);
  const next = await currentCursor(ctx.db);
  if (!changed.length) return { cursor: next, upserts: [] as CachedVariant[], deletes: [] as string[] };
  const itemIds = changed.map((c) => c.entity_id);
  const upserts = await sellableVariants(ctx.db, itemIds);
  const all = await ctx.db.select({ id: schema.itemVariant.id }).from(schema.itemVariant).where(inArray(schema.itemVariant.itemId, itemIds));
  const live = new Set(upserts.map((u) => u.variantId));
  return { cursor: next, upserts, deletes: all.map((v) => v.id).filter((id) => !live.has(id)) };
}

// =============================================================================================
// Sync (TDD §7.5, §7.6)

const money = z.number().int().min(0);

const ShiftOpened = z.object({ type: z.literal('shift.opened'), payload: z.object({ clientShiftId: z.uuid(), floatVnd: money, openedBy: z.uuid(), openedAt: z.iso.datetime() }) });
const ShiftClosed = z.object({
  type: z.literal('shift.closed'),
  payload: z.object({
    clientShiftId: z.uuid(),
    countedVnd: money.optional(),
    denominations: z.record(z.string(), z.number().int().min(0)).optional(),
    varianceReason: z.string().max(500).optional(),
    closedBy: z.uuid(),
    closedAt: z.iso.datetime(),
  }),
});
const CashMoved = z.object({
  type: z.literal('cash.movement'),
  payload: z.object({ clientShiftId: z.uuid(), direction: z.enum(['in', 'out']), amountVnd: z.number().int().positive(), reason: z.string().min(1).max(300), by: z.uuid(), at: z.iso.datetime() }),
});
const SaleCompleted = z.object({
  type: z.literal('sale.completed'),
  payload: z.object({
    docNo: z.string().min(3).max(30),
    /** Either a shift opened offline on this device or a server shift cached before going offline. */
    clientShiftId: z.uuid().optional(),
    shiftId: z.uuid().optional(),
    cashierId: z.uuid(),
    customerId: z.uuid().nullable().optional(),
    soldAt: z.iso.datetime(),
    lines: z
      .array(
        z.object({
          variantId: z.uuid(),
          description: z.string().max(300),
          qty: z.number().int().positive(),
          unitPriceVnd: money,
          discountVnd: money,
          totalVnd: money,
          vatBp: z.number().int().min(0).max(10000),
          vatVnd: money,
          promotionVersionIds: z.array(z.uuid()).default([]),
          note: z.string().max(200).optional(),
        }),
      )
      .min(1),
    payments: z.array(
      z.object({ method: z.enum(['cash', 'transfer', 'card']), amountVnd: z.number().int().positive(), tenderedVnd: money.optional(), ref: z.string().max(40).optional() }),
    ),
    subtotalVnd: money,
    discountVnd: money,
    totalVnd: money,
    vatVnd: money,
    redeemPoints: z.number().int().min(0).default(0),
    pointsDiscountVnd: money.default(0),
    isDeposit: z.boolean().default(false),
    /** Offline supervisor approvals checked on the device against cached verifiers (TDD §7.6). */
    approvals: z.array(z.object({ approverId: z.uuid(), action: z.enum(Object.keys(identity.APPROVAL_ACTIONS) as [identity.ApprovalAction, ...identity.ApprovalAction[]]) })).default([]),
    einvoiceRequest: z.object({ name: z.string(), taxCode: z.string().optional(), address: z.string().optional(), email: z.email().optional() }).optional(),
    note: z.string().max(500).optional(),
  }),
});

const SaleReturned = z.object({
  type: z.literal('sale.returned'),
  payload: z.object({
    /** A sale made on this device (TDD §7.1); returns of other sales need the server. */
    saleDocNo: z.string().min(3).max(30),
    clientShiftId: z.uuid().optional(),
    shiftId: z.uuid().optional(),
    lines: z.array(z.object({ lineNo: z.number().int().positive(), qty: z.number().int().positive(), restock: z.boolean() })).min(1),
    refundMethod: z.enum(['cash', 'transfer', 'card']),
    reason: z.string().max(500).optional(),
    by: z.uuid(),
    at: z.iso.datetime(),
    approvals: z.array(z.object({ approverId: z.uuid(), action: z.enum(['return_exception', 'refund']) })).default([]),
  }),
});

export const SyncEvent = z.intersection(
  z.object({ clientEventId: z.uuid(), seq: z.number().int().min(0), createdAt: z.iso.datetime() }),
  z.discriminatedUnion('type', [ShiftOpened, ShiftClosed, CashMoved, SaleCompleted, SaleReturned]),
);
export type SyncEvent = z.infer<typeof SyncEvent>;

export const SyncSchema = z.object({ cursor: z.number().int().min(0).default(0), events: z.array(z.unknown()).max(50) });

export type SyncException =
  | 'price_drift'
  | 'negative_stock'
  | 'points_overdrawn'
  | 'unverified_transfer'
  | 'offline_approval'
  | 'approval_revoked'
  | 'clock_skew'
  | 'shift_conflict';

export type EventResult =
  | { clientEventId: string; status: 'accepted'; exceptions: SyncException[]; ref?: string }
  | { clientEventId: string; status: 'duplicate'; result: unknown }
  | { clientEventId: string; status: 'rejected'; code: string; message: string };

class Rejected extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

async function resolveShift(tx: Tx, device: Device, p: { clientShiftId?: string | undefined; shiftId?: string | undefined }) {
  if (p.clientShiftId) {
    const [s] = await tx.select().from(schema.shift).where(and(eq(schema.shift.deviceId, device.id), eq(schema.shift.clientId, p.clientShiftId)));
    if (s) return s;
  }
  if (p.shiftId) {
    const [s] = await tx.select().from(schema.shift).where(eq(schema.shift.id, p.shiftId));
    if (s) return s;
  }
  throw new Rejected('unknown_shift', 'Ca làm của sự kiện chưa được đồng bộ.');
}

async function activeUser(tx: Tx, userId: string) {
  const [u] = await tx.select({ id: schema.appUser.id, status: schema.appUser.status, name: schema.appUser.displayName }).from(schema.appUser).where(eq(schema.appUser.id, userId));
  if (!u) throw new Rejected('unknown_user', 'Nhân viên trong sự kiện không tồn tại.');
  return u;
}

async function processEvent(tx: Tx, ctx: Ctx, device: Device, e: SyncEvent): Promise<{ exceptions: SyncException[]; ref?: string }> {
  const exceptions: SyncException[] = [];
  if (Math.abs(device.skewMs) > MAX_SKEW_MS) exceptions.push('clock_skew');

  if (e.type === 'shift.opened') {
    await activeUser(tx, e.payload.openedBy);
    const [open] = await tx.select({ id: schema.shift.id }).from(schema.shift).where(and(eq(schema.shift.registerId, device.registerId), isNull(schema.shift.closedAt)));
    if (open) {
      // The register still has a shift open on the server: keep the drawer facts on that shift.
      await tx.update(schema.shift).set({ deviceId: device.id, clientId: e.payload.clientShiftId }).where(eq(schema.shift.id, open.id));
      exceptions.push('shift_conflict');
      return { exceptions, ref: open.id };
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bms.shift_no'))`);
    const [{ next } = { next: 1 }] = await tx.execute<{ next: number }>(sql`select coalesce(max(shift_no), 0)::int + 1 as next from sales.shift`);
    const [s] = await tx
      .insert(schema.shift)
      .values({ shiftNo: next, registerId: device.registerId, openedBy: e.payload.openedBy, openedAt: new Date(e.payload.openedAt), floatVnd: e.payload.floatVnd, deviceId: device.id, clientId: e.payload.clientShiftId })
      .returning({ id: schema.shift.id });
    return { exceptions, ref: s!.id };
  }

  if (e.type === 'cash.movement') {
    const s = await resolveShift(tx, device, e.payload);
    await tx.insert(schema.cashMovement).values({ shiftId: s.id, direction: e.payload.direction, amountVnd: e.payload.amountVnd, reason: e.payload.reason, createdBy: e.payload.by, at: new Date(e.payload.at) });
    return { exceptions };
  }

  if (e.type === 'shift.closed') {
    const s = await resolveShift(tx, device, e.payload);
    if (s.closedAt) return { exceptions, ref: s.id };
    const cfg = await settings.snapshot(ctx, tx);
    const expected = expectedCash({ floatVnd: vnd(s.floatVnd), ...(await shiftCash(tx, s.id)) });
    const counted = e.payload.denominations
      ? countDenominations(Object.fromEntries(Object.entries(e.payload.denominations).map(([k, v]) => [Number(k), v])))
      : vnd(e.payload.countedVnd ?? 0);
    // The device already enforced the reason; a missing one is recorded rather than refused (a fact).
    const check = checkShiftClose(expected, counted, e.payload.varianceReason || '(không ghi lý do khi ngoại tuyến)', cfg['shift.variance_alert_vnd']);
    const variance = check.varianceVnd;
    await tx
      .update(schema.shift)
      .set({
        closedAt: new Date(e.payload.closedAt),
        closedBy: e.payload.closedBy,
        countedVnd: counted,
        denominations: e.payload.denominations ?? null,
        expectedVnd: expected,
        varianceVnd: variance,
        varianceReason: variance === 0 ? null : e.payload.varianceReason || '(không ghi lý do khi ngoại tuyến)',
      })
      .where(eq(schema.shift.id, s.id));
    if (check.ok && check.alert) {
      await notifications.notifyHolders(tx, 'shift.view_all', 'shift.variance_exceeded', { shiftId: s.id, shiftNo: s.shiftNo, varianceVnd: variance, reason: e.payload.varianceReason, offline: true });
    }
    await emit(tx, 'shift.closed', { shiftId: s.id, varianceVnd: variance });
    return { exceptions, ref: s.id };
  }

  if (e.type === 'sale.returned') {
    const r = e.payload;
    const [orig] = await tx.select().from(schema.sale).where(and(eq(schema.sale.docNo, r.saleDocNo), eq(schema.sale.deviceId, device.id)));
    if (!orig) throw new Rejected('sale_not_on_device', 'Chỉ trả hàng ngoại tuyến cho đơn bán trên chính thiết bị này.');
    const shift = await resolveShift(tx, device, r);
    await activeUser(tx, r.by);
    const saleLines = await tx.select({ id: schema.saleLine.id, lineNo: schema.saleLine.lineNo }).from(schema.saleLine).where(eq(schema.saleLine.saleId, orig.id));
    const lines = r.lines.map((l) => {
      const sl = saleLines.find((x) => x.lineNo === l.lineNo);
      if (!sl) throw new Rejected('line_not_in_sale', 'Dòng hàng không thuộc đơn này.');
      return { saleLineId: sl.id, qty: l.qty, restock: l.restock };
    });
    for (const a of r.approvals) {
      const u = await activeUser(tx, a.approverId);
      const ok = await tx.execute<{ ok: boolean }>(sql`
        select (ro.is_owner or exists (select 1 from platform.role_permission rp where rp.role_id = ro.id and rp.permission = 'return.approve')) as ok
        from platform.app_user u join platform.role ro on ro.id = u.role_id where u.id = ${a.approverId}::uuid`);
      const code: SyncException = u.status === 'active' && ok[0]?.ok ? 'offline_approval' : 'approval_revoked';
      if (!exceptions.includes(code)) exceptions.push(code);
    }
    try {
      const done = await returnSaleTx(
        tx,
        ctx,
        orig.id,
        { shiftId: shift.id, lines, refundMethod: r.refundMethod, ...(r.reason && { reason: r.reason }) },
        { offline: { at: new Date(r.at), approverId: r.approvals[0]?.approverId ?? null } },
      );
      return { exceptions, ref: done.id };
    } catch (err) {
      if (err instanceof AppError) throw new Rejected(err.code, err.message);
      throw err;
    }
  }

  // ---- sale.completed --------------------------------------------------------------------------
  const p = e.payload;
  if (!p.docNo.startsWith(`${device.deviceCode}-`)) throw new Rejected('invalid_doc_no', `Số đơn ngoại tuyến phải bắt đầu bằng ${device.deviceCode}-.`);
  const linesTotal = p.lines.reduce((a, l) => a + l.totalVnd, 0);
  if (linesTotal !== p.totalVnd) throw new Rejected('totals_mismatch', 'Tổng các dòng không khớp tổng đơn.');
  const paid = p.payments.reduce((a, x) => a + x.amountVnd, 0);
  if (p.isDeposit ? paid > p.totalVnd : paid !== p.totalVnd) throw new Rejected('payment_mismatch', 'Tổng thanh toán không khớp tổng đơn.');
  const [dupeDoc] = await tx.select({ id: schema.sale.id }).from(schema.sale).where(eq(schema.sale.docNo, p.docNo));
  if (dupeDoc) throw new Rejected('duplicate_doc_no', `Số đơn ${p.docNo} đã tồn tại.`);
  const shift = await resolveShift(tx, device, p);
  await activeUser(tx, p.cashierId);
  const soldAt = new Date(p.soldAt);
  const variantIds = [...new Set(p.lines.map((l) => l.variantId))];
  const known = await tx.select({ id: schema.itemVariant.id }).from(schema.itemVariant).where(inArray(schema.itemVariant.id, variantIds));
  if (known.length !== variantIds.length) throw new Rejected('rejected_unknown_variant', 'Sản phẩm trong đơn không có trên máy chủ.');

  // Price drift: the customer was charged the device price; flag lines that differ from the price in force (TDD §7.6).
  for (const l of p.lines) {
    const [ph] = await tx
      .select({ price: schema.priceHistory.priceVnd })
      .from(schema.priceHistory)
      .where(and(eq(schema.priceHistory.variantId, l.variantId), sql`${schema.priceHistory.effectiveFrom} <= ${tsParam(soldAt)}`, sql`(${schema.priceHistory.effectiveTo} is null or ${schema.priceHistory.effectiveTo} > ${tsParam(soldAt)})`))
      .orderBy(desc(schema.priceHistory.effectiveFrom))
      .limit(1);
    if (ph && ph.price !== l.unitPriceVnd && !exceptions.includes('price_drift')) exceptions.push('price_drift');
  }

  // Offline approvals are accepted, re-checked now that the approver's status is known.
  for (const a of p.approvals) {
    const u = await activeUser(tx, a.approverId);
    const actor = await tx.execute<{ ok: boolean }>(sql`
      select (r.is_owner or exists (select 1 from platform.role_permission rp where rp.role_id = r.id and rp.permission = ${identity.APPROVAL_ACTIONS[a.action]})) as ok
      from platform.app_user u join platform.role r on r.id = u.role_id where u.id = ${a.approverId}::uuid`);
    const code: SyncException = u.status === 'active' && actor[0]?.ok ? 'offline_approval' : 'approval_revoked';
    if (!exceptions.includes(code)) exceptions.push(code);
  }

  const cfg = await settings.snapshot(ctx, tx);
  const approvedBy = p.approvals[0]?.approverId ?? null;
  const [sale] = await tx
    .insert(schema.sale)
    .values({
      docNo: p.docNo,
      clientEventId: e.clientEventId,
      deviceId: device.id,
      shiftId: shift.id,
      cashierId: p.cashierId,
      customerId: p.customerId ?? null,
      subtotalVnd: p.subtotalVnd,
      discountVnd: p.discountVnd,
      pointsRedeemed: p.redeemPoints,
      pointsDiscountVnd: p.pointsDiscountVnd,
      totalVnd: p.totalVnd,
      vatVnd: p.vatVnd,
      isDeposit: p.isDeposit,
      offline: true,
      soldAt,
      note: p.note ?? null,
      approvedBy,
    })
    .returning({ id: schema.sale.id });
  const saleId = sale!.id;

  // Stock: applied with force; a negative result is a manager exception (TDD §7.6).
  for (const [i, l] of p.lines.entries()) {
    const cost = await deductStock(tx, ctx, saleId, l.variantId, l.qty, true);
    const [row] = await tx
      .insert(schema.saleLine)
      .values({
        saleId,
        lineNo: i + 1,
        variantId: l.variantId,
        itemClass: 'goods',
        description: l.description,
        qty: l.qty,
        unitPriceVnd: l.unitPriceVnd,
        discountVnd: l.discountVnd,
        totalVnd: l.totalVnd,
        vatBp: l.vatBp,
        vatVnd: l.vatVnd,
        costVnd: cost * l.qty,
        promotionVersionIds: l.promotionVersionIds,
        note: l.note ?? null,
      })
      .returning({ id: schema.saleLine.id });
    await allocateConsignment(tx, row!.id, l.variantId, l.qty, l.unitPriceVnd, soldAt);
  }
  const negative = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from inventory.stock_level s
    where s.on_hand < 0 and s.variant_id in (
      select l.variant_id from sales.sale_line l where l.sale_id = ${saleId}::uuid
      union select bc.component_variant_id from catalog.bundle_component bc join sales.sale_line l on l.variant_id = bc.bundle_variant_id where l.sale_id = ${saleId}::uuid)`);
  if (negative[0]!.n > 0) exceptions.push('negative_stock');

  for (const x of p.payments) {
    await tx.insert(schema.salePayment).values({
      saleId,
      method: x.method,
      amountVnd: x.amountVnd,
      tenderedVnd: x.method === 'cash' ? (x.tenderedVnd ?? x.amountVnd) : null,
      ref: x.method === 'cash' ? null : (x.ref ?? null),
      // A transfer taken offline stays unverified until a manager confirms it (TDD §7.6).
      verified: x.method !== 'transfer',
    });
  }
  if (p.payments.some((x) => x.method === 'transfer')) exceptions.push('unverified_transfer');

  // Loyalty: earned points are recomputed on the server; redemption above the real balance floors at zero.
  let pointsEarned = 0;
  if (p.customerId) {
    const [c] = await tx.select({ id: schema.customer.id }).from(schema.customer).where(eq(schema.customer.id, p.customerId));
    if (!c) throw new Rejected('unknown_customer', 'Khách hàng trong đơn không có trên máy chủ.');
    if (p.redeemPoints > 0) {
      const delta = await customers.post(tx, ctx, { customerId: p.customerId, delta: -p.redeemPoints, reason: 'redeem', refType: 'sale', refId: saleId }, { floorAtZero: true });
      if (-delta < p.redeemPoints) exceptions.push('points_overdrawn');
    }
    if (!p.isDeposit) {
      const profile = await customers.pricingProfile(tx, p.customerId);
      pointsEarned = Math.floor((linesTotal * profile.pointsMultiplierBp) / (10000 * cfg['loyalty.earn_vnd_per_point']));
      if (pointsEarned > 0) await customers.post(tx, ctx, { customerId: p.customerId, delta: pointsEarned, reason: 'earn', refType: 'sale', refId: saleId });
    }
    await tx.update(schema.sale).set({ pointsEarned }).where(eq(schema.sale.id, saleId));
  }

  // Promotion usage: attribute each line's discount to the promotions it applied (FR-PRM-06).
  const versionIds = [...new Set(p.lines.flatMap((l) => l.promotionVersionIds))];
  if (versionIds.length) {
    const versions = await tx.select({ id: schema.promotionVersion.id, promotionId: schema.promotionVersion.promotionId }).from(schema.promotionVersion).where(inArray(schema.promotionVersion.id, versionIds));
    const uses = new Map<string, { discountVnd: number; revenueVnd: number }>();
    for (const l of p.lines) {
      for (const v of l.promotionVersionIds) {
        const pid = versions.find((x) => x.id === v)?.promotionId;
        if (!pid) continue;
        const u = uses.get(pid) ?? { discountVnd: 0, revenueVnd: 0 };
        u.discountVnd += Math.floor(l.discountVnd / l.promotionVersionIds.length);
        u.revenueVnd += l.totalVnd;
        uses.set(pid, u);
      }
    }
    await promotions.recordUsage(tx, [...uses].map(([promotionId, u]) => ({ promotionId, ...u })), { refType: 'sale', refId: saleId, customerId: p.customerId ?? null });
  }

  // E-invoices for offline sales are issued after reconnection (FR-POS-24, BR-24).
  if (cfg['pos.einvoice_mode'] === 'every_sale' || p.einvoiceRequest) {
    await tx.insert(schema.einvoiceJob).values({ saleId, status: 'pending', nextAttemptAt: ctx.clock.now(), buyer: p.einvoiceRequest ?? null, emailRequested: !!p.einvoiceRequest?.email });
  }
  await emit(tx, 'sale.completed', { saleId, customerId: p.customerId ?? null, totalVnd: p.totalVnd, offline: true });
  return { exceptions, ref: saleId };
}

/**
 * Process a batch in `seq` order, one transaction per event. `pos_inbox` makes replays harmless:
 * a known event returns its stored result. A malformed or impossible event is rejected with its
 * payload kept for the manager, and later events still run (TDD §7.5).
 */
export async function sync(ctx: Ctx, device: Device, input: z.input<typeof SyncSchema>) {
  requirePermission(ctx, 'sale.create');
  const data = SyncSchema.parse(input);
  const raw = data.events as { clientEventId?: string; seq?: number }[];
  const ordered = [...raw].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const results: EventResult[] = [];
  for (const rawEvent of ordered) {
    const clientEventId = String(rawEvent.clientEventId ?? '');
    const parsed = SyncEvent.safeParse(rawEvent);
    const [seen] = z.uuid().safeParse(clientEventId).success
      ? await ctx.db.select().from(schema.posInbox).where(and(eq(schema.posInbox.deviceId, device.id), eq(schema.posInbox.clientEventId, clientEventId)))
      : [];
    if (seen) {
      results.push({ clientEventId, status: 'duplicate', result: seen.result });
      continue;
    }
    if (!parsed.success) {
      results.push({ clientEventId, status: 'rejected', code: 'invalid_event', message: parsed.error.issues[0]?.message ?? 'Sự kiện không hợp lệ.' });
      if (z.uuid().safeParse(clientEventId).success) await storeInbox(ctx, device, clientEventId, rawEvent, results.at(-1)!, ['rejected_invalid_event']);
      continue;
    }
    const event = parsed.data;
    try {
      const out = await ctx.db.transaction(async (tx) => {
        const r = await processEvent(tx, ctx, device, event);
        const result: EventResult = { clientEventId, status: 'accepted', exceptions: r.exceptions, ...(r.ref && { ref: r.ref }) };
        await tx.insert(schema.posInbox).values({
          deviceId: device.id,
          clientEventId,
          seq: event.seq,
          type: event.type,
          result,
          exceptionCode: r.exceptions[0] ?? null,
          exceptions: r.exceptions,
          payload: event,
          receivedAt: ctx.clock.now(),
        });
        return result;
      });
      results.push(out);
    } catch (err) {
      if (!(err instanceof Rejected) && !(err instanceof AppError && err.status < 500)) throw err;
      const code = err instanceof Rejected ? err.code : (err as AppError).code;
      const result: EventResult = { clientEventId, status: 'rejected', code, message: err.message };
      await storeInbox(ctx, device, clientEventId, event, result, [code.startsWith('rejected_') ? code : `rejected_${code}`]);
      results.push(result);
    }
  }
  return { results, delta: await delta(ctx, data.cursor), leaseExpiresAt: device.leaseExpiresAt };
}

async function storeInbox(ctx: Ctx, device: Device, clientEventId: string, payload: unknown, result: EventResult, exceptions: string[]) {
  await ctx.db
    .insert(schema.posInbox)
    .values({
      deviceId: device.id,
      clientEventId,
      seq: Number((payload as { seq?: number }).seq ?? 0),
      type: String((payload as { type?: string }).type ?? 'unknown'),
      result,
      exceptionCode: exceptions[0] ?? null,
      exceptions,
      payload: payload as never,
      receivedAt: ctx.clock.now(),
    })
    .onConflictDoNothing();
}

// =============================================================================================
// Manager review of exceptions (FR-POS-26)

export async function listExceptions(ctx: Ctx, includeResolved = false) {
  requirePermission(ctx, 'pos.offline.manage');
  const i = schema.posInbox;
  return ctx.db
    .select({
      id: i.id,
      deviceCode: schema.posDevice.deviceCode,
      type: i.type,
      exceptions: i.exceptions,
      result: i.result,
      payload: i.payload,
      receivedAt: i.receivedAt,
      resolvedAt: i.resolvedAt,
      resolutionNote: i.resolutionNote,
    })
    .from(i)
    .innerJoin(schema.posDevice, eq(schema.posDevice.id, i.deviceId))
    .where(and(sql`jsonb_array_length(${i.exceptions}) > 0`, includeResolved ? undefined : isNull(i.resolvedAt)))
    .orderBy(asc(i.receivedAt), asc(i.seq));
}

export const ResolveSchema = z.object({ note: z.string().trim().min(1, 'Cần ghi chú cách xử lý.').max(500) });

/** Resolve an exception; for an unverified offline transfer this confirms the payment (TDD §7.6). */
export async function resolveException(ctx: Ctx, id: string, input: z.input<typeof ResolveSchema>) {
  const actor = requirePermission(ctx, 'pos.offline.manage');
  const data = ResolveSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.posInbox).where(and(eq(schema.posInbox.id, id), isNull(schema.posInbox.resolvedAt))).for('update');
    if (!row) throw errors.conflict('already_resolved', 'Ngoại lệ không tồn tại hoặc đã được xử lý.');
    const now = ctx.clock.now();
    const exceptions = row.exceptions as string[];
    const saleId = (row.result as { ref?: string }).ref;
    if (exceptions.includes('unverified_transfer') && saleId && can(actor, 'pos.offline.manage')) {
      await tx
        .update(schema.salePayment)
        .set({ verified: true, confirmedBy: actor.userId, confirmedAt: now })
        .where(and(eq(schema.salePayment.saleId, saleId), eq(schema.salePayment.method, 'transfer'), eq(schema.salePayment.verified, false)));
    }
    await tx.update(schema.posInbox).set({ resolvedAt: now, resolvedBy: actor.userId, resolutionNote: data.note }).where(eq(schema.posInbox.id, id));
    await audit.record(tx, ctx, { action: 'pos_sync.resolve', entity: 'pos_inbox', entityId: id, after: { exceptions, note: data.note } });
    return { id, resolvedAt: now };
  });
}

