import { schema } from '@bookstore/db';
import { isMarginTooLow, netOfVat, vnd } from '@bookstore/domain';
import { and, asc, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as catalog from '../catalog/index.js';
import * as inventory from '../inventory/index.js';
import * as settings from '../settings/index.js';
import { AppError, emit, errors, nextDocNo, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/** Purchasing, suppliers and payables (FR-PUR-01..06, FR-PUR-09, TDD §4.3). */

const money = z.number().int().min(0);

// ---------------------------------------------------------------------------------------------
// Suppliers (FR-PUR-01)

export const SupplierSchema = z.object({
  name: z.string().trim().min(1),
  taxCode: z.string().trim().min(1).nullable().optional(),
  kind: z.enum(['publisher', 'distributor', 'vendor', 'individual']),
  isConsignor: z.boolean().default(false),
  tracksPayables: z.boolean().default(false),
  termsDays: z.number().int().min(0).nullable().optional(),
  contacts: z.array(z.object({ name: z.string(), phone: z.string().optional(), email: z.string().optional() })).default([]),
  bank: z.object({ bankName: z.string(), accountNo: z.string(), accountName: z.string() }).nullable().optional(),
  note: z.string().trim().optional(),
});

export async function createSupplier(ctx: Ctx, input: z.input<typeof SupplierSchema>) {
  requirePermission(ctx, 'purchasing.manage');
  const data = SupplierSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    if (data.taxCode) {
      const [dupe] = await tx.select({ name: schema.supplier.name }).from(schema.supplier).where(eq(schema.supplier.taxCode, data.taxCode));
      if (dupe) throw errors.conflict('duplicate_tax_code', `Mã số thuế ${data.taxCode} đã có cho nhà cung cấp '${dupe.name}'.`);
    }
    const [row] = await tx
      .insert(schema.supplier)
      .values({
        name: data.name,
        taxCode: data.taxCode ?? null,
        kind: data.kind,
        isConsignor: data.isConsignor,
        tracksPayables: data.tracksPayables,
        termsDays: data.termsDays ?? null,
        contacts: data.contacts,
        bankEnc: data.bank ? ctx.crypto.encrypt(JSON.stringify(data.bank)) : null,
        note: data.note ?? null,
      })
      .returning({ id: schema.supplier.id });
    await audit.record(tx, ctx, { action: 'supplier.create', entity: 'supplier', entityId: row!.id, after: { name: data.name, tracksPayables: data.tracksPayables } });
    return { id: row!.id };
  });
}

export async function listSuppliers(ctx: Ctx) {
  requirePermission(ctx, 'purchasing.manage');
  const rows = await ctx.db.select().from(schema.supplier).where(eq(schema.supplier.status, 'active')).orderBy(asc(schema.supplier.name));
  return rows.map(({ bankEnc, ...s }) => ({ ...s, hasBank: bankEnc !== null }));
}

// ---------------------------------------------------------------------------------------------
// Quick stock-in (FR-PUR-02..06, FR-PUR-09)

/** Existing product: only cost, selling price and quantity (FR-PUR-03). */
export const ExistingLineSchema = z.object({
  kind: z.literal('existing'),
  variantId: z.uuid(),
  costVnd: money,
  sellingPriceVnd: money,
  qty: z.number().int().positive(),
  location: z.enum(['floor', 'back']).default('floor'),
});

/**
 * New product: SKU, item, product name, category, supplier, cost, selling price, weight, first
 * quantity, image and description, plus the other fields the catalogue requires (FR-PUR-02).
 */
export const NewProductLineSchema = z.object({
  kind: z.literal('new'),
  item: catalog.ItemSchema.omit({ variants: true }),
  variant: catalog.VariantSchema.omit({ priceVnd: true }),
  /** Required on the form (FR-PUR-02); bulk import may leave it empty (FR-CAT-11, “missing image”). */
  imageFileIds: z.array(z.uuid()).default([]),
  costVnd: money,
  sellingPriceVnd: money,
  qty: z.number().int().positive(),
  location: z.enum(['floor', 'back']).default('floor'),
});

export const StockInBaseSchema = z
  .object({
    supplierId: z.uuid().nullable().optional(),
    supplierInvoiceNo: z.string().trim().max(60).optional(),
    invoiceFileId: z.uuid().optional(),
    note: z.string().trim().max(500).optional(),
    consignment: z.boolean().default(false),
    /** Consignment terms (FR-PUR-09): agreed discount and settlement/return deadline. */
    consignmentDiscountBp: z.number().int().min(0).max(10000).optional(),
    consignmentDeadline: z.iso.datetime().optional(),
    /** For suppliers that track payables: amount owed; defaults to the total cost (FR-PUR-06). */
    payableVnd: money.optional(),
    lines: z.array(z.discriminatedUnion('kind', [ExistingLineSchema, NewProductLineSchema])).min(1),
    source: z.enum(['manual', 'import']).default('manual'),
    importJobId: z.uuid().optional(),
  });

export const StockInSchema = StockInBaseSchema.refine((s) => !s.lines.some((l) => l.kind === 'new') || !!s.supplierId, {
    message: 'Sản phẩm mới cần chọn nhà cung cấp.',
    path: ['supplierId'],
  });
export type StockInInput = z.input<typeof StockInSchema>;

export interface StockInLineResult {
  variantId: string;
  createdProduct: boolean;
  priceChanged: boolean;
  marginFlag: boolean;
  avgCostVnd: number;
}

/**
 * Post a stock-in entry in the caller's transaction: one automatic `SI` entry number, products
 * created for new lines, moving-average cost, price history, margin flags, a payable or a
 * consignment lot, and the `stock_in.posted` event (TDD §4.3). Used by the form and by bulk import.
 */
export async function postStockInTx(tx: Tx, ctx: Ctx, input: StockInInput, opts: { allowMissingImage?: boolean } = {}) {
  const actor = requirePermission(ctx, 'purchasing.manage');
  const data = StockInSchema.parse(input);
  if (!opts.allowMissingImage && data.lines.some((l) => l.kind === 'new' && l.imageFileIds.length === 0)) {
    throw new AppError(400, 'image_required', 'Sản phẩm mới cần ít nhất một ảnh.');
  }
  const cfg = await settings.snapshot(ctx, tx);

  let supplier: typeof schema.supplier.$inferSelect | undefined;
  if (data.supplierId) {
    [supplier] = await tx.select().from(schema.supplier).where(eq(schema.supplier.id, data.supplierId));
    if (!supplier) throw errors.notFound('Nhà cung cấp');
  }
  if (data.consignment && !supplier?.isConsignor) {
    throw new AppError(400, 'not_a_consignor', 'Hàng ký gửi cần chọn nhà cung cấp có ký gửi.');
  }

  const now = ctx.clock.now();
  const entryNo = await nextDocNo(tx, 'SI', now);
  const totalCost = data.lines.reduce((a, l) => a + l.costVnd * l.qty, 0);
  const [entry] = await tx
    .insert(schema.stockInEntry)
    .values({
      entryNo,
      supplierId: data.supplierId ?? null,
      supplierInvoiceNo: data.supplierInvoiceNo ?? null,
      invoiceFileId: data.invoiceFileId ?? null,
      consignment: data.consignment,
      note: data.note ?? null,
      source: data.source,
      importJobId: data.importJobId ?? null,
      totalCostVnd: totalCost,
      createdBy: actor.userId,
      createdAt: now,
    })
    .returning({ id: schema.stockInEntry.id });

  const results: StockInLineResult[] = [];
  for (const line of data.lines) {
    let variantId: string;
    let createdProduct = false;
    let priceChanged = false;
    let vatBp: number;
    if (line.kind === 'new') {
      const created = await catalog.createItemTx(tx, ctx, {
        ...line.item,
        variants: [{ ...line.variant, priceVnd: line.sellingPriceVnd }],
      });
      variantId = created.variantIds[0]!;
      createdProduct = true;
      vatBp = line.variant.vatBp;
      if (line.imageFileIds.length) {
        await tx.insert(schema.itemImage).values(line.imageFileIds.map((fileId, sort) => ({ itemId: created.itemId, fileId, sort })));
      }
    } else {
      const [v] = await tx.select().from(schema.itemVariant).where(eq(schema.itemVariant.id, line.variantId));
      if (!v) throw errors.notFound('Sản phẩm');
      variantId = v.id;
      vatBp = v.vatBp;
      // A changed selling price is saved in the price history (FR-PUR-03).
      priceChanged = await catalog.setPriceTx(tx, ctx, v.id, { priceVnd: line.sellingPriceVnd, reason: `stock_in ${entryNo}` });
    }

    const applied = await inventory.apply(tx, ctx, {
      variantId,
      location: line.location,
      type: data.consignment ? 'consignment_receipt' : 'stock_in',
      qtyDelta: line.qty,
      unitCostVnd: line.costVnd,
      // Consignment stock carries no cost until settled (TDD §4.2).
      affectsCost: !data.consignment,
      refType: 'stock_in',
      refId: entry!.id,
      note: entryNo,
    });
    const marginFlag = isMarginTooLow(netOfVat(vnd(line.sellingPriceVnd), vatBp), vnd(line.costVnd), cfg['purchasing.min_margin_bp']);
    const [sil] = await tx
      .insert(schema.stockInLine)
      .values({
        entryId: entry!.id,
        variantId,
        qty: line.qty,
        unitCostVnd: line.costVnd,
        newPriceVnd: priceChanged || createdProduct ? line.sellingPriceVnd : null,
        createdProduct,
        marginFlag,
      })
      .returning({ id: schema.stockInLine.id });
    if (data.consignment) {
      await tx.insert(schema.consignmentLot).values({
        supplierId: supplier!.id,
        variantId,
        stockInLineId: sil!.id,
        qtyReceived: line.qty,
        discountBp: data.consignmentDiscountBp ?? 0,
        deadlineAt: data.consignmentDeadline ? new Date(data.consignmentDeadline) : null,
      });
    }
    results.push({ variantId, createdProduct, priceChanged, marginFlag, avgCostVnd: applied.avgCostVnd });
  }

  // Payables only for suppliers flagged "tracks payables"; others are treated as paid (FR-PUR-06).
  // Consignment creates no payable until the statement is approved (FR-PUR-09, FR-PUR-11).
  let payableId: string | null = null;
  if (supplier?.tracksPayables && !data.consignment) {
    const amount = data.payableVnd ?? totalCost;
    if (amount > 0) {
      const dueAt = supplier.termsDays != null ? new Date(now.getTime() + supplier.termsDays * 86_400_000) : null;
      const [p] = await tx
        .insert(schema.payable)
        .values({ supplierId: supplier.id, source: 'stock_in', sourceId: entry!.id, amountVnd: amount, dueAt, createdAt: now })
        .returning({ id: schema.payable.id });
      payableId = p!.id;
    }
  }

  await emit(tx, 'stock_in.posted', { entryId: entry!.id, variantIds: results.map((r) => r.variantId) });
  await audit.record(tx, ctx, {
    action: 'stock_in.post',
    entity: 'stock_in_entry',
    entityId: entry!.id,
    after: { entryNo, lines: data.lines.length, totalCostVnd: totalCost, consignment: data.consignment, payableId },
  });
  return { id: entry!.id, entryNo, totalCostVnd: totalCost, payableId, lines: results };
}

export async function postStockIn(ctx: Ctx, input: StockInInput) {
  requirePermission(ctx, 'purchasing.manage');
  return ctx.db.transaction((tx) => postStockInTx(tx, ctx, input));
}

export const StockInQuery = z.object({
  supplier: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(40),
});

export async function listStockIns(ctx: Ctx, input: z.input<typeof StockInQuery>) {
  requirePermission(ctx, 'purchasing.manage');
  const q = StockInQuery.parse(input);
  const e = schema.stockInEntry;
  const where: SQL[] = [];
  if (q.supplier) where.push(eq(e.supplierId, q.supplier));
  if (q.from) where.push(gte(e.createdAt, new Date(q.from)));
  if (q.to) where.push(lte(e.createdAt, new Date(q.to)));
  const rows = await ctx.db
    .select({
      id: e.id,
      entryNo: e.entryNo,
      supplierName: schema.supplier.name,
      supplierInvoiceNo: e.supplierInvoiceNo,
      consignment: e.consignment,
      totalCostVnd: e.totalCostVnd,
      source: e.source,
      createdAt: e.createdAt,
      lines: sql<number>`(select count(*)::int from purchasing.stock_in_line l where l.entry_id = ${e.id})`,
      marginFlags: sql<number>`(select count(*)::int from purchasing.stock_in_line l where l.entry_id = ${e.id} and l.margin_flag)`,
    })
    .from(e)
    .leftJoin(schema.supplier, eq(schema.supplier.id, e.supplierId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(e.createdAt), desc(e.id))
    .limit(q.limit)
    .offset((q.page - 1) * q.limit);
  return { items: rows, page: q.page };
}

// ---------------------------------------------------------------------------------------------
// Payables (FR-PUR-06): visible only with `purchasing.payables`

export async function listPayables(ctx: Ctx, supplierId?: string) {
  requirePermission(ctx, 'purchasing.payables');
  const p = schema.payable;
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select({
      id: p.id,
      supplierId: p.supplierId,
      supplierName: schema.supplier.name,
      source: p.source,
      sourceId: p.sourceId,
      amountVnd: p.amountVnd,
      paidVnd: p.paidVnd,
      dueAt: p.dueAt,
      status: p.status,
      createdAt: p.createdAt,
    })
    .from(p)
    .innerJoin(schema.supplier, eq(schema.supplier.id, p.supplierId))
    .where(supplierId ? eq(p.supplierId, supplierId) : undefined)
    .orderBy(asc(p.dueAt), asc(p.createdAt));
  const items = rows.map((r) => {
    const balance = r.amountVnd - r.paidVnd;
    const overdueDays = r.dueAt && balance > 0 ? Math.max(0, Math.floor((now.getTime() - r.dueAt.getTime()) / 86_400_000)) : 0;
    const bucket = balance === 0 ? 'paid' : overdueDays === 0 ? 'current' : overdueDays <= 30 ? '1-30' : overdueDays <= 60 ? '31-60' : overdueDays <= 90 ? '61-90' : '90+';
    return { ...r, balanceVnd: balance, overdueDays, ageingBucket: bucket };
  });
  return { items, totalBalanceVnd: items.reduce((a, r) => a + r.balanceVnd, 0) };
}

export const PaymentSchema = z.object({
  amountVnd: z.number().int().positive(),
  method: z.enum(['cash', 'transfer']),
  paidAt: z.iso.datetime().optional(),
  note: z.string().trim().max(300).optional(),
});

export async function payPayable(ctx: Ctx, payableId: string, input: z.input<typeof PaymentSchema>) {
  const actor = requirePermission(ctx, 'purchasing.payables');
  const data = PaymentSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const p = schema.payable;
    const [row] = await tx
      .update(p)
      .set({
        paidVnd: sql`${p.paidVnd} + ${data.amountVnd}`,
        status: sql`case when ${p.paidVnd} + ${data.amountVnd} >= ${p.amountVnd} then 'paid' else 'open' end`,
      })
      .where(and(eq(p.id, payableId), sql`${p.paidVnd} + ${data.amountVnd} <= ${p.amountVnd}`))
      .returning();
    if (!row) {
      const [cur] = await tx.select().from(p).where(eq(p.id, payableId));
      if (!cur) throw errors.notFound('Công nợ');
      throw errors.conflict('overpayment', `Số tiền vượt quá số còn nợ (${cur.amountVnd - cur.paidVnd} ₫).`);
    }
    await tx.insert(schema.payablePayment).values({
      payableId,
      amountVnd: data.amountVnd,
      method: data.method,
      paidAt: data.paidAt ? new Date(data.paidAt) : ctx.clock.now(),
      note: data.note ?? null,
      createdBy: actor.userId,
    });
    await audit.record(tx, ctx, { action: 'payable.payment', entity: 'payable', entityId: payableId, after: { amountVnd: data.amountVnd, balanceVnd: row.amountVnd - row.paidVnd } });
    return { balanceVnd: row.amountVnd - row.paidVnd, status: row.status };
  });
}

export * from './consignment.js';
