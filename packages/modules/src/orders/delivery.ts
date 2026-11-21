import { schema } from '@bookstore/db';
import { foldText } from '@bookstore/domain';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CarrierAdapter, ShipmentStatusResult } from '../integrations/ghn.js';
import { CarrierError } from '../integrations/ghn.js';
import * as notifications from '../notifications/index.js';
import { AppError, errors, requirePermission, type Ctx, type Tx } from '../platform/index.js';
import { deliveredTx, handToCarrierTx } from './index.js';
import { carrierReturnTx } from './returns.js';

/**
 * GHN: address data, fee quote, shipment creation and status (FR-ORD-06, FR-ORD-10, TDD §8.2).
 * Carrier calls happen outside database transactions; the result is recorded afterwards.
 */

// =============================================================================================
// geo.refresh (TDD §9.1): provinces → districts → wards, district kept hidden on the ward

export async function refreshGeo(ctx: Ctx, carrier: CarrierAdapter, opts: { concurrency?: number } = {}) {
  const now = ctx.clock.now();
  const provinces = await carrier.provinces();
  let wards = 0;
  for (const p of provinces) {
    await ctx.db
      .insert(schema.geoProvince)
      .values({ id: p.id, name: p.name, searchText: foldText(p.name), refreshedAt: now })
      .onConflictDoUpdate({ target: schema.geoProvince.id, set: { name: p.name, searchText: foldText(p.name), refreshedAt: now } });
  }
  const queue = [...provinces];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      for (const d of await carrier.districts(p.id)) {
        const rows = (await carrier.wards(d.id)).map((w) => ({ code: w.code, name: w.name, provinceId: p.id, districtId: d.id, districtName: d.name, searchText: foldText(w.name), refreshedAt: now }));
        if (!rows.length) continue;
        await ctx.db
          .insert(schema.geoWard)
          .values(rows)
          .onConflictDoUpdate({
            target: schema.geoWard.code,
            set: { name: sql`excluded.name`, provinceId: sql`excluded.province_id`, districtId: sql`excluded.district_id`, districtName: sql`excluded.district_name`, searchText: sql`excluded.search_text`, refreshedAt: now },
          });
        wards += rows.length;
      }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));
  return { provinces: provinces.length, wards };
}

// =============================================================================================
// Fee quote (FR-ORD-10) for the order form

export const ShippingQuoteSchema = z.object({
  wardCode: z.string().trim().min(1),
  lines: z.array(z.object({ variantId: z.uuid(), qty: z.number().int().positive() })).min(1),
  codVnd: z.number().int().min(0).default(0),
});

async function wardDistrict(tx: Tx, wardCode: string) {
  const [w] = await tx.select({ districtId: schema.geoWard.districtId }).from(schema.geoWard).where(eq(schema.geoWard.code, wardCode));
  if (!w) throw new AppError(422, 'unknown_ward', 'Phường/xã không có trong dữ liệu địa chỉ GHN. Hãy chọn lại.');
  return w.districtId;
}

async function weightOf(tx: Tx, lines: { variantId: string; qty: number }[]): Promise<number> {
  if (!lines.length) return 0;
  const rows = await tx.select({ id: schema.itemVariant.id, weightG: schema.itemVariant.weightG }).from(schema.itemVariant).where(inArray(schema.itemVariant.id, lines.map((l) => l.variantId)));
  return lines.reduce((a, l) => a + (rows.find((r) => r.id === l.variantId)?.weightG ?? 0) * l.qty, 0);
}

export async function shippingQuote(ctx: Ctx, carrier: CarrierAdapter, input: z.input<typeof ShippingQuoteSchema>) {
  requirePermission(ctx, 'online.manage');
  const data = ShippingQuoteSchema.parse(input);
  const districtId = await wardDistrict(ctx.db, data.wardCode);
  const weightG = await weightOf(ctx.db, data.lines);
  try {
    const q = await carrier.quote({ toDistrictId: districtId, toWardCode: data.wardCode, weightG, codVnd: data.codVnd, insuranceVnd: 0 });
    return { feeVnd: q.feeVnd, weightG };
  } catch (e) {
    if (e instanceof CarrierError) throw new AppError(409, 'carrier_unavailable', `Chưa lấy được phí GHN: ${e.message}. Hãy nhập phí giao hàng bằng tay.`);
    throw e;
  }
}

// =============================================================================================
// GHN shipment (FR-ORD-10)

/** Create the GHN order, then hand the parcel over in the system (stock out, Shipping). */
export async function createGhnShipment(ctx: Ctx, carrier: CarrierAdapter, id: string) {
  requirePermission(ctx, 'online.manage');
  const [o] = await ctx.db.select().from(schema.webOrder).where(eq(schema.webOrder.id, id));
  if (!o) throw errors.notFound('Đơn hàng');
  if (o.delivery !== 'ship') throw errors.conflict('pickup_order', `Đơn ${o.docNo} là đơn nhận tại cửa hàng, không tạo vận đơn.`);
  if (o.status !== 'confirmed' && o.status !== 'packing') throw errors.conflict('invalid_transition', `Đơn ${o.docNo} cần ở trạng thái “Đã xác nhận” hoặc “Đang đóng gói” để tạo vận đơn.`);
  if (!o.address?.wardCode || !o.address.line) throw new AppError(422, 'incomplete_address', `Đơn ${o.docNo} chưa có đủ địa chỉ giao hàng.`);
  const districtId = await wardDistrict(ctx.db, o.address.wardCode);
  const lines = await ctx.db
    .select({ l: schema.orderLine, sku: schema.itemVariant.sku, weightG: schema.itemVariant.weightG })
    .from(schema.orderLine)
    .innerJoin(schema.itemVariant, eq(schema.itemVariant.id, schema.orderLine.variantId))
    .where(eq(schema.orderLine.orderId, id))
    .orderBy(asc(schema.orderLine.lineNo));
  let created;
  try {
    created = await carrier.createShipment({
      clientOrderCode: o.docNo,
      to: { name: o.recipient.name, phone: o.recipient.phone.replace(/^\+84/, '0'), address: [o.address.line, o.address.wardName, o.address.provinceName].filter(Boolean).join(', '), wardCode: o.address.wardCode, districtId },
      codVnd: o.paymentMethod === 'cod' ? o.totalVnd - o.depositVnd : 0,
      insuranceVnd: 0,
      weightG: lines.reduce((a, r) => a + r.weightG * r.l.qty, 0),
      items: lines.map((r) => ({ name: r.l.description, code: r.sku, qty: r.l.qty, priceVnd: r.l.unitPriceVnd, weightG: r.weightG })),
      note: o.note,
    });
  } catch (e) {
    if (e instanceof CarrierError) {
      throw new AppError(409, 'carrier_unavailable', `GHN chưa tạo được vận đơn: ${e.message}. Có thể tạo vận đơn trên GHN rồi nhập mã vận đơn bằng tay.`);
    }
    throw e;
  }
  return ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(schema.webOrder).where(eq(schema.webOrder.id, id)).for('update');
    const s = await handToCarrierTx(tx, ctx, locked!, { carrier: 'ghn', trackingNo: created.trackingNo, feeVnd: created.feeVnd, carrierStatus: 'ready_to_pick' });
    return { id, status: locked!.status, shipment: s };
  });
}

// =============================================================================================
// Status updates: webhook first, 3-minute poll as fallback (TDD §4.5, §9.1)

const FINAL = ['delivered', 'returned', 'cancelled'] as const;

/** Apply a carrier status to a shipment and its order; replays are harmless. */
export async function applyShipmentStatus(ctx: Ctx, trackingNo: string, r: ShipmentStatusResult): Promise<boolean> {
  return ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(schema.shipment).where(and(eq(schema.shipment.carrier, 'ghn'), eq(schema.shipment.trackingNo, trackingNo))).for('update');
    if (!s) return false;
    if (s.carrierStatus === r.carrierStatus && s.status === r.status) return false;
    if ((FINAL as readonly string[]).includes(s.status)) return false;
    await tx.update(schema.shipment).set({ status: r.status, carrierStatus: r.carrierStatus, statusAt: r.at ?? ctx.clock.now() }).where(eq(schema.shipment.id, s.id));
    const [o] = await tx.select().from(schema.webOrder).where(eq(schema.webOrder.id, s.orderId)).for('update');
    if (!o) return true;
    // A failed delivery or a parcel coming back tells online staff once per change (FR-ADM-08, TDD §4.12).
    if (s.status !== r.status && (r.status === 'failed' || r.status === 'returning' || r.status === 'returned')) {
      await notifications.notifyHolders(tx, 'online.manage', 'delivery.update', { id: o.id, docNo: o.docNo, event: r.status });
    }
    if (r.status === 'delivered') await deliveredTx(tx, ctx, o, s.id);
    // Brought back to the store: a return to receive and inspect (FR-ORD-17).
    if (r.status === 'returned' && o.status === 'shipping') await carrierReturnTx(tx, ctx, o);
    return true;
  });
}

/** `ghn.poll`: refresh every GHN shipment that is still moving. */
export async function pollShipments(ctx: Ctx, carrier: CarrierAdapter, limit = 100): Promise<{ checked: number; changed: number }> {
  const open = await ctx.db
    .select({ trackingNo: schema.shipment.trackingNo })
    .from(schema.shipment)
    .where(and(eq(schema.shipment.carrier, 'ghn'), sql`${schema.shipment.status} not in ('delivered', 'returned', 'cancelled')`))
    .orderBy(asc(schema.shipment.statusAt))
    .limit(limit);
  let changed = 0;
  for (const { trackingNo } of open) {
    try {
      if (await applyShipmentStatus(ctx, trackingNo, await carrier.status(trackingNo))) changed++;
    } catch (e) {
      if (!(e instanceof CarrierError)) throw e;
    }
  }
  return { checked: open.length, changed };
}

export const GhnWebhookSchema = z.object({ OrderCode: z.string().min(1), Status: z.string().min(1), Time: z.string().optional() }).loose();

/** `POST /webhooks/ghn`: idempotent per (tracking number, status, time). */
export async function ghnWebhook(ctx: Ctx, payload: z.input<typeof GhnWebhookSchema>, map: (raw: string) => ShipmentStatusResult['status']) {
  const p = GhnWebhookSchema.parse(payload);
  const eventId = `${p.OrderCode}:${p.Status}:${p.Time ?? ''}`;
  const [fresh] = await ctx.db.insert(schema.webhookInbox).values({ provider: 'ghn', eventId }).onConflictDoNothing().returning({ id: schema.webhookInbox.id });
  if (!fresh) return { duplicate: true };
  const changed = await applyShipmentStatus(ctx, p.OrderCode, { carrierStatus: p.Status, status: map(p.Status), at: p.Time ? new Date(p.Time) : null });
  await ctx.db.update(schema.webhookInbox).set({ status: 'processed' }).where(eq(schema.webhookInbox.id, fresh.id));
  return { duplicate: false, changed };
}

// =============================================================================================
// COD remittance (FR-ORD-11): what GHN collected against what it paid the store

export const RemittanceQuery = z.object({ status: z.enum(['pending', 'matched', 'difference']).optional() });

export async function listRemittances(ctx: Ctx, input: z.input<typeof RemittanceQuery>) {
  requirePermission(ctx, 'online.manage');
  const q = RemittanceQuery.parse(input);
  const r = schema.codRemittance;
  return ctx.db
    .select({
      id: r.id,
      status: r.status,
      expectedVnd: r.expectedVnd,
      receivedVnd: r.receivedVnd,
      statementRef: r.statementRef,
      note: r.note,
      createdAt: r.createdAt,
      reconciledAt: r.reconciledAt,
      trackingNo: schema.shipment.trackingNo,
      carrier: schema.shipment.carrier,
      orderId: schema.webOrder.id,
      docNo: schema.webOrder.docNo,
    })
    .from(r)
    .innerJoin(schema.shipment, eq(schema.shipment.id, r.shipmentId))
    .innerJoin(schema.webOrder, eq(schema.webOrder.id, schema.shipment.orderId))
    .where(q.status ? eq(r.status, q.status) : undefined)
    .orderBy(asc(r.createdAt))
    .limit(500);
}

export const ReconcileSchema = z.object({
  receivedVnd: z.number().int().min(0),
  statementRef: z.string().trim().min(1, 'Cần nhập mã bảng kê GHN.').max(80),
  note: z.string().trim().max(500).optional(),
});

/** Record the carrier statement; a difference is flagged for follow-up. */
export async function reconcileRemittance(ctx: Ctx, id: string, input: z.input<typeof ReconcileSchema>) {
  const actor = requirePermission(ctx, 'online.manage');
  const data = ReconcileSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.codRemittance).where(eq(schema.codRemittance.id, id)).for('update');
    if (!row) throw errors.notFound('Khoản thu hộ');
    if (row.status === 'matched') throw errors.conflict('already_reconciled', 'Khoản thu hộ này đã khớp.');
    const status = data.receivedVnd === row.expectedVnd ? 'matched' : 'difference';
    await tx
      .update(schema.codRemittance)
      .set({ receivedVnd: data.receivedVnd, statementRef: data.statementRef, note: data.note ?? null, status, reconciledBy: actor.userId, reconciledAt: ctx.clock.now() })
      .where(eq(schema.codRemittance.id, id));
    return { id, status, differenceVnd: data.receivedVnd - row.expectedVnd };
  });
}
