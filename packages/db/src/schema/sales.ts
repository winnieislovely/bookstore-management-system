import { EINVOICE, SALE_STATUSES, statesOf } from '@bookstore/domain';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgSchema, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { itemVariant } from './catalog.js';
import { customer } from './crm.js';
import { appUser } from './platform.js';
import { createdAt, id, inList, ts, vndCol } from './_common.js';

/** Point of sale and shifts (TDD §4.4, §5.3 “Sales”). */
export const sales = pgSchema('sales');

export const register = sales.table('register', {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  active: boolean().notNull().default(true),
  createdAt: createdAt(),
});

/** Registered POS devices with their own offline series (TDD §7.2). */
export const posDevice = sales.table('pos_device', {
  id: id(),
  registerId: uuid()
    .notNull()
    .references(() => register.id),
  deviceCode: text().notNull().unique(),
  publicKey: text().notNull(),
  revokedAt: ts(),
  lastSeenAt: ts(),
  leaseExpiresAt: ts(),
  /** The signed-in user at the latest device request, to revoke the phones of a departing employee (FR-ADM-04). */
  lastUserId: uuid().references(() => appUser.id),
  createdAt: createdAt(),
});

export const shift = sales.table(
  'shift',
  {
    id: id(),
    shiftNo: integer().notNull(),
    registerId: uuid()
      .notNull()
      .references(() => register.id),
    openedBy: uuid()
      .notNull()
      .references(() => appUser.id),
    openedAt: ts().notNull().defaultNow(),
    floatVnd: vndCol().notNull(),
    closedBy: uuid().references(() => appUser.id),
    closedAt: ts(),
    countedVnd: vndCol(),
    denominations: jsonb(),
    expectedVnd: vndCol(),
    varianceVnd: vndCol(),
    varianceReason: text(),
    /** Shifts opened offline: the device and its client id (TDD §7.2). */
    deviceId: uuid().references(() => posDevice.id),
    clientId: uuid(),
  },
  (t) => [
    uniqueIndex('shift_one_open_per_register_uq').on(t.registerId).where(sql`${t.closedAt} is null`),
    uniqueIndex('shift_no_uq').on(t.shiftNo),
    uniqueIndex('shift_device_client_uq').on(t.deviceId, t.clientId).where(sql`${t.clientId} is not null`),
    check('shift_float_ck', sql`${t.floatVnd} >= 0`),
    // BR-06: a closed shift with a non-zero variance must carry a reason.
    check(
      'shift_variance_reason_ck',
      sql`${t.closedAt} is null or ${t.varianceVnd} = 0 or (${t.varianceReason} is not null and btrim(${t.varianceReason}) <> '')`,
    ),
  ],
);

export const cashMovement = sales.table(
  'cash_movement',
  {
    id: id(),
    shiftId: uuid()
      .notNull()
      .references(() => shift.id),
    direction: text().notNull(),
    amountVnd: vndCol().notNull(),
    reason: text().notNull(),
    createdBy: uuid(),
    at: createdAt(),
  },
  (t) => [
    index('cash_movement_shift_idx').on(t.shiftId),
    check('cash_movement_direction_ck', inList(t.direction, ['in', 'out'])),
    check('cash_movement_amount_ck', sql`${t.amountVnd} > 0`),
  ],
);

export const sale = sales.table(
  'sale',
  {
    id: id(),
    docNo: text().notNull().unique(),
    clientEventId: uuid(),
    deviceId: uuid().references(() => posDevice.id),
    shiftId: uuid()
      .notNull()
      .references(() => shift.id),
    cashierId: uuid()
      .notNull()
      .references(() => appUser.id),
    customerId: uuid().references(() => customer.id),
    channel: text().notNull().default('counter'),
    subtotalVnd: vndCol().notNull(),
    discountVnd: vndCol().notNull(),
    /** Loyalty points are a discount, not a payment (FR-POS-05, BR-07). */
    pointsRedeemed: integer().notNull().default(0),
    pointsDiscountVnd: vndCol().notNull().default(0),
    pointsEarned: integer().notNull().default(0),
    totalVnd: vndCol().notNull(),
    vatVnd: vndCol().notNull(),
    /** Part-payment (deposit) sale: payments may be below the total (FR-POS-06). */
    isDeposit: boolean().notNull().default(false),
    status: text().notNull().default('completed'),
    offline: boolean().notNull().default(false),
    soldAt: ts().notNull().defaultNow(),
    note: text(),
    eventId: uuid(),
    couponCode: text(),
    voidedBy: uuid(),
    voidedAt: ts(),
    voidReason: text(),
    approvedBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sale_device_event_uq').on(t.deviceId, t.clientEventId).where(sql`${t.clientEventId} is not null`),
    index('sale_sold_at_idx').on(t.soldAt),
    index('sale_customer_idx').on(t.customerId, t.soldAt),
    index('sale_cashier_idx').on(t.cashierId, t.soldAt),
    index('sale_shift_idx').on(t.shiftId),
    check('sale_status_ck', inList(t.status, SALE_STATUSES)),
    check('sale_channel_ck', inList(t.channel, ['counter'])),
    check('sale_amounts_ck', sql`${t.totalVnd} >= 0 and ${t.discountVnd} >= 0 and ${t.subtotalVnd} >= 0`),
  ],
);

/** Library loan fees, late fees and lost/damage charges are `library_charge` service lines (FR-POS-08). */
export const ITEM_CLASSES = ['goods', 'event_ticket', 'library_charge'] as const;

export const saleLine = sales.table(
  'sale_line',
  {
    id: id(),
    saleId: uuid()
      .notNull()
      .references(() => sale.id),
    lineNo: integer().notNull(),
    /** Null for non-stock service items (FR-POS-08). */
    variantId: uuid().references(() => itemVariant.id),
    itemClass: text().notNull().default('goods'),
    description: text().notNull(),
    serviceRef: jsonb(),
    qty: integer().notNull(),
    unitPriceVnd: vndCol().notNull(),
    discountVnd: vndCol().notNull().default(0),
    totalVnd: vndCol().notNull(),
    vatBp: integer().notNull(),
    vatVnd: vndCol().notNull(),
    /** Cost at sale time for margin reports (TDD §4.2). */
    costVnd: vndCol().notNull().default(0),
    promotionVersionIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    priceOverridden: boolean().notNull().default(false),
    note: text(),
  },
  (t) => [
    uniqueIndex('sale_line_no_uq').on(t.saleId, t.lineNo),
    index('sale_line_variant_idx').on(t.variantId, t.saleId),
    check('sale_line_qty_ck', sql`${t.qty} > 0`),
    check('sale_line_class_ck', inList(t.itemClass, ITEM_CLASSES)),
  ],
);

/**
 * Tenders: cash, bank transfer (printed QR + reference), card and store credit (FR-CRM-10, no longer
 * written); `deposit` is a pre-order deposit counted as paid when it is collected (FR-POS-09). Points are not a tender.
 */
export const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'store_credit', 'deposit'] as const;

export const salePayment = sales.table(
  'sale_payment',
  {
    id: id(),
    saleId: uuid()
      .notNull()
      .references(() => sale.id),
    method: text().notNull(),
    amountVnd: vndCol().notNull(),
    /** Cash tendered (for change) / transfer payment reference / card approval code. */
    tenderedVnd: vndCol(),
    ref: text(),
    /** Offline transfers stay unverified until a manager confirms (TDD §7.6). */
    verified: boolean().notNull().default(true),
    confirmedBy: uuid(),
    confirmedAt: ts(),
  },
  (t) => [
    index('sale_payment_sale_idx').on(t.saleId),
    check('sale_payment_method_ck', inList(t.method, PAYMENT_METHODS)),
    check('sale_payment_amount_ck', sql`${t.amountVnd} > 0`),
  ],
);

export const saleReturn = sales.table(
  'sale_return',
  {
    id: id(),
    docNo: text().notNull().unique(),
    saleId: uuid()
      .notNull()
      .references(() => sale.id),
    shiftId: uuid().references(() => shift.id),
    refundMethod: text().notNull(),
    refundVnd: vndCol().notNull(),
    pointsReversed: integer().notNull().default(0),
    reason: text(),
    approvedBy: uuid(),
    createdBy: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('sale_return_sale_idx').on(t.saleId),
    check('sale_return_method_ck', inList(t.refundMethod, ['cash', 'transfer', 'card', 'store_credit'])),
  ],
);

export const saleReturnLine = sales.table(
  'sale_return_line',
  {
    id: id(),
    returnId: uuid()
      .notNull()
      .references(() => saleReturn.id),
    saleLineId: uuid()
      .notNull()
      .references(() => saleLine.id),
    qty: integer().notNull(),
    refundVnd: vndCol().notNull(),
    /** Restock or damaged (FR-POS-13, BR-04). */
    restock: boolean().notNull(),
  },
  (t) => [index('sale_return_line_sale_line_idx').on(t.saleLineId), check('sale_return_line_qty_ck', sql`${t.qty} > 0`)],
);

export const heldCart = sales.table(
  'held_cart',
  {
    id: id(),
    registerId: uuid()
      .notNull()
      .references(() => register.id),
    cashierId: uuid().notNull(),
    label: text(),
    payload: jsonb().notNull(),
    heldAt: createdAt(),
  },
  (t) => [index('held_cart_register_idx').on(t.registerId)],
);

export const einvoiceJob = sales.table(
  'einvoice_job',
  {
    id: id(),
    saleId: uuid().references(() => sale.id),
    orderId: uuid(),
    status: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    nextAttemptAt: ts(),
    providerRef: text(),
    invoiceNo: text(),
    buyer: jsonb(),
    emailRequested: boolean().notNull().default(false),
    /** Buyer details arrived after issue: cancel or adjust and reissue as regulation allows (TDD §8.3). */
    reissueRequested: boolean().notNull().default(false),
    emailStatus: text(),
    error: text(),
    createdAt: createdAt(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('einvoice_job_sale_uq').on(t.saleId).where(sql`${t.saleId} is not null`),
    uniqueIndex('einvoice_job_order_uq').on(t.orderId).where(sql`${t.orderId} is not null`),
    index('einvoice_job_status_idx').on(t.status, t.nextAttemptAt),
    check('einvoice_job_status_ck', inList(t.status, statesOf(EINVOICE))),
  ],
);

/** Gap-free document counters per series and year, updated under row lock (NFR-REL-02). */
export const docCounter = sales.table(
  'doc_counter',
  {
    series: text().notNull(),
    year: integer().notNull(),
    lastNo: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.series, t.year] })],
);

/** Offline sync inbox: replays of the same event are harmless (TDD §7.5). */
export const posInbox = sales.table(
  'pos_inbox',
  {
    id: id(),
    deviceId: uuid()
      .notNull()
      .references(() => posDevice.id),
    clientEventId: uuid().notNull(),
    seq: integer().notNull(),
    type: text().notNull(),
    result: jsonb().notNull(),
    exceptionCode: text(),
    /** All exceptions raised by the event (TDD §7.6); `exceptionCode` is the first. */
    exceptions: jsonb().notNull().default([]),
    payload: jsonb(),
    receivedAt: createdAt(),
    resolvedAt: ts(),
    resolvedBy: uuid(),
    resolutionNote: text(),
  },
  (t) => [uniqueIndex('pos_inbox_uq').on(t.deviceId, t.clientEventId)],
);
