import { schema } from '@bookstore/db';
import type { Permission } from '@bookstore/domain';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import * as audit from '../audit/index.js';
import * as catalog from '../catalog/index.js';
import * as customers from '../customers/index.js';
import * as inventory from '../inventory/index.js';
import { AppError, errors, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/**
 * Roll back a committed import (FR-ADM-07, TDD §4.12) with reversing documents only (BR-17), and
 * only while nothing depends on it. Every check runs before any change, in one transaction.
 */

const PERMISSION: Record<string, Permission> = { products: 'catalog.import', stock_in: 'catalog.import', customers: 'data.import' };

class Blocked extends AppError {
  constructor(reasons: string[]) {
    super(409, 'rollback_blocked', 'Không thể hoàn tác vì dữ liệu nhập đã được sử dụng.', { reasons });
  }
}

async function onHand(tx: Tx, variantId: string): Promise<number> {
  const [r] = await tx.execute<{ n: number }>(sql`select coalesce(sum(on_hand), 0)::int as n from inventory.stock_level where variant_id = ${variantId}::uuid`);
  return r!.n;
}

async function hasSales(tx: Tx, variantIds: string[]): Promise<Set<string>> {
  if (!variantIds.length) return new Set();
  const rows = await tx.selectDistinct({ id: schema.saleLine.variantId }).from(schema.saleLine).where(inArray(schema.saleLine.variantId, variantIds));
  return new Set(rows.map((r) => r.id!));
}

/** Discontinue a product created by the import and free its SKU, ISBN and barcodes. */
async function retire(tx: Tx, ctx: Ctx, variantId: string, jobId: string) {
  const [v] = await tx.select().from(schema.itemVariant).where(eq(schema.itemVariant.id, variantId));
  if (!v) return;
  await tx
    .update(schema.itemVariant)
    .set({ status: 'discontinued', publishedPos: false, publishedWeb: false, sku: `${v.sku}~rb-${jobId.slice(-6)}`, isbn13: null, updatedAt: ctx.clock.now() })
    .where(eq(schema.itemVariant.id, variantId));
  await tx.delete(schema.barcode).where(eq(schema.barcode.variantId, variantId));
  await tx.update(schema.item).set({ status: 'discontinued', updatedAt: ctx.clock.now() }).where(eq(schema.item.id, v.itemId));
  await tx.insert(schema.catalogChange).values({ entity: 'item', entityId: v.itemId, op: 'upsert' });
}

export async function rollback(ctx: Ctx, jobId: string) {
  const [job0] = await ctx.db.select().from(schema.importJob).where(eq(schema.importJob.id, jobId));
  if (!job0) throw errors.notFound('Lượt nhập');
  requirePermission(ctx, PERMISSION[job0.kind] ?? 'data.import');
  return ctx.db.transaction(async (tx) => {
    const [job] = await tx.select().from(schema.importJob).where(eq(schema.importJob.id, jobId)).for('update');
    if (job!.status !== 'committed') throw errors.conflict('import_not_committed', 'Chỉ hoàn tác được lượt nhập đã ghi.');
    const result = (job!.result ?? {}) as { entryId?: string; entryNo?: string; variantIds?: string[]; customerIds?: string[] };
    const reasons: string[] = [];
    const undone: Record<string, number> = {};

    if (job!.kind === 'stock_in' || job!.kind === 'products') {
      // What the import added, per variant: entry lines for a stock-in, opening stock for products.
      let lines: { variantId: string; qty: number; unitCostVnd: number; createdProduct: boolean; newPriceVnd: number | null }[];
      if (job!.kind === 'stock_in') {
        lines = await tx
          .select({ variantId: schema.stockInLine.variantId, qty: schema.stockInLine.qty, unitCostVnd: schema.stockInLine.unitCostVnd, createdProduct: schema.stockInLine.createdProduct, newPriceVnd: schema.stockInLine.newPriceVnd })
          .from(schema.stockInLine)
          .where(eq(schema.stockInLine.entryId, result.entryId!));
      } else {
        const ids = result.variantIds ?? [];
        const opening = ids.length
          ? await tx
              .select({ variantId: schema.stockMovement.variantId, qty: schema.stockMovement.qtyDelta, unit: schema.stockMovement.unitCostVnd })
              .from(schema.stockMovement)
              .where(and(eq(schema.stockMovement.refType, 'import_job'), eq(schema.stockMovement.refId, jobId)))
          : [];
        lines = ids.map((id) => {
          const o = opening.find((m) => m.variantId === id);
          return { variantId: id, qty: o?.qty ?? 0, unitCostVnd: o?.unit ?? 0, createdProduct: true, newPriceVnd: null };
        });
      }
      const sold = await hasSales(tx, lines.filter((l) => l.createdProduct).map((l) => l.variantId));
      const perVariant = new Map<string, number>();
      for (const l of lines) perVariant.set(l.variantId, (perVariant.get(l.variantId) ?? 0) + l.qty);
      for (const [variantId, qty] of perVariant) {
        const [v] = await tx.select({ sku: schema.itemVariant.sku }).from(schema.itemVariant).where(eq(schema.itemVariant.id, variantId));
        if (sold.has(variantId)) reasons.push(`Sản phẩm ${v?.sku} đã được bán.`);
        if ((await onHand(tx, variantId)) < qty) reasons.push(`Tồn kho của ${v?.sku} đã giảm sau khi nhập.`);
      }
      const [payable] = result.entryId
        ? await tx.select().from(schema.payable).where(and(eq(schema.payable.source, 'stock_in'), eq(schema.payable.sourceId, result.entryId)))
        : [];
      if (payable && payable.paidVnd > 0) reasons.push('Công nợ của phiếu nhập đã được thanh toán một phần.');
      if (reasons.length) throw new Blocked(reasons);

      for (const l of lines) {
        if (l.qty <= 0) continue;
        if (!l.createdProduct) await inventory.restoreAverageCost(tx, l.variantId, 'floor', l.qty, l.unitCostVnd);
        await inventory.apply(tx, ctx, { variantId: l.variantId, type: 'adjustment', qtyDelta: -l.qty, refType: 'import_rollback', refId: jobId, note: 'import_rollback' });
        // A price the stock-in changed goes back to the price before it (FR-CAT-07).
        if (!l.createdProduct && l.newPriceVnd !== null && result.entryNo) {
          const [prev] = await tx
            .select({ price: schema.priceHistory.priceVnd })
            .from(schema.priceHistory)
            .where(and(eq(schema.priceHistory.variantId, l.variantId), sql`coalesce(${schema.priceHistory.reason}, '') not in (${`stock_in ${result.entryNo}`}, 'import_rollback')`))
            .orderBy(desc(schema.priceHistory.effectiveFrom))
            .limit(1);
          if (prev) await catalog.setPriceTx(tx, ctx, l.variantId, { priceVnd: prev.price, reason: 'import_rollback' });
        }
      }
      for (const l of lines) if (l.createdProduct) await retire(tx, ctx, l.variantId, jobId);
      if (payable) await tx.update(schema.payable).set({ status: 'cancelled' }).where(eq(schema.payable.id, payable.id));
      undone.products = lines.filter((l) => l.createdProduct).length;
      undone.units = lines.reduce((a, l) => a + l.qty, 0);
    } else {
      const ids = result.customerIds ?? [];
      if (ids.length) {
        const withSales = await tx.selectDistinct({ id: schema.sale.customerId }).from(schema.sale).where(inArray(schema.sale.customerId, ids));
        if (withSales.length) reasons.push(`${withSales.length} khách hàng đã có đơn mua.`);
        const touched = await tx.selectDistinct({ id: schema.pointsLedger.customerId }).from(schema.pointsLedger).where(and(inArray(schema.pointsLedger.customerId, ids), ne(schema.pointsLedger.reason, 'import')));
        if (touched.length) reasons.push(`${touched.length} khách hàng đã dùng hoặc được cộng thêm điểm.`);
      }
      if (reasons.length) throw new Blocked(reasons);
      for (const id of ids) {
        const [c] = await tx.select({ balance: schema.customer.pointsBalance }).from(schema.customer).where(eq(schema.customer.id, id));
        if (c && c.balance > 0) await customers.post(tx, ctx, { customerId: id, delta: -c.balance, reason: 'adjust', refType: 'import_rollback', refId: jobId, note: 'Hoàn tác nhập dữ liệu' });
        await tx
          .update(schema.customer)
          .set({ name: 'Đã hoàn tác nhập', phoneE164: null, email: null, birthDate: null, addresses: [], tags: [], note: null, searchText: '', anonymisedAt: ctx.clock.now() })
          .where(eq(schema.customer.id, id));
      }
      undone.customers = ids.length;
    }

    await tx.update(schema.importJob).set({ status: 'rolled_back', updatedAt: ctx.clock.now() }).where(eq(schema.importJob.id, jobId));
    await audit.record(tx, ctx, { action: 'import.rollback', entity: 'import_job', entityId: jobId, after: { kind: job!.kind, ...undone } });
    return { jobId, status: 'rolled_back' as const, ...undone };
  });
}
