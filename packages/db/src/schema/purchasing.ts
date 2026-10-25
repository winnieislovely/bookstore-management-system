import { SUPPLIER_ORDER, statesOf } from '@bookstore/domain';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { itemVariant } from './catalog.js';
import { createdAt, id, inList, ts, updatedAt, version, vndCol } from './_common.js';

/** Purchasing, suppliers and consignment (TDD §4.3, §5.3 “Purchasing”). */
export const purchasing = pgSchema('purchasing');

/** FR-PUR-01 supplier types; “consignor” is the `is_consignor` flag. */
export const SUPPLIER_KINDS = ['publisher', 'distributor', 'vendor', 'individual'] as const;

export const supplier = purchasing.table(
  'supplier',
  {
    id: id(),
    name: text().notNull(),
    taxCode: text(),
    kind: text().notNull(),
    isConsignor: boolean().notNull().default(false),
    tracksPayables: boolean().notNull().default(false),
    termsDays: integer(),
    contacts: jsonb().notNull().default([]),
    /** Bank account, encrypted at column level (TDD §10.4). */
    bankEnc: text(),
    note: text(),
    status: text().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    uniqueIndex('supplier_tax_code_uq').on(t.taxCode).where(sql`${t.taxCode} is not null`),
    check('supplier_kind_ck', inList(t.kind, SUPPLIER_KINDS)),
  ],
);

export const supplierOrder = purchasing.table(
  'supplier_order',
  {
    id: id(),
    docNo: text().notNull().unique(),
    supplierId: uuid()
      .notNull()
      .references(() => supplier.id),
    status: text().notNull().default('draft'),
    expectedAt: ts(),
    note: text(),
    createdBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [check('supplier_order_status_ck', inList(t.status, statesOf(SUPPLIER_ORDER)))],
);

export const supplierOrderLine = purchasing.table(
  'supplier_order_line',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => supplierOrder.id),
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    qty: integer().notNull(),
    unitCostVnd: vndCol(),
    receivedQty: integer().notNull().default(0),
  },
  (t) => [index('supplier_order_line_order_idx').on(t.orderId), check('supplier_order_line_qty_ck', sql`${t.qty} > 0`)],
);

/** Quick stock-in entry: automatic entry number, no receipt document (FR-PUR-02..04, FR-PUR-14). */
export const stockInEntry = purchasing.table(
  'stock_in_entry',
  {
    id: id(),
    entryNo: text().notNull().unique(),
    supplierId: uuid().references(() => supplier.id),
    supplierInvoiceNo: text(),
    invoiceFileId: uuid(),
    consignment: boolean().notNull().default(false),
    note: text(),
    /** `manual` or `import` (bulk stock-in, FR-PUR-14). */
    source: text().notNull().default('manual'),
    importJobId: uuid(),
    totalCostVnd: vndCol().notNull().default(0),
    createdBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [index('stock_in_entry_supplier_idx').on(t.supplierId, t.createdAt)],
);

export const stockInLine = purchasing.table(
  'stock_in_line',
  {
    id: id(),
    entryId: uuid()
      .notNull()
      .references(() => stockInEntry.id),
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    qty: integer().notNull(),
    unitCostVnd: vndCol().notNull(),
    /** Selling price set by this stock-in when it changed (FR-PUR-03). */
    newPriceVnd: vndCol(),
    createdProduct: boolean().notNull().default(false),
    marginFlag: boolean().notNull().default(false),
    orderLineId: uuid().references(() => supplierOrderLine.id),
  },
  (t) => [
    index('stock_in_line_entry_idx').on(t.entryId),
    check('stock_in_line_qty_ck', sql`${t.qty} > 0`),
    check('stock_in_line_cost_ck', sql`${t.unitCostVnd} >= 0`),
  ],
);

export const payable = purchasing.table(
  'payable',
  {
    id: id(),
    supplierId: uuid()
      .notNull()
      .references(() => supplier.id),
    source: text().notNull(),
    sourceId: uuid().notNull(),
    amountVnd: vndCol().notNull(),
    paidVnd: vndCol().notNull().default(0),
    dueAt: ts(),
    status: text().notNull().default('open'),
    createdAt: createdAt(),
  },
  (t) => [
    index('payable_supplier_idx').on(t.supplierId, t.status),
    check('payable_source_ck', inList(t.source, ['stock_in', 'consignment'])),
    check('payable_status_ck', inList(t.status, ['open', 'paid'])),
    check('payable_amount_ck', sql`${t.amountVnd} >= 0 and ${t.paidVnd} >= 0 and ${t.paidVnd} <= ${t.amountVnd}`),
  ],
);

export const payablePayment = purchasing.table(
  'payable_payment',
  {
    id: id(),
    payableId: uuid()
      .notNull()
      .references(() => payable.id),
    amountVnd: vndCol().notNull(),
    paidAt: ts().notNull().defaultNow(),
    method: text().notNull(),
    note: text(),
    createdBy: uuid(),
  },
  (t) => [index('payable_payment_payable_idx').on(t.payableId), check('payable_payment_amount_ck', sql`${t.amountVnd} > 0`)],
);

/** One lot per variant per consignment stock-in; no payable until sold (FR-PUR-09). */
export const consignmentLot = purchasing.table(
  'consignment_lot',
  {
    id: id(),
    supplierId: uuid()
      .notNull()
      .references(() => supplier.id),
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    stockInLineId: uuid().references(() => stockInLine.id),
    qtyReceived: integer().notNull(),
    qtySold: integer().notNull().default(0),
    qtyReturned: integer().notNull().default(0),
    discountBp: integer().notNull().default(0),
    deadlineAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index('consignment_lot_variant_idx').on(t.variantId, t.createdAt),
    check('consignment_lot_qty_ck', sql`${t.qtySold} >= 0 and ${t.qtyReturned} >= 0 and ${t.qtySold} + ${t.qtyReturned} <= ${t.qtyReceived}`),
  ],
);

/** Sale lines allocated to lots FIFO (TDD §4.3). */
export const consignmentAllocation = purchasing.table(
  'consignment_allocation',
  {
    id: id(),
    lotId: uuid()
      .notNull()
      .references(() => consignmentLot.id),
    saleLineId: uuid().notNull(),
    qty: integer().notNull(),
    unitPriceVnd: vndCol().notNull(),
    at: createdAt(),
  },
  (t) => [uniqueIndex('consignment_allocation_uq').on(t.saleLineId, t.lotId), check('consignment_allocation_qty_ck', sql`${t.qty} <> 0`)],
);

export const consignmentStatement = purchasing.table(
  'consignment_statement',
  {
    id: id(),
    docNo: text().notNull().unique(),
    supplierId: uuid()
      .notNull()
      .references(() => supplier.id),
    /** `YYYY-MM` in store time (BR-11: monthly). */
    period: text().notNull(),
    lines: jsonb().notNull(),
    amountDueVnd: vndCol().notNull(),
    status: text().notNull().default('draft'),
    payableId: uuid().references(() => payable.id),
    approvedBy: uuid(),
    approvedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('consignment_statement_uq').on(t.supplierId, t.period),
    check('consignment_statement_status_ck', inList(t.status, ['draft', 'approved'])),
  ],
);

export const consignmentReturn = purchasing.table(
  'consignment_return',
  {
    id: id(),
    supplierId: uuid()
      .notNull()
      .references(() => supplier.id),
    lotId: uuid()
      .notNull()
      .references(() => consignmentLot.id),
    qty: integer().notNull(),
    note: text(),
    createdBy: uuid(),
    at: createdAt(),
  },
  (t) => [index('consignment_return_lot_idx').on(t.lotId), check('consignment_return_qty_ck', sql`${t.qty} > 0`)],
);
