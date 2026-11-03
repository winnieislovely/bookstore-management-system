import { schema } from '@bookstore/db';
import { foldText, internalBarcode, normalizeIsbn, slugify, VAT_RATES_BP } from '@bookstore/domain';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as settings from '../settings/index.js';
import { availableSql } from './bundles.js';
import { AppError, can, emit, errors, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/**
 * Catalogue (FR-CAT-01..15, TDD §4.1). Items are titles/products; variants are the sellable units
 * with SKU, barcodes, price, VAT and weight. Every write refreshes `search_text`, records a
 * `catalog_change` (POS delta, TDD §7.3) and emits `item.changed`.
 */

const money = z.number().int().min(0);
const I18nText = <T extends z.ZodType>(t: T) => z.object({ en: t, vi: t.optional() });

/** English is required, including the description (FR-WEB-22); Vietnamese is optional. */
export const ItemTextSchema = z.object({
  title: z.string().trim().min(1, 'Cần nhập tên sản phẩm bằng tiếng Anh.').max(300),
  subtitle: z.string().trim().max(300).optional(),
  description: z.string().trim().min(1, 'Cần nhập mô tả bằng tiếng Anh.').max(20000),
  seoTitle: z.string().trim().max(120).optional(),
  seoDescription: z.string().trim().max(320).optional(),
});
const ItemTextViSchema = ItemTextSchema.partial().extend({ title: z.string().trim().max(300).optional() });

export const VariantSchema = z.object({
  /** The store's own code; required, never merged with ISBN (FR-CAT-11). */
  sku: z.string().trim().min(1).max(64),
  isbn: z.string().trim().optional(),
  barcodes: z.array(z.string().trim().min(4).max(64)).default([]),
  /** Generate an internal barcode when the variant has none (FR-CAT-04). */
  generateBarcode: z.boolean().default(true),
  weightG: z.number().int().positive('Khối lượng (gram) phải lớn hơn 0.'),
  priceVnd: money,
  listPriceVnd: money.optional(),
  vatBp: z.number().int().refine((v) => (VAT_RATES_BP as readonly number[]).includes(v), 'Thuế suất không hợp lệ.'),
  attributes: z.record(z.string(), z.string()).default({}),
  publishedPos: z.boolean().default(true),
  publishedWeb: z.boolean().default(false),
  webStockDisplay: z.enum(['exact', 'few_left', 'in_out', 'hidden']).nullable().default(null),
  minStock: z.number().int().min(0).nullable().default(null),
});
export type VariantInput = z.input<typeof VariantSchema>;

export const ItemSchema = z.object({
  kind: z.enum(['book', 'stationery', 'other', 'bundle']),
  i18n: z.object({ en: ItemTextSchema, vi: ItemTextViSchema.optional() }),
  slug: z.string().trim().max(120).optional(),
  authors: z.array(z.string().trim().min(1)).default([]),
  translator: z.string().trim().optional(),
  publisherId: z.uuid().nullable().optional(),
  brandId: z.uuid().nullable().optional(),
  model: z.string().trim().optional(),
  unit: z.string().trim().optional(),
  language: z.string().trim().optional(),
  publicationYear: z.number().int().min(1400).max(2200).optional(),
  edition: z.string().trim().optional(),
  pageCount: z.number().int().positive().optional(),
  coverType: z.string().trim().optional(),
  series: z.string().trim().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  releaseDate: z.iso.date().nullable().optional(),
  categoryIds: z.array(z.uuid()).min(1, 'Chọn ít nhất một danh mục.'),
  status: z.enum(['active', 'hidden', 'discontinued']).default('active'),
  variants: z.array(VariantSchema).min(1),
});
export type ItemInput = z.input<typeof ItemSchema>;

// ---------------------------------------------------------------------------------------------
// Internal helpers

/** Refresh search text, record the POS delta and emit `item.changed` (TDD §4.1, §7.3, §9.2). */
async function touchItem(tx: Tx, itemId: string): Promise<void> {
  await tx.execute(sql`select catalog.refresh_search_text(${itemId}::uuid)`);
  await tx.insert(schema.catalogChange).values({ entity: 'item', entityId: itemId, op: 'upsert' });
  await emit(tx, 'item.changed', { itemId });
}

async function uniqueSlug(tx: Tx, base: string, exceptItemId?: string): Promise<string> {
  const root = slugify(base) || 'san-pham';
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const [row] = await tx.select({ id: schema.item.id }).from(schema.item).where(eq(schema.item.slug, candidate));
    if (!row || row.id === exceptItemId) return candidate;
  }
}

interface Duplicate {
  field: 'sku' | 'isbn' | 'barcode';
  value: string;
  itemTitle: string;
}

/**
 * Duplicate detection on SKU, ISBN and barcode when an item is created, imported or edited
 * (FR-CAT-05). SKU and barcode must always be unique; ISBN follows `catalog.duplicate_mode`
 * (default block).
 */
export async function findDuplicates(
  tx: Tx,
  values: { skus: string[]; isbns: string[]; barcodes: string[] },
  exceptVariantIds: string[] = [],
): Promise<Duplicate[]> {
  const found: Duplicate[] = [];
  const v = schema.itemVariant;
  const titleOf = sql<string>`${schema.item.i18n} -> 'en' ->> 'title'`;
  const notSelf = exceptVariantIds.length ? sql`${v.id} not in (${sql.join(exceptVariantIds.map((id) => sql`${id}::uuid`), sql`, `)})` : undefined;
  if (values.skus.length) {
    const rows = await tx.select({ value: v.sku, itemTitle: titleOf }).from(v).innerJoin(schema.item, eq(schema.item.id, v.itemId)).where(and(inArray(v.sku, values.skus), notSelf));
    found.push(...rows.map((r) => ({ field: 'sku' as const, ...r })));
  }
  if (values.isbns.length) {
    const rows = await tx
      .select({ value: sql<string>`${v.isbn13}`, itemTitle: titleOf })
      .from(v)
      .innerJoin(schema.item, eq(schema.item.id, v.itemId))
      .where(and(inArray(v.isbn13, values.isbns), notSelf));
    found.push(...rows.map((r) => ({ field: 'isbn' as const, ...r })));
  }
  if (values.barcodes.length) {
    const b = schema.barcode;
    const rows = await tx
      .select({ value: b.code, itemTitle: titleOf })
      .from(b)
      .innerJoin(v, eq(v.id, b.variantId))
      .innerJoin(schema.item, eq(schema.item.id, v.itemId))
      .where(and(inArray(b.code, values.barcodes), notSelf));
    found.push(...rows.map((r) => ({ field: 'barcode' as const, ...r })));
  }
  return found;
}

function duplicateError(d: Duplicate): AppError {
  const label = d.field === 'sku' ? 'Mã SKU' : d.field === 'isbn' ? 'ISBN' : 'Mã vạch';
  return errors.conflict(
    `duplicate_${d.field}`,
    `Không thể lưu sản phẩm. ${label} '${d.value}' đã được dùng cho '${d.itemTitle}'. Hãy đổi mã hoặc mở sản phẩm đã có.`,
    d,
  );
}

function normaliseVariant(v: z.infer<typeof VariantSchema>) {
  let isbn13: string | null = null;
  if (v.isbn) {
    isbn13 = normalizeIsbn(v.isbn);
    if (!isbn13) throw new AppError(400, 'invalid_isbn', `ISBN '${v.isbn}' không hợp lệ. Hãy kiểm tra lại 10 hoặc 13 chữ số.`);
  }
  return { ...v, isbn13 };
}

async function insertVariant(tx: Tx, ctx: Ctx, itemId: string, v: ReturnType<typeof normaliseVariant>) {
  const [row] = await tx
    .insert(schema.itemVariant)
    .values({
      itemId,
      sku: v.sku,
      isbn13: v.isbn13,
      weightG: v.weightG,
      priceVnd: v.priceVnd,
      listPriceVnd: v.listPriceVnd ?? null,
      vatBp: v.vatBp,
      attributes: v.attributes,
      publishedPos: v.publishedPos,
      publishedWeb: v.publishedWeb,
      webStockDisplay: v.webStockDisplay,
      minStock: v.minStock,
    })
    .returning();
  const codes = [...new Set(v.barcodes)];
  if (v.isbn13 && !codes.includes(v.isbn13)) codes.push(v.isbn13); // books scan by their ISBN-13/EAN
  if (codes.length === 0 && v.generateBarcode) {
    const [seq] = await tx.execute<{ n: string }>(sql`select nextval('catalog.internal_barcode_seq')::text as n`);
    codes.push(internalBarcode(Number(seq!.n)));
  }
  for (const code of codes) {
    const generated = !v.barcodes.includes(code) && code !== v.isbn13;
    await tx.insert(schema.barcode).values({ variantId: row!.id, code, kind: generated ? 'internal' : /^\d{13}$/.test(code) ? 'ean13' : 'code128' });
  }
  await tx.insert(schema.priceHistory).values({
    variantId: row!.id,
    priceVnd: v.priceVnd,
    listPriceVnd: v.listPriceVnd ?? null,
    vatBp: v.vatBp,
    effectiveFrom: ctx.clock.now(),
    changedBy: ctx.actor?.userId ?? null,
    reason: 'create',
  });
  return row!;
}

// ---------------------------------------------------------------------------------------------
// Items

/** Create an item with its variants. Exported for quick stock-in, which runs it in its own transaction. */
export async function createItemTx(tx: Tx, ctx: Ctx, input: ItemInput): Promise<{ itemId: string; variantIds: string[] }> {
  const data = ItemSchema.parse(input);
  const variants = data.variants.map(normaliseVariant);
  const cfg = await settings.snapshot(ctx, tx);
  const dupes = await findDuplicates(tx, {
    skus: variants.map((v) => v.sku),
    isbns: variants.flatMap((v) => (v.isbn13 ? [v.isbn13] : [])),
    barcodes: variants.flatMap((v) => v.barcodes),
  });
  const blocking = dupes.filter((d) => d.field !== 'isbn' || cfg['catalog.duplicate_mode'] === 'block');
  if (blocking[0]) throw duplicateError(blocking[0]);

  const [item] = await tx
    .insert(schema.item)
    .values({
      kind: data.kind,
      i18n: data.i18n as never,
      slug: await uniqueSlug(tx, data.slug || data.i18n.en.title),
      authors: data.authors,
      translator: data.translator ?? null,
      publisherId: data.publisherId ?? null,
      brandId: data.brandId ?? null,
      model: data.model ?? null,
      unit: data.unit ?? null,
      language: data.language ?? null,
      publicationYear: data.publicationYear ?? null,
      edition: data.edition ?? null,
      pageCount: data.pageCount ?? null,
      coverType: data.coverType ?? null,
      series: data.series ?? null,
      tags: data.tags,
      releaseDate: data.releaseDate ?? null,
      status: data.status,
    })
    .returning({ id: schema.item.id });
  await tx.insert(schema.itemCategory).values([...new Set(data.categoryIds)].map((categoryId) => ({ itemId: item!.id, categoryId })));
  const variantIds: string[] = [];
  for (const v of variants) variantIds.push((await insertVariant(tx, ctx, item!.id, v)).id);
  await touchItem(tx, item!.id);
  await audit.record(tx, ctx, {
    action: 'item.create',
    entity: 'item',
    entityId: item!.id,
    after: { title: data.i18n.en.title, variants: variants.map((v) => ({ sku: v.sku, priceVnd: v.priceVnd, vatBp: v.vatBp })) },
  });
  return { itemId: item!.id, variantIds };
}

export async function createItem(ctx: Ctx, input: ItemInput) {
  requirePermission(ctx, 'catalog.edit');
  return ctx.db.transaction((tx) => createItemTx(tx, ctx, input));
}

export const ItemUpdateSchema = ItemSchema.omit({ variants: true }).partial().extend({ version: z.number().int() });

export async function updateItem(ctx: Ctx, id: string, input: z.input<typeof ItemUpdateSchema>) {
  requirePermission(ctx, 'catalog.edit');
  const data = ItemUpdateSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.item).where(eq(schema.item.id, id));
    if (!before) throw errors.notFound('Sản phẩm');
    if (before.version !== data.version) throw errors.stale();
    const { categoryIds, version, slug, ...fields } = data;
    const [after] = await tx
      .update(schema.item)
      .set({
        ...(fields as Record<string, unknown>),
        ...(slug !== undefined && { slug: await uniqueSlug(tx, slug, id) }),
        version: before.version + 1,
        updatedAt: ctx.clock.now(),
      })
      .where(and(eq(schema.item.id, id), eq(schema.item.version, version)))
      .returning();
    if (!after) throw errors.stale();
    if (categoryIds) {
      await tx.delete(schema.itemCategory).where(eq(schema.itemCategory.itemId, id));
      await tx.insert(schema.itemCategory).values([...new Set(categoryIds)].map((categoryId) => ({ itemId: id, categoryId })));
    }
    await touchItem(tx, id);
    await audit.record(tx, ctx, { action: 'item.update', entity: 'item', entityId: id, before: { status: before.status, i18n: before.i18n }, after: { status: after.status, i18n: after.i18n } });
    return { id, version: after.version };
  });
}

export async function addVariant(ctx: Ctx, itemId: string, input: VariantInput) {
  requirePermission(ctx, 'catalog.edit');
  const v = normaliseVariant(VariantSchema.parse(input));
  return ctx.db.transaction(async (tx) => {
    const [item] = await tx.select({ id: schema.item.id }).from(schema.item).where(eq(schema.item.id, itemId));
    if (!item) throw errors.notFound('Sản phẩm');
    const cfg = await settings.snapshot(ctx, tx);
    const dupes = await findDuplicates(tx, { skus: [v.sku], isbns: v.isbn13 ? [v.isbn13] : [], barcodes: v.barcodes });
    const blocking = dupes.filter((d) => d.field !== 'isbn' || cfg['catalog.duplicate_mode'] === 'block');
    if (blocking[0]) throw duplicateError(blocking[0]);
    const row = await insertVariant(tx, ctx, itemId, v);
    await touchItem(tx, itemId);
    await audit.record(tx, ctx, { action: 'variant.create', entity: 'item_variant', entityId: row.id, after: { sku: v.sku, priceVnd: v.priceVnd } });
    return { variantId: row.id };
  });
}

export const VariantUpdateSchema = z.object({
  version: z.number().int(),
  weightG: z.number().int().positive().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
  status: z.enum(['active', 'hidden', 'discontinued']).optional(),
  publishedPos: z.boolean().optional(),
  publishedWeb: z.boolean().optional(),
  webStockDisplay: z.enum(['exact', 'few_left', 'in_out', 'hidden']).nullable().optional(),
  minStock: z.number().int().min(0).nullable().optional(),
  addBarcodes: z.array(z.string().trim().min(4).max(64)).optional(),
});

export async function updateVariant(ctx: Ctx, variantId: string, input: z.input<typeof VariantUpdateSchema>) {
  requirePermission(ctx, 'catalog.edit');
  const data = VariantUpdateSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.itemVariant).where(eq(schema.itemVariant.id, variantId));
    if (!before) throw errors.notFound('Biến thể');
    if (before.version !== data.version) throw errors.stale();
    if (data.addBarcodes?.length) {
      const dupes = await findDuplicates(tx, { skus: [], isbns: [], barcodes: data.addBarcodes });
      if (dupes[0]) throw duplicateError(dupes[0]);
    }
    const { version, addBarcodes, ...fields } = data;
    const [after] = await tx
      .update(schema.itemVariant)
      .set({ ...(fields as Record<string, unknown>), version: before.version + 1, updatedAt: ctx.clock.now() })
      .where(and(eq(schema.itemVariant.id, variantId), eq(schema.itemVariant.version, version)))
      .returning();
    if (!after) throw errors.stale();
    for (const code of addBarcodes ?? []) await tx.insert(schema.barcode).values({ variantId, code, kind: /^\d{13}$/.test(code) ? 'ean13' : 'code128' });
    await touchItem(tx, before.itemId);
    await audit.record(tx, ctx, { action: 'variant.update', entity: 'item_variant', entityId: variantId, before: fields && pick(before, Object.keys(fields)), after: pick(after, Object.keys(fields)) });
    return { id: variantId, version: after.version };
  });
}

function pick(row: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, row[k]]));
}

export const PriceChangeSchema = z.object({
  priceVnd: money,
  listPriceVnd: money.nullable().optional(),
  vatBp: z.number().int().refine((v) => (VAT_RATES_BP as readonly number[]).includes(v), 'Thuế suất không hợp lệ.').optional(),
  reason: z.string().trim().max(200).optional(),
});

/**
 * Change price/VAT: updates the variant, closes the current price-history row and opens a new one,
 * and writes an audit entry (FR-CAT-07, FR-CAT-08). Used by staff edits and by stock-in (FR-PUR-03).
 */
export async function setPriceTx(tx: Tx, ctx: Ctx, variantId: string, input: z.input<typeof PriceChangeSchema>): Promise<boolean> {
  const data = PriceChangeSchema.parse(input);
  const [before] = await tx.select().from(schema.itemVariant).where(eq(schema.itemVariant.id, variantId)).for('update');
  if (!before) throw errors.notFound('Biến thể');
  const vatBp = data.vatBp ?? before.vatBp;
  const listPriceVnd = data.listPriceVnd === undefined ? before.listPriceVnd : data.listPriceVnd;
  if (before.priceVnd === data.priceVnd && before.vatBp === vatBp && before.listPriceVnd === listPriceVnd) return false;
  const now = ctx.clock.now();
  await tx
    .update(schema.itemVariant)
    .set({ priceVnd: data.priceVnd, vatBp, listPriceVnd, version: before.version + 1, updatedAt: now })
    .where(eq(schema.itemVariant.id, variantId));
  await tx
    .update(schema.priceHistory)
    .set({ effectiveTo: now })
    .where(and(eq(schema.priceHistory.variantId, variantId), sql`${schema.priceHistory.effectiveTo} is null`));
  await tx.insert(schema.priceHistory).values({
    variantId,
    priceVnd: data.priceVnd,
    listPriceVnd,
    vatBp,
    effectiveFrom: now,
    changedBy: ctx.actor?.userId ?? null,
    reason: data.reason ?? null,
  });
  await audit.record(tx, ctx, {
    action: 'price.change',
    entity: 'item_variant',
    entityId: variantId,
    before: { priceVnd: before.priceVnd, listPriceVnd: before.listPriceVnd, vatBp: before.vatBp },
    after: { priceVnd: data.priceVnd, listPriceVnd, vatBp, reason: data.reason ?? null },
  });
  await touchItem(tx, before.itemId);
  return true;
}

export async function setPrice(ctx: Ctx, variantId: string, input: z.input<typeof PriceChangeSchema>) {
  requirePermission(ctx, 'catalog.edit');
  await ctx.db.transaction((tx) => setPriceTx(tx, ctx, variantId, input));
}

// ---------------------------------------------------------------------------------------------
// Reads

/** `a,b` (or an already-split list) → list; OR within a filter (TDD §6.2). */
const csvField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (Array.isArray(v) ? v : v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined));
const csvEnum = <T extends string>(values: readonly [T, ...T[]]) => csvField.pipe(z.array(z.enum(values)).min(1).optional());

export const ListQuery = z.object({
  q: z.string().trim().max(200).optional(),
  kind: csvEnum(['book', 'stationery', 'other', 'bundle']),
  /** Categories include their descendants. */
  category: csvField.pipe(z.array(z.uuid()).min(1).optional()),
  status: csvEnum(['active', 'hidden', 'discontinued']),
  /** Stock states of the product list filter (Design §12.1). */
  stock: csvEnum(['in_stock', 'low', 'out']),
  /** Latest stock movement within [changedFrom, changedTo] (Stock list filter, Design §12.1). */
  changedFrom: z.iso.datetime().optional(),
  changedTo: z.iso.datetime().optional(),
  /** Slow movers: in stock, no sale in this many days, never-sold included (FR-INV-10). */
  unsoldDays: z.coerce.number().pipe(z.union([z.literal(30), z.literal(60), z.literal(90)])).optional(),
  /** “Thiếu ảnh”: products without a photo, typically imported (FR-CAT-11). */
  image: z.enum(['missing']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(40),
});

/** Product list: SKU is the only code shown (FR-CAT-11, Design §12.1). */
export async function listItems(ctx: Ctx, input: z.input<typeof ListQuery>) {
  requirePermission(ctx, 'catalog.view');
  const q = ListQuery.parse(input);
  const i = schema.item;
  const v = schema.itemVariant;
  const where: SQL[] = [];
  if (q.q) where.push(sql`${i.searchText} like ${`%${foldText(q.q)}%`}`);
  if (q.status) where.push(inArray(i.status, q.status));
  if (q.kind) where.push(inArray(i.kind, q.kind));
  if (q.category) {
    const roots = sql.join(q.category.map((c) => sql`${c}::uuid`), sql`, `);
    where.push(sql`exists (
      with recursive tree as (select id from catalog.category where id in (${roots})
        union all select c.id from catalog.category c join tree on c.parent_id = tree.id)
      select 1 from catalog.item_category ic where ic.item_id = ${v.itemId} and ic.category_id in (select id from tree))`);
  }
  // Bundles show what their components allow (TDD §4.1).
  const avail = sql<number>`${availableSql(sql`${v.id}`)}`;
  if (q.stock) {
    const states = { out: sql`${avail} <= 0`, low: sql`(${avail} > 0 and ${v.minStock} is not null and ${avail} <= ${v.minStock})`, in_stock: sql`${avail} > 0` };
    where.push(sql`(${sql.join(q.stock.map((x) => states[x]), sql` or `)})`);
  }
  if (q.changedFrom || q.changedTo) {
    const last = sql`(select max(m.at) from inventory.stock_movement m where m.variant_id = ${v.id})`;
    if (q.changedFrom) where.push(sql`${last} >= ${q.changedFrom}::timestamptz`);
    if (q.changedTo) where.push(sql`${last} <= ${q.changedTo}::timestamptz`);
  }
  if (q.unsoldDays) {
    const since = new Date(ctx.clock.now().getTime() - q.unsoldDays * 86_400_000);
    where.push(sql`exists (select 1 from inventory.stock_level s where s.variant_id = ${v.id} group by s.variant_id
      having sum(s.on_hand) > 0 and (max(s.last_sale_at) is null or max(s.last_sale_at) < ${since.toISOString()}::timestamptz))`);
  }
  if (q.image === 'missing') where.push(sql`not exists (select 1 from catalog.item_image im where im.item_id = ${i.id})`);
  const filter = where.length ? and(...where) : undefined;

  const rows = await ctx.db
    .select({
      variantId: v.id,
      itemId: i.id,
      kind: i.kind,
      title: sql<string>`${i.i18n} -> 'en' ->> 'title'`,
      titleVi: sql<string | null>`${i.i18n} -> 'vi' ->> 'title'`,
      authors: i.authors,
      sku: v.sku,
      priceVnd: v.priceVnd,
      available: avail,
      /** On hand (bundles: what their components allow, they hold no stock of their own). */
      onHand: sql<number>`(case when ${i.kind} = 'bundle' then ${avail} else coalesce((select sum(s.on_hand) from inventory.stock_level s where s.variant_id = ${v.id}), 0)::int end)`,
      avgCostVnd: sql<number | null>`(select coalesce(max(s.avg_cost_vnd) filter (where s.location = 'floor'), max(s.avg_cost_vnd)) from inventory.stock_level s where s.variant_id = ${v.id})`,
      updatedAt: sql<string>`greatest(${i.updatedAt}, ${v.updatedAt})`,
      /** Latest stock movement, for the Stock list (Design §12.1). */
      lastMovementAt: sql<string | null>`(select max(m.at) from inventory.stock_movement m where m.variant_id = ${v.id})`,
      minStock: v.minStock,
      status: i.status,
      releaseDate: i.releaseDate,
      imageFileId: sql<string | null>`(select im.file_id from catalog.item_image im where im.item_id = ${i.id} order by im.sort limit 1)`,
      missingImage: sql<boolean>`not exists (select 1 from catalog.item_image im where im.item_id = ${i.id})`,
    })
    .from(v)
    .innerJoin(i, eq(i.id, v.itemId))
    .where(filter)
    .orderBy(q.q ? sql`similarity(${i.searchText}, ${foldText(q.q)}) desc` : desc(i.createdAt), asc(v.sku))
    .limit(q.limit)
    .offset((q.page - 1) * q.limit);
  const [total] = await ctx.db.select({ n: count() }).from(v).innerJoin(i, eq(i.id, v.itemId)).where(filter);
  // Cost is shown only with permission (FR-CAT-07, TDD §10.3).
  const showCost = can(ctx.actor, 'catalog.view_cost');
  const items = rows.map(({ avgCostVnd, updatedAt, lastMovementAt, ...r }) => ({
    ...r,
    updatedAt: new Date(updatedAt).toISOString(),
    lastMovementAt: lastMovementAt ? new Date(lastMovementAt).toISOString() : null,
    ...(showCost && { avgCostVnd: avgCostVnd == null ? null : Number(avgCostVnd) }),
  }));
  return { items, total: total?.n ?? 0, page: q.page, limit: q.limit };
}

/** Exact lookup by barcode, SKU or ISBN for scanning (FR-POS-01, NFR-PERF-01). */
export async function lookupCode(ctx: Ctx, code: string) {
  requirePermission(ctx, 'catalog.view');
  const c = code.trim();
  const isbn = normalizeIsbn(c);
  const v = schema.itemVariant;
  const [row] = await ctx.db
    .select({ variantId: v.id })
    .from(v)
    .where(
      sql`${v.sku} = ${c} or ${v.isbn13} = ${isbn ?? c} or exists (select 1 from catalog.barcode b where b.variant_id = ${v.id} and b.code = ${c})`,
    )
    .limit(1);
  if (!row) throw new AppError(404, 'code_not_found', `Không tìm thấy mã ${c}. Thử tìm theo tên sản phẩm.`);
  return row;
}

/** Product detail (FR-CAT-14): cost and margin only with `catalog.view_cost` (TDD §10.3). */
export async function getItem(ctx: Ctx, id: string) {
  requirePermission(ctx, 'catalog.view');
  const [item] = await ctx.db.select().from(schema.item).where(eq(schema.item.id, id));
  if (!item) throw errors.notFound('Sản phẩm');
  const showCost = can(ctx.actor, 'catalog.view_cost');
  const variants = await ctx.db.select().from(schema.itemVariant).where(eq(schema.itemVariant.itemId, id)).orderBy(asc(schema.itemVariant.sku));
  const variantIds = variants.map((v) => v.id);
  const barcodes = variantIds.length ? await ctx.db.select().from(schema.barcode).where(inArray(schema.barcode.variantId, variantIds)) : [];
  const levels = variantIds.length ? await ctx.db.select().from(schema.stockLevel).where(inArray(schema.stockLevel.variantId, variantIds)) : [];
  const categories = await ctx.db
    .select({ id: schema.category.id, i18n: schema.category.i18n })
    .from(schema.itemCategory)
    .innerJoin(schema.category, eq(schema.category.id, schema.itemCategory.categoryId))
    .where(eq(schema.itemCategory.itemId, id));
  const images = await ctx.db.select().from(schema.itemImage).where(eq(schema.itemImage.itemId, id)).orderBy(asc(schema.itemImage.sort));
  // Bundle contents (FR-CAT-12).
  const components =
    item.kind === 'bundle' && variantIds.length
      ? await ctx.db
          .select({ bundleVariantId: schema.bundleComponent.bundleVariantId, variantId: schema.bundleComponent.componentVariantId, qty: schema.bundleComponent.qty, sku: schema.itemVariant.sku, title: sql<string>`${schema.item.i18n} -> 'en' ->> 'title'` })
          .from(schema.bundleComponent)
          .innerJoin(schema.itemVariant, eq(schema.itemVariant.id, schema.bundleComponent.componentVariantId))
          .innerJoin(schema.item, eq(schema.item.id, schema.itemVariant.itemId))
          .where(inArray(schema.bundleComponent.bundleVariantId, variantIds))
      : [];
  return {
    ...item,
    categories,
    images,
    components,
    variants: variants.map((v) => {
      const ls = levels.filter((l) => l.variantId === v.id);
      const onHand = ls.reduce((a, l) => a + l.onHand, 0);
      const reserved = ls.reduce((a, l) => a + l.reserved, 0);
      const avgCost = ls.find((l) => l.location === 'floor')?.avgCostVnd ?? ls[0]?.avgCostVnd ?? 0;
      return {
        ...v,
        barcodes: barcodes.filter((b) => b.variantId === v.id).map((b) => ({ code: b.code, kind: b.kind })),
        stock: { onHand, reserved, available: onHand - reserved, byLocation: ls.map((l) => ({ location: l.location, onHand: l.onHand, reserved: l.reserved })) },
        ...(showCost && { avgCostVnd: avgCost, marginVnd: v.priceVnd - avgCost }),
      };
    }),
  };
}

export async function priceHistory(ctx: Ctx, variantId: string) {
  requirePermission(ctx, 'catalog.view');
  return ctx.db.select().from(schema.priceHistory).where(eq(schema.priceHistory.variantId, variantId)).orderBy(desc(schema.priceHistory.effectiveFrom), desc(schema.priceHistory.id));
}

// ---------------------------------------------------------------------------------------------
// Categories, publishers, brands (FR-CAT-06)

export const CategorySchema = z.object({
  parentId: z.uuid().nullable().default(null),
  i18n: I18nText(z.object({ name: z.string().trim().min(1), seoTitle: z.string().optional(), seoDescription: z.string().optional() })),
  slug: z.string().trim().max(120).optional(),
  sort: z.number().int().default(0),
});

export async function createCategory(ctx: Ctx, input: z.input<typeof CategorySchema>) {
  requirePermission(ctx, 'catalog.edit');
  const data = CategorySchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const slug = slugify(data.slug || data.i18n.en.name);
    const [dupe] = await tx.select({ id: schema.category.id }).from(schema.category).where(eq(schema.category.slug, slug));
    if (dupe) throw errors.conflict('duplicate_slug', `Đường dẫn '${slug}' đã được dùng cho danh mục khác.`);
    const [row] = await tx.insert(schema.category).values({ parentId: data.parentId, i18n: data.i18n as never, slug, sort: data.sort }).returning({ id: schema.category.id });
    await audit.record(tx, ctx, { action: 'category.create', entity: 'category', entityId: row!.id, after: data });
    return { id: row!.id, slug };
  });
}

/** Active categories; `kinds` = item kinds filed directly under each, for the product list filter (Design §12.1). */
export async function listCategories(ctx: Ctx) {
  requirePermission(ctx, 'catalog.view');
  const c = schema.category;
  return ctx.db
    .select({
      id: c.id,
      parentId: c.parentId,
      i18n: c.i18n,
      slug: c.slug,
      sort: c.sort,
      status: c.status,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      version: c.version,
      kinds: sql<string[]>`coalesce((select array_agg(distinct i.kind) from catalog.item_category ic join catalog.item i on i.id = ic.item_id where ic.category_id = "category"."id"), '{}')`,
    })
    .from(c)
    .where(eq(c.status, 'active'))
    .orderBy(asc(c.sort), asc(c.slug));
}

export const NamedSchema = z.object({ i18n: I18nText(z.object({ name: z.string().trim().min(1) })) });

export async function createPublisher(ctx: Ctx, input: z.input<typeof NamedSchema>) {
  requirePermission(ctx, 'catalog.edit');
  const data = NamedSchema.parse(input);
  try {
    const [row] = await ctx.db.insert(schema.publisher).values({ i18n: data.i18n as never }).returning({ id: schema.publisher.id });
    return { id: row!.id };
  } catch (e) {
    if (String((e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code) === '23505') {
      throw errors.conflict('duplicate_publisher', `Nhà xuất bản '${data.i18n.en.name}' đã có trong danh sách.`);
    }
    throw e;
  }
}

export async function listPublishers(ctx: Ctx) {
  requirePermission(ctx, 'catalog.view');
  return ctx.db.select().from(schema.publisher).where(eq(schema.publisher.status, 'active'));
}

export async function createBrand(ctx: Ctx, input: z.input<typeof NamedSchema>) {
  requirePermission(ctx, 'catalog.edit');
  const data = NamedSchema.parse(input);
  const [row] = await ctx.db.insert(schema.brand).values({ i18n: data.i18n as never }).returning({ id: schema.brand.id });
  return { id: row!.id };
}

export async function listBrands(ctx: Ctx) {
  requirePermission(ctx, 'catalog.view');
  return ctx.db.select().from(schema.brand).where(eq(schema.brand.status, 'active'));
}

// ---------------------------------------------------------------------------------------------
// Product photos (FR-CAT-10); the first photo clears the “missing image” flag (FR-CAT-11)

export const ImageSchema = z.object({
  fileId: z.uuid(),
  alt: z.object({ en: z.string().trim().min(1, 'Cần mô tả ảnh (alt) bằng tiếng Anh.'), vi: z.string().trim().optional() }).optional(),
});

export async function addImage(ctx: Ctx, itemId: string, input: z.input<typeof ImageSchema>) {
  requirePermission(ctx, 'catalog.edit');
  const data = ImageSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [item] = await tx.select({ id: schema.item.id }).from(schema.item).where(eq(schema.item.id, itemId));
    if (!item) throw errors.notFound('Sản phẩm');
    const [file] = await tx.select().from(schema.file).where(eq(schema.file.id, data.fileId));
    if (!file?.mime.startsWith('image/')) throw new AppError(400, 'not_an_image', 'Tệp này không phải ảnh.');
    const [{ next } = { next: 0 }] = await tx.execute<{ next: number }>(
      sql`select coalesce(max(sort) + 1, 0)::int as next from catalog.item_image where item_id = ${itemId}::uuid`,
    );
    const [row] = await tx.insert(schema.itemImage).values({ itemId, fileId: data.fileId, sort: next, alt: (data.alt ?? null) as never }).returning({ id: schema.itemImage.id });
    await touchItem(tx, itemId);
    return { id: row!.id, sort: next };
  });
}

export async function removeImage(ctx: Ctx, itemId: string, imageId: string) {
  requirePermission(ctx, 'catalog.edit');
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx.delete(schema.itemImage).where(and(eq(schema.itemImage.id, imageId), eq(schema.itemImage.itemId, itemId))).returning({ id: schema.itemImage.id });
    if (!row) throw errors.notFound('Ảnh');
    await touchItem(tx, itemId);
  });
}

export * from './labels.js';
export * from './bundles.js';
