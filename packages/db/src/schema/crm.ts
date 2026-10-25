import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, inList, ts, updatedAt, version, vndCol } from './_common.js';

/** Customers, loyalty and promotions (TDD §4.9, §5.3 “Customers and promotions”). */
export const crm = pgSchema('crm');

/** Tier benefits are evaluated by the pricing engine (FR-CRM-05). */
export interface TierBenefits {
  discountBp: number;
  pointsMultiplierBp: number;
  freeShippingFromVnd?: number;
}

export const tier = crm.table('tier', {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull().unique(),
  minSpendVnd: vndCol().notNull(),
  benefits: jsonb().$type<TierBenefits>().notNull(),
  sort: integer().notNull().default(0),
});

export const customer = crm.table(
  'customer',
  {
    id: id(),
    name: text().notNull(),
    /** Unique key, normalised E.164 (BR-16). Null only after anonymisation. */
    phoneE164: text('phone_e164'),
    email: text(),
    birthDate: date({ mode: 'string' }),
    addresses: jsonb().notNull().default([]),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    note: text(),
    source: text(),
    tierId: uuid().references(() => tier.id),
    pointsBalance: integer().notNull().default(0),
    /** Store-credit balance in VND = SUM(store_credit_ledger) (FR-CRM-10). */
    storeCreditVnd: vndCol().notNull().default(0),
    searchText: text().notNull().default(''),
    mergedInto: uuid(),
    anonymisedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    uniqueIndex('customer_phone_uq').on(t.phoneE164).where(sql`${t.phoneE164} is not null`),
    index('customer_search_trgm_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
    check('customer_points_ck', sql`${t.pointsBalance} >= 0`),
    check('customer_store_credit_ck', sql`${t.storeCreditVnd} >= 0`),
  ],
);

/** Additional contacts such as chat handles (FR-SOC-03). */
export const customerContact = crm.table(
  'customer_contact',
  {
    id: id(),
    customerId: uuid()
      .notNull()
      .references(() => customer.id),
    kind: text().notNull(),
    value: text().notNull(),
  },
  (t) => [index('customer_contact_customer_idx').on(t.customerId)],
);

export const customerConsent = crm.table(
  'customer_consent',
  {
    id: id(),
    customerId: uuid()
      .notNull()
      .references(() => customer.id),
    purpose: text().notNull(),
    channel: text().notNull(),
    grantedAt: ts().notNull().defaultNow(),
    withdrawnAt: ts(),
  },
  (t) => [index('customer_consent_customer_idx').on(t.customerId)],
);

export const POINTS_REASONS = ['earn', 'redeem', 'return_reversal', 'redeem_refund', 'expire', 'adjust', 'import'] as const;

/** Immutable points ledger; customer.points_balance = SUM(delta) (FR-CRM-06). */
export const pointsLedger = crm.table(
  'points_ledger',
  {
    id: id(),
    customerId: uuid()
      .notNull()
      .references(() => customer.id),
    delta: integer().notNull(),
    reason: text().notNull(),
    refType: text(),
    refId: uuid(),
    note: text(),
    expiresAt: ts(),
    actorId: uuid(),
    at: createdAt(),
  },
  (t) => [
    index('points_ledger_customer_idx').on(t.customerId, t.at),
    check('points_ledger_reason_ck', inList(t.reason, POINTS_REASONS)),
    check('points_ledger_delta_ck', sql`${t.delta} <> 0`),
  ],
);

export const STORE_CREDIT_REASONS = ['refund', 'spend', 'spend_reversal', 'adjust'] as const;

/** Immutable store-credit ledger in VND (FR-CRM-10). */
export const storeCreditLedger = crm.table(
  'store_credit_ledger',
  {
    id: id(),
    customerId: uuid()
      .notNull()
      .references(() => customer.id),
    deltaVnd: vndCol().notNull(),
    reason: text().notNull(),
    refType: text(),
    refId: uuid(),
    note: text(),
    actorId: uuid(),
    at: createdAt(),
  },
  (t) => [
    index('store_credit_ledger_customer_idx').on(t.customerId, t.at),
    check('store_credit_ledger_reason_ck', inList(t.reason, STORE_CREDIT_REASONS)),
    check('store_credit_ledger_delta_ck', sql`${t.deltaVnd} <> 0`),
  ],
);

export const customerTierHistory = crm.table(
  'customer_tier_history',
  {
    id: id(),
    customerId: uuid()
      .notNull()
      .references(() => customer.id),
    tierId: uuid()
      .notNull()
      .references(() => tier.id),
    spend12mVnd: vndCol().notNull(),
    fromAt: createdAt(),
  },
  (t) => [index('customer_tier_history_customer_idx').on(t.customerId, t.fromAt)],
);

export const promotion = crm.table('promotion', {
  id: id(),
  name: text().notNull(),
  /** Pause/resume (FR-PRM-04); scheduled/running/expired are derived from the version dates. */
  paused: boolean().notNull().default(false),
  currentVersionId: uuid(),
  createdBy: uuid(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
});

/** Every edit creates a version; sales store the version they applied (TDD §4.9). */
export const promotionVersion = crm.table(
  'promotion_version',
  {
    id: id(),
    promotionId: uuid()
      .notNull()
      .references(() => promotion.id),
    version: integer().notNull(),
    rule: jsonb().notNull(),
    startsAt: ts().notNull(),
    endsAt: ts(),
    createdBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('promotion_version_uq').on(t.promotionId, t.version)],
);

export const promotionUsage = crm.table(
  'promotion_usage',
  {
    id: id(),
    promotionId: uuid()
      .notNull()
      .references(() => promotion.id),
    customerId: uuid(),
    refType: text().notNull(),
    refId: uuid().notNull(),
    discountVnd: vndCol().notNull(),
    revenueVnd: vndCol().notNull(),
    at: createdAt(),
  },
  (t) => [index('promotion_usage_promo_idx').on(t.promotionId, t.customerId)],
);

export const coupon = crm.table(
  'coupon',
  {
    id: id(),
    code: text().notNull(),
    promotionId: uuid()
      .notNull()
      .references(() => promotion.id),
    /** Channel tag for attribution (FR-SOC-05). */
    channel: text(),
    usageLimit: integer(),
    used: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('coupon_code_uq').on(sql`upper(${t.code})`),
    check('coupon_used_ck', sql`${t.used} >= 0 and (${t.usageLimit} is null or ${t.used} <= ${t.usageLimit})`),
  ],
);

