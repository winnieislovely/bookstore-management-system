import { schema } from '@bookstore/db';
import { divRoundHalfUp } from '@bookstore/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as inventory from '../inventory/index.js';
import * as settings from '../settings/index.js';
import { AppError, errors, nextDocNo, requirePermission, tsParam, type Ctx } from '../platform/index.js';

/** Consignment statements and returns (FR-PUR-10..12, BR-11, TDD §4.3). */

/** `YYYY-MM` in store time (Asia/Ho_Chi_Minh, UTC+7) → UTC range [from, to). */
export function monthRange(period: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new AppError(400, 'invalid_period', 'Kỳ đối soát có dạng YYYY-MM.');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const offset = 7 * 3600_000;
  return { from: new Date(Date.UTC(y, mo - 1, 1) - offset), to: new Date(Date.UTC(y, mo, 1) - offset) };
}

export async function listLots(ctx: Ctx, supplierId?: string) {
  requirePermission(ctx, 'purchasing.manage');
  return ctx.db.execute<{
    id: string;
    supplier_name: string;
    sku: string;
    title: string;
    qty_received: number;
    qty_sold: number;
    qty_returned: number;
    remaining: number;
    discount_bp: number;
    deadline_at: Date | null;
  }>(sql`
    select l.id, s.name as supplier_name, v.sku, i.i18n -> 'en' ->> 'title' as title, l.qty_received, l.qty_sold, l.qty_returned,
           (l.qty_received - l.qty_sold - l.qty_returned)::int as remaining, l.discount_bp, l.deadline_at
    from purchasing.consignment_lot l
    join purchasing.supplier s on s.id = l.supplier_id
    join catalog.item_variant v on v.id = l.variant_id
    join catalog.item i on i.id = v.item_id
    where ${supplierId ? sql`l.supplier_id = ${supplierId}::uuid` : sql`true`}
    order by l.deadline_at nulls last, l.created_at`);
}

export const StatementSchema = z.object({ supplierId: z.uuid(), period: z.string().regex(/^\d{4}-\d{2}$/, 'Kỳ đối soát có dạng YYYY-MM.') });

export interface StatementLine {
  variantId: string;
  sku: string;
  title: string;
  received: number;
  sold: number;
  returned: number;
  remaining: number;
  unitPriceVnd: number;
  discountBp: number;
  amountDueVnd: number;
}

/**
 * Generate, or regenerate while still a draft, the monthly statement of a consignor: quantities
 * received, sold and returned in the period, remaining now, and the amount due on sold units at the
 * agreed discount off the selling price at sale time (FR-PUR-10, TDD §4.3).
 */
export async function generateStatement(ctx: Ctx, input: z.input<typeof StatementSchema>) {
  requirePermission(ctx, 'purchasing.payables');
  const data = StatementSchema.parse(input);
  const { from, to } = monthRange(data.period);
  return ctx.db.transaction(async (tx) => {
    const [supplier] = await tx.select().from(schema.supplier).where(eq(schema.supplier.id, data.supplierId));
    if (!supplier?.isConsignor) throw new AppError(400, 'not_a_consignor', 'Nhà cung cấp này không ký gửi hàng.');
    const [existing] = await tx
      .select()
      .from(schema.consignmentStatement)
      .where(and(eq(schema.consignmentStatement.supplierId, data.supplierId), eq(schema.consignmentStatement.period, data.period)))
      .for('update');
    if (existing && existing.status !== 'draft') throw errors.conflict('statement_approved', 'Bảng đối soát kỳ này đã được duyệt.');

    const sold = await tx.execute<{ variant_id: string; unit_price_vnd: string; discount_bp: number; qty: number }>(sql`
      select l.variant_id, a.unit_price_vnd, l.discount_bp, sum(a.qty)::int as qty
      from purchasing.consignment_allocation a join purchasing.consignment_lot l on l.id = a.lot_id
      where l.supplier_id = ${data.supplierId}::uuid and a.at >= ${tsParam(from)} and a.at < ${tsParam(to)}
      group by l.variant_id, a.unit_price_vnd, l.discount_bp having sum(a.qty) <> 0
      order by a.unit_price_vnd desc`);
    const movement = await tx.execute<{ variant_id: string; sku: string; title: string; received: number; returned: number; remaining: number }>(sql`
      select v.id as variant_id, v.sku, i.i18n -> 'en' ->> 'title' as title,
        coalesce(sum(l.qty_received) filter (where l.created_at >= ${tsParam(from)} and l.created_at < ${tsParam(to)}), 0)::int as received,
        coalesce((select sum(r.qty) from purchasing.consignment_return r join purchasing.consignment_lot l2 on l2.id = r.lot_id
                  where l2.variant_id = v.id and l2.supplier_id = ${data.supplierId}::uuid and r.at >= ${tsParam(from)} and r.at < ${tsParam(to)}), 0)::int as returned,
        coalesce(sum(l.qty_received - l.qty_sold - l.qty_returned), 0)::int as remaining
      from purchasing.consignment_lot l join catalog.item_variant v on v.id = l.variant_id join catalog.item i on i.id = v.item_id
      where l.supplier_id = ${data.supplierId}::uuid
      group by v.id, i.id order by v.sku`);

    const lines: StatementLine[] = [];
    for (const m of movement) {
      const soldRows = sold.filter((s) => s.variant_id === m.variant_id);
      const base = { variantId: m.variant_id, sku: m.sku, title: m.title, received: m.received, returned: m.returned, remaining: m.remaining };
      if (!soldRows.length) {
        if (m.received || m.returned) lines.push({ ...base, sold: 0, unitPriceVnd: 0, discountBp: 0, amountDueVnd: 0 });
        continue;
      }
      soldRows.forEach((s, i) => {
        const unit = Number(s.unit_price_vnd);
        const net = divRoundHalfUp(unit * (10_000 - s.discount_bp), 10_000);
        // Received, returned and remaining are per variant; they appear on its first price row only.
        const counts = i === 0 ? {} : { received: 0, returned: 0, remaining: 0 };
        lines.push({ ...base, ...counts, sold: s.qty, unitPriceVnd: unit, discountBp: s.discount_bp, amountDueVnd: net * s.qty });
      });
    }
    const amountDue = lines.reduce((a, l) => a + l.amountDueVnd, 0);
    let id: string;
    let docNo: string;
    if (existing) {
      await tx.update(schema.consignmentStatement).set({ lines, amountDueVnd: amountDue }).where(eq(schema.consignmentStatement.id, existing.id));
      id = existing.id;
      docNo = existing.docNo;
    } else {
      docNo = await nextDocNo(tx, 'CST', ctx.clock.now());
      const [row] = await tx
        .insert(schema.consignmentStatement)
        .values({ docNo, supplierId: data.supplierId, period: data.period, lines, amountDueVnd: amountDue })
        .returning({ id: schema.consignmentStatement.id });
      id = row!.id;
    }
    return { id, docNo, period: data.period, supplierName: supplier.name, lines, amountDueVnd: amountDue, status: 'draft' as const };
  });
}

/** Approving creates the payable for the sold quantity (FR-PUR-11); payment then follows FR-PUR-06. */
export async function approveStatement(ctx: Ctx, id: string) {
  const actor = requirePermission(ctx, 'purchasing.payables');
  return ctx.db.transaction(async (tx) => {
    const [st] = await tx.select().from(schema.consignmentStatement).where(eq(schema.consignmentStatement.id, id)).for('update');
    if (!st) throw errors.notFound('Bảng đối soát');
    if (st.status !== 'draft') throw errors.conflict('statement_approved', 'Bảng đối soát đã được duyệt.');
    const [supplier] = await tx.select().from(schema.supplier).where(eq(schema.supplier.id, st.supplierId));
    const now = ctx.clock.now();
    let payableId: string | null = null;
    if (st.amountDueVnd > 0) {
      const dueAt = supplier?.termsDays != null ? new Date(now.getTime() + supplier.termsDays * 86_400_000) : null;
      const [p] = await tx
        .insert(schema.payable)
        .values({ supplierId: st.supplierId, source: 'consignment', sourceId: st.id, amountVnd: st.amountDueVnd, dueAt, createdAt: now })
        .returning({ id: schema.payable.id });
      payableId = p!.id;
    }
    await tx.update(schema.consignmentStatement).set({ status: 'approved', approvedBy: actor.userId, approvedAt: now, payableId }).where(eq(schema.consignmentStatement.id, id));
    await audit.record(tx, ctx, {
      action: 'consignment_statement.approve',
      entity: 'consignment_statement',
      entityId: id,
      after: { docNo: st.docNo, amountDueVnd: st.amountDueVnd, payableId },
    });
    return { id, payableId, amountDueVnd: st.amountDueVnd };
  });
}

export async function listStatements(ctx: Ctx, supplierId?: string) {
  requirePermission(ctx, 'purchasing.payables');
  const s = schema.consignmentStatement;
  return ctx.db
    .select({ id: s.id, docNo: s.docNo, supplierName: schema.supplier.name, period: s.period, amountDueVnd: s.amountDueVnd, status: s.status, approvedAt: s.approvedAt })
    .from(s)
    .innerJoin(schema.supplier, eq(schema.supplier.id, s.supplierId))
    .where(supplierId ? eq(s.supplierId, supplierId) : undefined)
    .orderBy(desc(s.period));
}

export async function getStatement(ctx: Ctx, id: string) {
  requirePermission(ctx, 'purchasing.payables');
  const [st] = await ctx.db
    .select({ s: schema.consignmentStatement, supplierName: schema.supplier.name, supplierTaxCode: schema.supplier.taxCode })
    .from(schema.consignmentStatement)
    .innerJoin(schema.supplier, eq(schema.supplier.id, schema.consignmentStatement.supplierId))
    .where(eq(schema.consignmentStatement.id, id));
  if (!st) throw errors.notFound('Bảng đối soát');
  // Store header for the A4 print (Design §16.1, §16.8).
  const cfg = await settings.snapshot(ctx);
  const store = { name: cfg['store.name'], address: cfg['store.address'], taxCode: cfg['store.tax_code'], phone: cfg['store.phone'] };
  return { ...st.s, supplierName: st.supplierName, supplierTaxCode: st.supplierTaxCode, store };
}

export const ConsignmentReturnSchema = z.object({
  lotId: z.uuid(),
  qty: z.number().int().positive(),
  note: z.string().trim().max(300).optional(),
});

/** Return unsold consignment stock to the consignor: reduces stock without cost impact (FR-PUR-12). */
export async function returnConsignment(ctx: Ctx, input: z.input<typeof ConsignmentReturnSchema>) {
  const actor = requirePermission(ctx, 'purchasing.manage');
  const data = ConsignmentReturnSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const l = schema.consignmentLot;
    const [lot] = await tx
      .update(l)
      .set({ qtyReturned: sql`${l.qtyReturned} + ${data.qty}` })
      .where(and(eq(l.id, data.lotId), sql`${l.qtyReceived} - ${l.qtySold} - ${l.qtyReturned} >= ${data.qty}`))
      .returning();
    if (!lot) {
      const [cur] = await tx.select().from(l).where(eq(l.id, data.lotId));
      if (!cur) throw errors.notFound('Lô ký gửi');
      throw new AppError(422, 'return_exceeds_remaining', `Lô ký gửi chỉ còn ${cur.qtyReceived - cur.qtySold - cur.qtyReturned} sản phẩm chưa bán.`);
    }
    const [ret] = await tx
      .insert(schema.consignmentReturn)
      .values({ supplierId: lot.supplierId, lotId: lot.id, qty: data.qty, note: data.note ?? null, createdBy: actor.userId, at: ctx.clock.now() })
      .returning({ id: schema.consignmentReturn.id });
    // Recorded at zero cost: consignment stock never entered the moving average (TDD §4.2).
    await inventory.apply(tx, ctx, { variantId: lot.variantId, type: 'consignment_return', qtyDelta: -data.qty, unitCostVnd: 0, refType: 'consignment_return', refId: ret!.id });
    await audit.record(tx, ctx, { action: 'consignment.return', entity: 'consignment_lot', entityId: lot.id, after: { qty: data.qty } });
    return { id: ret!.id, remaining: lot.qtyReceived - lot.qtySold - lot.qtyReturned };
  });
}
