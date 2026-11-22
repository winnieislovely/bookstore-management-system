import { ITEM_STATUSES } from '@bookstore/domain';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, id, inList, ts, updatedAt, version, vndCol, type I18n } from './_common.js';

/** Catalogue (TDD §4.1, §5.3 “Catalogue”). */
export const catalog = pgSchema('catalog');

export const ITEM_KINDS = ['book', 'stationery', 'other', 'bundle'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ItemText {
  title: string;
  subtitle?: string;
  description?: string;
  seoTitle?: string;
  seoDescription?: string;
}

export const publisher = catalog.table(
  'publisher',
  {
    id: id(),
    i18n: jsonb().$type<I18n<{ name: string }>>().notNull(),
    contact: jsonb(),
    status: text().notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('publisher_name_uq').on(sql`lower(public.f_unaccent(${t.i18n} -> 'en' ->> 'name'))`)],
);

export const brand = catalog.table(
  'brand',
  {
    id: id(),
    i18n: jsonb().$type<I18n<{ name: string }>>().notNull(),
    status: text().notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('brand_name_uq').on(sql`lower(public.f_unaccent(${t.i18n} -> 'en' ->> 'name'))`)],
);

/** Category tree of at least three levels (FR-CAT-06). */
export const category = catalog.table(
  'category',
  {
    id: id(),
    parentId: uuid().references((): AnyPgColumn => category.id),
    i18n: jsonb().$type<I18n<{ name: string; seoTitle?: string; seoDescription?: string }>>().notNull(),
    slug: text().notNull().unique(),
    sort: integer().notNull().default(0),
    status: text().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [index('category_parent_idx').on(t.parentId)],
);

export const item = catalog.table(
  'item',
  {
    id: id(),
    kind: text().$type<ItemKind>().notNull(),
    i18n: jsonb().$type<I18n<ItemText>>().notNull(),
    slug: text().notNull().unique(),
    authors: text().array().notNull().default(sql`'{}'::text[]`),
    translator: text(),
    publisherId: uuid().references(() => publisher.id),
    brandId: uuid().references(() => brand.id),
    model: text(),
    unit: text(),
    language: text(),
    publicationYear: integer(),
    edition: text(),
    pageCount: integer(),
    coverType: text(),
    series: text(),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    /** Upcoming titles can be pre-ordered (FR-CAT-15). */
    releaseDate: date({ mode: 'string' }),
    status: text().notNull().default('active'),
    /** lower(unaccent(title, authors, publisher, isbn, sku)), maintained by the catalogue service. */
    searchText: text().notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    check('item_kind_ck', inList(t.kind, ITEM_KINDS)),
    check('item_status_ck', inList(t.status, ITEM_STATUSES)),
    index('item_status_idx').on(t.status),
    index('item_search_trgm_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
);

export const WEB_STOCK_DISPLAY = ['exact', 'few_left', 'in_out', 'hidden'] as const;

export const itemVariant = catalog.table(
  'item_variant',
  {
    id: id(),
    itemId: uuid()
      .notNull()
      .references(() => item.id),
    sku: text().notNull(),
    isbn13: text(),
    /** Required, used for delivery fees (FR-CAT-04). */
    weightG: integer().notNull(),
    priceVnd: vndCol().notNull(),
    listPriceVnd: vndCol(),
    vatBp: integer().notNull().default(0),
    attributes: jsonb().notNull().default({}),
    status: text().notNull().default('active'),
    publishedPos: boolean().notNull().default(true),
    publishedWeb: boolean().notNull().default(false),
    /** A shelf from master data (kind `shelf`), to find the item; not a stock location (FR-CAT-01). */
    shelfCode: text(),
    webStockDisplay: text(),
    minStock: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    uniqueIndex('item_variant_sku_uq').on(t.sku),
    uniqueIndex('item_variant_isbn_uq').on(t.isbn13).where(sql`${t.isbn13} is not null`),
    index('item_variant_item_idx').on(t.itemId),
    check('item_variant_weight_ck', sql`${t.weightG} > 0`),
    check('item_variant_price_ck', sql`${t.priceVnd} >= 0`),
    check('item_variant_status_ck', inList(t.status, ITEM_STATUSES)),
    check('item_variant_stock_display_ck', sql`${t.webStockDisplay} is null or ${inList(t.webStockDisplay, WEB_STOCK_DISPLAY)}`),
  ],
);

export const barcode = catalog.table(
  'barcode',
  {
    id: id(),
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    code: text().notNull().unique(),
    /** `ean13`, `code128`, `internal` (generated for items without a barcode, FR-CAT-04). */
    kind: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('barcode_variant_idx').on(t.variantId)],
);

export const itemCategory = catalog.table(
  'item_category',
  {
    itemId: uuid()
      .notNull()
      .references(() => item.id, { onDelete: 'cascade' }),
    categoryId: uuid()
      .notNull()
      .references(() => category.id),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.categoryId] }), index('item_category_cat_idx').on(t.categoryId)],
);

/** Every price/VAT change, with effective dates (FR-CAT-07, FR-CAT-08). */
export const priceHistory = catalog.table(
  'price_history',
  {
    id: id(),
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    priceVnd: vndCol().notNull(),
    listPriceVnd: vndCol(),
    vatBp: integer().notNull(),
    effectiveFrom: ts().notNull().defaultNow(),
    effectiveTo: ts(),
    changedBy: uuid(),
    reason: text(),
  },
  (t) => [index('price_history_variant_idx').on(t.variantId, t.effectiveFrom.desc())],
);

export const bundleComponent = catalog.table(
  'bundle_component',
  {
    bundleVariantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    componentVariantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    qty: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.bundleVariantId, t.componentVariantId] }),
    check('bundle_component_qty_ck', sql`${t.qty} > 0`),
  ],
);

export const itemImage = catalog.table(
  'item_image',
  {
    id: id(),
    itemId: uuid()
      .notNull()
      .references(() => item.id, { onDelete: 'cascade' }),
    fileId: uuid().notNull(),
    sort: integer().notNull().default(0),
    alt: jsonb().$type<I18n<string>>(),
  },
  (t) => [index('item_image_item_idx').on(t.itemId, t.sort)],
);

/** Source of the POS catalogue delta cursor and tombstones (TDD §7.3). */
export const catalogChange = catalog.table(
  'catalog_change',
  {
    seq: bigserial({ mode: 'number' }).primaryKey(),
    entity: text().notNull(),
    entityId: uuid().notNull(),
    op: text().notNull(),
    at: createdAt(),
  },
  (t) => [check('catalog_change_op_ck', inList(t.op, ['upsert', 'delete']))],
);

export const IMPORT_KINDS = ['products', 'stock_in', 'customers', 'suppliers', 'library_copies', 'employees'] as const;
export const IMPORT_STATUSES = ['uploaded', 'validated', 'committed', 'rolled_back', 'failed'] as const;

/** Staged importer (FR-CAT-11, FR-PUR-14, FR-ADM-07). */
export const importJob = catalog.table(
  'import_job',
  {
    id: id(),
    kind: text().notNull(),
    fileId: uuid(),
    status: text().notNull().default('uploaded'),
    summary: jsonb().notNull().default({}),
    /** Rollback batch id: the documents created by the commit. */
    result: jsonb(),
    createdBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('import_job_kind_ck', inList(t.kind, IMPORT_KINDS)), check('import_job_status_ck', inList(t.status, IMPORT_STATUSES))],
);

export const importRow = catalog.table(
  'import_row',
  {
    id: id(),
    jobId: uuid()
      .notNull()
      .references(() => importJob.id, { onDelete: 'cascade' }),
    rowNo: integer().notNull(),
    payload: jsonb().notNull(),
    errors: jsonb().notNull().default([]),
    warnings: jsonb().notNull().default([]),
  },
  (t) => [uniqueIndex('import_row_job_row_uq').on(t.jobId, t.rowNo)],
);


/** Open Library answers kept for 7 days (FR-CAT-16, TDD §8.8): `q:<title>`, `isbn:<isbn13>`, `work:<id>`. */
export const bookLookupCache = catalog.table('book_lookup_cache', {
  key: text().primaryKey(),
  payload: jsonb().notNull(),
  fetchedAt: ts().notNull(),
});
