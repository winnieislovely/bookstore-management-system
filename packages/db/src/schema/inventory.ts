import { MOVEMENT_TYPES, STOCK_COUNT, statesOf } from '@bookstore/domain';
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgSchema, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { itemVariant } from './catalog.js';
import { createdAt, id, inList, ts, vndCol } from './_common.js';

/** Inventory (TDD §4.2, §5.3 “Inventory”). Only `inventory.apply` writes stock. */
export const inventory = pgSchema('inventory');

/** FR-INV-01: optionally split between shop floor and back store. */
export const LOCATIONS = ['floor', 'back'] as const;

export const stockLevel = inventory.table(
  'stock_level',
  {
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    location: text().notNull().default('floor'),
    onHand: integer().notNull().default(0),
    reserved: integer().notNull().default(0),
    avgCostVnd: vndCol().notNull().default(0),
    lastSaleAt: ts(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.location] }),
    check('stock_level_reserved_ck', sql`${t.reserved} >= 0`),
    check('stock_level_location_ck', inList(t.location, LOCATIONS)),
  ],
);

/** Immutable ledger (trigger forbids UPDATE/DELETE; FR-INV-02). */
export const stockMovement = inventory.table(
  'stock_movement',
  {
    id: id(),
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    location: text().notNull().default('floor'),
    type: text().notNull(),
    qtyDelta: integer().notNull(),
    unitCostVnd: vndCol(),
    refType: text().notNull(),
    refId: uuid().notNull(),
    actorId: uuid(),
    at: createdAt(),
    note: text(),
  },
  (t) => [
    check('stock_movement_type_ck', inList(t.type, MOVEMENT_TYPES)),
    check('stock_movement_qty_ck', sql`${t.qtyDelta} <> 0`),
    index('stock_movement_variant_idx').on(t.variantId, t.at.desc()),
    index('stock_movement_ref_idx').on(t.refType, t.refId),
  ],
);

export const RESERVATION_STATUSES = ['active', 'converted', 'released', 'expired'] as const;

export const stockReservation = inventory.table(
  'stock_reservation',
  {
    id: id(),
    refType: text().notNull(),
    refId: uuid().notNull(),
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    location: text().notNull().default('floor'),
    qty: integer().notNull(),
    status: text().notNull().default('active'),
    expiresAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('stock_reservation_ref_uq').on(t.refType, t.refId, t.variantId),
    index('stock_reservation_expiry_idx').on(t.status, t.expiresAt),
    check('stock_reservation_qty_ck', sql`${t.qty} > 0`),
    check('stock_reservation_status_ck', inList(t.status, RESERVATION_STATUSES)),
  ],
);

/** Stock count sessions (FR-INV-06): full or partial, blind, approval before posting. */
export const stockCount = inventory.table(
  'stock_count',
  {
    id: id(),
    docNo: text().notNull().unique(),
    /** `{ kind: 'full' } | { kind: 'category', ids } | { kind: 'shelf', codes }` */
    scope: jsonb().notNull(),
    location: text().notNull().default('floor'),
    blind: boolean().notNull().default(false),
    status: text().notNull().default('open'),
    createdBy: uuid(),
    approvedBy: uuid(),
    approvedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [check('stock_count_status_ck', inList(t.status, statesOf(STOCK_COUNT)))],
);

export const stockCountLine = inventory.table(
  'stock_count_line',
  {
    id: id(),
    countId: uuid()
      .notNull()
      .references(() => stockCount.id),
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    expected: integer().notNull(),
    counted: integer(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('stock_count_line_uq').on(t.countId, t.variantId)],
);

/** Manual adjustments with reason code; approval above the threshold (FR-INV-07). */
export const stockAdjustment = inventory.table(
  'stock_adjustment',
  {
    id: id(),
    docNo: text().notNull().unique(),
    variantId: uuid()
      .notNull()
      .references(() => itemVariant.id),
    location: text().notNull().default('floor'),
    qtyDelta: integer().notNull(),
    reasonCode: text().notNull(),
    note: text(),
    valueVnd: vndCol().notNull(),
    status: text().notNull().default('posted'),
    requestedBy: uuid(),
    approvedBy: uuid(),
    movementId: uuid().references(() => stockMovement.id),
    createdAt: createdAt(),
  },
  (t) => [
    check('stock_adjustment_qty_ck', sql`${t.qtyDelta} <> 0`),
    check('stock_adjustment_status_ck', inList(t.status, ['pending_approval', 'posted', 'rejected'])),
  ],
);
