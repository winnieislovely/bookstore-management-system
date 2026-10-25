import { schema } from '@bookstore/db';
import { canTransition, SUPPLIER_ORDER } from '@bookstore/domain';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as settings from '../settings/index.js';
import { AppError, errors, nextDocNo, requirePermission, tsParam, type Ctx, type Tx } from '../platform/index.js';

/**
 * Optional supplier orders (FR-PUR-07) and reorder suggestions (FR-INV-09, FR-PUR-08, TDD §4.3).
 * Orders are never required for a stock-in; receiving uses the quick stock-in with the order line.
 */

type OrderStatus = keyof typeof SUPPLIER_ORDER;

export const OrderSchema = z.object({
  supplierId: z.uuid(),
  expectedAt: z.iso.datetime().optional(),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(z.object({ variantId: z.uuid(), qty: z.number().int().positive(), unitCostVnd: z.number().int().min(0).optional() }))
    .min(1),
});

export async function createOrder(ctx: Ctx, input: z.input<typeof OrderSchema>) {
  const actor = requirePermission(ctx, 'purchasing.manage');
  const data = OrderSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [sup] = await tx.select({ id: schema.supplier.id }).from(schema.supplier).where(eq(schema.supplier.id, data.supplierId));
    if (!sup) throw errors.notFound('Nhà cung cấp');
    const docNo = await nextDocNo(tx, 'PO', ctx.clock.now());
    const [o] = await tx
      .insert(schema.supplierOrder)
      .values({ docNo, supplierId: data.supplierId, expectedAt: data.expectedAt ? new Date(data.expectedAt) : null, note: data.note ?? null, createdBy: actor.userId })
      .returning({ id: schema.supplierOrder.id });
    await tx.insert(schema.supplierOrderLine).values(data.lines.map((l) => ({ orderId: o!.id, variantId: l.variantId, qty: l.qty, unitCostVnd: l.unitCostVnd ?? null })));
    await audit.record(tx, ctx, { action: 'supplier_order.create', entity: 'supplier_order', entityId: o!.id, after: { docNo, lines: data.lines.length } });
    return { id: o!.id, docNo, status: 'draft' as const };
  });
}

async function transition(ctx: Ctx, id: string, to: OrderStatus, action: string) {
  requirePermission(ctx, 'purchasing.manage');
  return ctx.db.transaction(async (tx) => {
    const [o] = await tx.select().from(schema.supplierOrder).where(eq(schema.supplierOrder.id, id)).for('update');
    if (!o) throw errors.notFound('Đơn đặt NCC');
    if (!canTransition(SUPPLIER_ORDER, o.status as OrderStatus, to)) {
      throw errors.conflict('invalid_transition', `Không thể chuyển đơn từ “${o.status}” sang “${to}”.`);
    }
    await tx.update(schema.supplierOrder).set({ status: to, version: o.version + 1, updatedAt: ctx.clock.now() }).where(eq(schema.supplierOrder.id, id));
    await audit.record(tx, ctx, { action, entity: 'supplier_order', entityId: id, before: { status: o.status }, after: { status: to } });
    return { id, status: to };
  });
}

export const sendOrder = (ctx: Ctx, id: string) => transition(ctx, id, 'sent', 'supplier_order.send');
export const cancelOrder = (ctx: Ctx, id: string) => transition(ctx, id, 'cancelled', 'supplier_order.cancel');
export const closeOrder = (ctx: Ctx, id: string) => transition(ctx, id, 'closed', 'supplier_order.close');

export async function listOrders(ctx: Ctx, status?: string) {
  requirePermission(ctx, 'purchasing.manage');
  const o = schema.supplierOrder;
  return ctx.db
    .select({
      id: o.id,
      docNo: o.docNo,
      supplierName: schema.supplier.name,
      status: o.status,
      expectedAt: o.expectedAt,
      createdAt: o.createdAt,
      lines: sql<number>`(select count(*)::int from purchasing.supplier_order_line l where l.order_id = ${o.id})`,
      outstanding: sql<number>`(select coalesce(sum(greatest(l.qty - l.received_qty, 0)), 0)::int from purchasing.supplier_order_line l where l.order_id = ${o.id})`,
    })
    .from(o)
    .innerJoin(schema.supplier, eq(schema.supplier.id, o.supplierId))
    .where(status ? eq(o.status, status) : undefined)
    .orderBy(desc(o.createdAt), desc(o.id));
}

export async function getOrder(ctx: Ctx, id: string) {
  requirePermission(ctx, 'purchasing.manage');
  const [o] = await ctx.db
    .select({ o: schema.supplierOrder, supplierName: schema.supplier.name })
    .from(schema.supplierOrder)
    .innerJoin(schema.supplier, eq(schema.supplier.id, schema.supplierOrder.supplierId))
    .where(eq(schema.supplierOrder.id, id));
  if (!o) throw errors.notFound('Đơn đặt NCC');
  const lines = await ctx.db
    .select({ id: schema.supplierOrderLine.id, variantId: schema.supplierOrderLine.variantId, sku: schema.itemVariant.sku, title: sql<string>`${schema.item.i18n} -> 'en' ->> 'title'`, qty: schema.supplierOrderLine.qty, receivedQty: schema.supplierOrderLine.receivedQty, unitCostVnd: schema.supplierOrderLine.unitCostVnd })
    .from(schema.supplierOrderLine)
    .innerJoin(schema.itemVariant, eq(schema.itemVariant.id, schema.supplierOrderLine.variantId))
    .innerJoin(schema.item, eq(schema.item.id, schema.itemVariant.itemId))
    .where(eq(schema.supplierOrderLine.orderId, id))
    .orderBy(asc(schema.itemVariant.sku));
  return { ...o.o, supplierName: o.supplierName, lines };
}

/**
 * Receive against an order line inside a stock-in transaction (TDD §4.3): adds to `received_qty`
 * and moves the order to `partially_received` or `received`.
 */
export async function receiveLine(tx: Tx, orderLineId: string, variantId: string, qty: number): Promise<void> {
  const [line] = await tx
    .select({ l: schema.supplierOrderLine, status: schema.supplierOrder.status })
    .from(schema.supplierOrderLine)
    .innerJoin(schema.supplierOrder, eq(schema.supplierOrder.id, schema.supplierOrderLine.orderId))
    .where(eq(schema.supplierOrderLine.id, orderLineId))
    .for('update');
  if (!line) throw errors.notFound('Dòng đơn đặt NCC');
  if (line.l.variantId !== variantId) throw new AppError(400, 'order_line_mismatch', 'Sản phẩm không khớp dòng đơn đặt NCC.');
  if (line.status !== 'sent' && line.status !== 'partially_received') {
    throw errors.conflict('order_not_open', 'Đơn đặt NCC chưa gửi hoặc đã đóng, không nhận hàng theo đơn được.');
  }
  await tx.update(schema.supplierOrderLine).set({ receivedQty: line.l.receivedQty + qty }).where(eq(schema.supplierOrderLine.id, orderLineId));
  const [left] = await tx.execute<{ open: number }>(sql`
    select count(*)::int as open from purchasing.supplier_order_line where order_id = ${line.l.orderId}::uuid and received_qty < qty`);
  await tx
    .update(schema.supplierOrder)
    .set({ status: left!.open === 0 ? 'received' : 'partially_received' })
    .where(eq(schema.supplierOrder.id, line.l.orderId));
}

// ---------------------------------------------------------------------------------------------
// Reorder suggestions (FR-INV-09, FR-PUR-08)

export async function suggestions(ctx: Ctx) {
  requirePermission(ctx, 'purchasing.manage');
  const cfg = await settings.snapshot(ctx);
  const days = cfg['purchasing.velocity_days'];
  const cover = cfg['purchasing.reorder_cover_days'];
  const since = new Date(ctx.clock.now().getTime() - days * 86_400_000);
  const rows = await ctx.db.execute<{
    variant_id: string;
    sku: string;
    title: string;
    sold: number;
    available: number;
    on_order: number;
    min_stock: number | null;
    supplier_id: string | null;
    supplier_name: string | null;
    last_cost: string | null;
  }>(sql`
    select v.id as variant_id, v.sku, i.i18n -> 'en' ->> 'title' as title,
      -- Units out through sales, including components sold inside bundles (bundle_use).
      coalesce((select -sum(m.qty_delta) from inventory.stock_movement m
                where m.variant_id = v.id and m.type in ('sale', 'bundle_use') and m.at >= ${tsParam(since)}), 0)::int as sold,
      coalesce((select sum(st.on_hand - st.reserved) from inventory.stock_level st where st.variant_id = v.id), 0)::int as available,
      coalesce((select sum(greatest(ol.qty - ol.received_qty, 0)) from purchasing.supplier_order_line ol
                join purchasing.supplier_order o on o.id = ol.order_id
                where ol.variant_id = v.id and o.status in ('draft', 'sent', 'partially_received')), 0)::int as on_order,
      v.min_stock, last.supplier_id, last.supplier_name, last.unit_cost_vnd as last_cost
    from catalog.item_variant v join catalog.item i on i.id = v.item_id
    left join lateral (
      select e.supplier_id, s.name as supplier_name, sl.unit_cost_vnd from purchasing.stock_in_line sl
      join purchasing.stock_in_entry e on e.id = sl.entry_id left join purchasing.supplier s on s.id = e.supplier_id
      where sl.variant_id = v.id order by e.created_at desc limit 1) last on true
    where v.status = 'active' and i.kind <> 'bundle'`);
  const lines = rows
    .map((r) => {
      const velocity = r.sold / days;
      // Pre-order and special-order demand joins this sum in release R2.
      let qty = Math.ceil(velocity * cover) - r.available - r.on_order;
      if (r.min_stock != null) qty = Math.max(qty, r.min_stock - r.available - r.on_order);
      return {
        variantId: r.variant_id,
        sku: r.sku,
        title: r.title,
        soldInPeriod: r.sold,
        dailyVelocity: Math.round(velocity * 100) / 100,
        available: r.available,
        onOrder: r.on_order,
        minStock: r.min_stock,
        suggestedQty: qty,
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
        lastCostVnd: r.last_cost === null ? null : Number(r.last_cost),
      };
    })
    .filter((l) => l.suggestedQty > 0);
  const groups = new Map<string, { supplierId: string | null; supplierName: string | null; lines: typeof lines }>();
  for (const l of lines) {
    const key = l.supplierId ?? 'none';
    const g = groups.get(key) ?? { supplierId: l.supplierId, supplierName: l.supplierName, lines: [] };
    g.lines.push(l);
    groups.set(key, g);
  }
  return { velocityDays: days, coverDays: cover, suppliers: [...groups.values()] };
}

