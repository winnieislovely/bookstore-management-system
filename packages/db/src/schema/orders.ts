import {
  CHANNEL_KINDS,
  DEPOSIT_METHODS,
  PREORDER,
  DELIVERY_MODES,
  ORDER_PAYMENT_METHODS,
  ORDER_SOURCES,
  RETURN_REQUEST,
  REVIEW_REASONS,
  SHIPMENT_STATUSES,
  WEB_ORDER,
  statesOf,
} from '@bookstore/domain';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { itemVariant } from './catalog.js';
import { customer } from './crm.js';
import { appUser } from './platform.js';
import { sale, shift } from './sales.js';
import { allInList, createdAt, id, inList, ts, updatedAt, version, vndCol } from './_common.js';

/** Online and social orders, delivery (TDD §4.5, §5.3 “Orders and delivery”). */
export const orders = pgSchema('orders');

/** Channel profiles (FR-SOC-01): they feed the order-source list. */
export const channel = orders.table(
  'channel',
  {
    id: id(),
    name: text().notNull().unique(),
    kind: text().notNull(),
    url: text(),
    handle: text(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [check('channel_kind_ck', inList(t.kind, CHANNEL_KINDS))],
);

/** GHN address data, refreshed daily (TDD §8.2). The district id is hidden: GHN calls need it. */
export const geoProvince = orders.table('geo_province', {
  id: integer().primaryKey(),
  name: text().notNull(),
  searchText: text().notNull(),
  refreshedAt: ts().notNull().defaultNow(),
});

export const geoWard = orders.table(
  'geo_ward',
  {
    code: text().primaryKey(),
    name: text().notNull(),
    provinceId: integer()
      .notNull()
      .references(() => geoProvince.id),
    districtId: integer().notNull(),
    districtName: text().notNull(),
    searchText: text().notNull(),
    refreshedAt: ts().notNull().defaultNow(),
  },
  (t) => [index('geo_ward_province_idx').on(t.provinceId)],
);

export interface OrderRecipient {
  name: string;
  phone: string;
}

export interface OrderAddress {
  provinceId: number;
  provinceName: string;
  wardCode: string;
  wardName: string;
  line: string;
}

export const webOrder = orders.table(
  'web_order',
  {
    id: id(),
    docNo: text().notNull().unique(),
    source: text().notNull(),
    sourceRef: text(),
    externalId: text(),
    channelId: uuid().references(() => channel.id),
    customerId: uuid().references(() => customer.id),
    recipient: jsonb().$type<OrderRecipient>().notNull(),
    delivery: text().notNull().default('ship'),
    address: jsonb().$type<OrderAddress>(),
    status: text().notNull().default('new'),
    paymentMethod: text().notNull(),
    paymentRef: text(),
    subtotalVnd: vndCol().notNull(),
    discountVnd: vndCol().notNull(),
    shippingVnd: vndCol().notNull().default(0),
    totalVnd: vndCol().notNull(),
    vatVnd: vndCol().notNull(),
    pointsRedeemed: integer().notNull().default(0),
    pointsDiscountVnd: vndCol().notNull().default(0),
    pointsEarned: integer().notNull().default(0),
    couponCode: text(),
    paidAt: ts(),
    paidConfirmedBy: uuid().references(() => appUser.id),
    reviewReasons: text().array().notNull().default(sql`'{}'::text[]`),
    note: text(),
    readAt: ts(),
    pickupCodeHash: text(),
    readyAt: ts(),
    shippedAt: ts(),
    doneAt: ts(),
    cancelledAt: ts(),
    cancelReason: text(),
    attribution: jsonb(),
    createdBy: uuid().references(() => appUser.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    uniqueIndex('web_order_external_uq').on(t.source, t.externalId).where(sql`${t.externalId} is not null`),
    uniqueIndex('web_order_payment_ref_uq').on(t.paymentRef).where(sql`${t.paymentRef} is not null`),
    index('web_order_status_idx').on(t.status, t.createdAt),
    index('web_order_customer_idx').on(t.customerId, t.createdAt),
    index('web_order_done_idx').on(t.doneAt).where(sql`${t.doneAt} is not null`),
    check('web_order_status_ck', inList(t.status, statesOf(WEB_ORDER))),
    check('web_order_source_ck', inList(t.source, ORDER_SOURCES)),
    check('web_order_delivery_ck', inList(t.delivery, DELIVERY_MODES)),
    check('web_order_payment_ck', inList(t.paymentMethod, ORDER_PAYMENT_METHODS)),
    check('web_order_reasons_ck', allInList(t.reviewReasons, REVIEW_REASONS)),
    check('web_order_amounts_ck', sql`${t.totalVnd} >= 0 and ${t.discountVnd} >= 0 and ${t.subtotalVnd} >= 0 and ${t.shippingVnd} >= 0`),
    check('web_order_ship_address_ck', sql`${t.delivery} = 'pickup' or ${t.address} is not null`),
  ],
);

export const orderLine = orders.table(
  'order_line',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => webOrder.id),
    lineNo: integer().notNull(),
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    description: text().notNull(),
    qty: integer().notNull(),
    unitPriceVnd: vndCol().notNull(),
    discountVnd: vndCol().notNull().default(0),
    totalVnd: vndCol().notNull(),
    vatBp: integer().notNull(),
    vatVnd: vndCol().notNull(),
    /** Cost at handover, for margin reports (TDD §4.5). */
    costVnd: vndCol(),
    promotionVersionIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => [
    uniqueIndex('order_line_no_uq').on(t.orderId, t.lineNo),
    index('order_line_variant_idx').on(t.variantId),
    check('order_line_qty_ck', sql`${t.qty} > 0`),
  ],
);

/** Every status change, time-stamped and attributed (FR-ORD-07). Immutable. */
export const orderEvent = orders.table(
  'order_event',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => webOrder.id),
    fromStatus: text(),
    toStatus: text().notNull(),
    actorId: uuid(),
    at: createdAt(),
    reason: text(),
  },
  (t) => [index('order_event_order_idx').on(t.orderId, t.at)],
);

export const shipment = orders.table(
  'shipment',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => webOrder.id),
    carrier: text().notNull(),
    trackingNo: text().notNull(),
    feeVnd: vndCol().notNull().default(0),
    codVnd: vndCol().notNull().default(0),
    status: text().notNull().default('created'),
    carrierStatus: text(),
    statusAt: ts(),
    createdBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('shipment_tracking_uq').on(t.carrier, t.trackingNo),
    index('shipment_order_idx').on(t.orderId),
    index('shipment_status_idx').on(t.carrier, t.status),
    check('shipment_carrier_ck', inList(t.carrier, ['ghn', 'manual'])),
    check('shipment_status_ck', inList(t.status, SHIPMENT_STATUSES)),
  ],
);

/** COD collected by the carrier and remitted to the store (FR-ORD-11). */
export const codRemittance = orders.table(
  'cod_remittance',
  {
    id: id(),
    shipmentId: uuid()
      .notNull()
      .unique()
      .references(() => shipment.id),
    expectedVnd: vndCol().notNull(),
    receivedVnd: vndCol(),
    statementRef: text(),
    status: text().notNull().default('pending'),
    reconciledBy: uuid(),
    reconciledAt: ts(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index('cod_remittance_status_idx').on(t.status), check('cod_remittance_status_ck', inList(t.status, ['pending', 'matched', 'difference']))],
);

export interface ReturnLine {
  orderLineId: string;
  qty: number;
  /** Set at receipt: back to stock or written off (BR-04). */
  restock?: boolean;
}

export const returnRequest = orders.table(
  'return_request',
  {
    id: id(),
    orderId: uuid()
      .notNull()
      .references(() => webOrder.id),
    reason: text().notNull(),
    status: text().notNull().default('requested'),
    lines: jsonb().$type<ReturnLine[]>().notNull(),
    refundVnd: vndCol(),
    refundRef: text(),
    returnShippingPaidBy: text().notNull(),
    pointsReversed: integer().notNull().default(0),
    requestedBy: uuid(),
    receivedBy: uuid(),
    receivedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index('return_request_order_idx').on(t.orderId),
    check('return_request_status_ck', inList(t.status, statesOf(RETURN_REQUEST))),
    check('return_request_paid_by_ck', inList(t.returnShippingPaidBy, ['store', 'customer'])),
  ],
);

export const CONTACT_REASONS = ['preorder_arrived', 'pickup_ready', 'library_hold', 'waitlist_offer', 'event_cancelled'] as const;

/** To-notify worklist (FR-ORD-18): created by other modules, closed by staff. */
export const contactTask = orders.table(
  'contact_task',
  {
    id: id(),
    reason: text().notNull(),
    customerId: uuid().references(() => customer.id),
    name: text().notNull(),
    phone: text(),
    refType: text().notNull(),
    refId: uuid().notNull(),
    refLabel: text(),
    dueAt: ts().notNull(),
    status: text().notNull().default('open'),
    contactedBy: uuid(),
    contactedAt: ts(),
    note: text(),
    attempts: integer().notNull().default(0),
    overdueNotifiedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index('contact_task_status_idx').on(t.status, t.dueAt),
    uniqueIndex('contact_task_open_ref_uq').on(t.reason, t.refType, t.refId).where(sql`${t.status} = 'open'`),
    check('contact_task_reason_ck', inList(t.reason, CONTACT_REASONS)),
    check('contact_task_status_ck', inList(t.status, ['open', 'contacted', 'cancelled'])),
  ],
);

/** Deposit taken at the counter, held for the customer until collection (FR-ORD-14, TDD §4.5). */
const depositColumns = () => ({
  depositVnd: vndCol().notNull().default(0),
  depositMethod: text(),
  depositRef: text(),
  depositShiftId: uuid().references(() => shift.id),
  depositOutcome: text(),
  refundRef: text(),
});

export const preorder = orders.table(
  'preorder',
  {
    id: id(),
    docNo: text().notNull().unique(),
    source: text().notNull(),
    customerId: uuid()
      .notNull()
      .references(() => customer.id),
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    qty: integer().notNull(),
    unitPriceVnd: vndCol().notNull(),
    ...depositColumns(),
    status: text().notNull().default('reserved'),
    allocatedAt: ts(),
    contactedAt: ts(),
    expiresAt: ts(),
    /** The counter sale that collected it (FR-POS-09). */
    saleId: uuid().references(() => sale.id),
    note: text(),
    cancelReason: text(),
    overdueNotifiedAt: ts(),
    createdBy: uuid().references(() => appUser.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('preorder_variant_idx').on(t.variantId, t.status, t.createdAt),
    index('preorder_customer_idx').on(t.customerId),
    check('preorder_status_ck', inList(t.status, statesOf(PREORDER))),
    check('preorder_qty_ck', sql`${t.qty} > 0`),
    check('preorder_source_ck', inList(t.source, ORDER_SOURCES)),
    check('preorder_deposit_method_ck', sql`${t.depositMethod} is null or ${inList(t.depositMethod, DEPOSIT_METHODS)}`),
    check('preorder_outcome_ck', sql`${t.depositOutcome} is null or ${inList(t.depositOutcome, ['refunded', 'forfeited'])}`),
  ],
);
