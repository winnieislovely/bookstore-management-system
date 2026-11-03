import { LIB_ACQUIRED_VIA, LIB_CHARGE_KINDS, LIB_CHARGE_STATUSES, LIB_COPY_STATUSES, LIB_LANGUAGES, LIB_RESERVATION_STATUSES, LOAN_CLOSED_AS } from '@bookstore/domain';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { customer } from './crm.js';
import { appUser } from './platform.js';
import { sale } from './sales.js';
import { createdAt, id, inList, ts, updatedAt, version, vndCol } from './_common.js';

/**
 * Library (TDD §4.8, §5.3 “Library”): a lending collection separate from retail stock. Borrowers
 * are customers; rules are `library.*` settings.
 */
export const library = pgSchema('library');

export const libTitle = library.table(
  'lib_title',
  {
    id: id(),
    /** Staff-set library code printed on the book label (FR-LIB-01), stored upper case. */
    code: text().notNull(),
    title: text().notNull(),
    authors: text().array().notNull().default(sql`'{}'::text[]`),
    isbn13: text(),
    publisher: text(),
    year: integer(),
    language: text().notNull(),
    category: text(),
    callNo: text(),
    searchText: text().notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    uniqueIndex('lib_title_code_uq').on(sql`lower(${t.code})`),
    index('lib_title_search_trgm_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
    check('lib_title_language_ck', inList(t.language, LIB_LANGUAGES)),
  ],
);

export const libCopy = library.table(
  'lib_copy',
  {
    id: id(),
    titleId: uuid()
      .notNull()
      .references(() => libTitle.id),
    copyNo: integer().notNull(),
    /** Library code plus copy number (`VN-0123-2`); not rewritten when the code changes. */
    barcode: text().notNull(),
    status: text().notNull().default('available'),
    condition: text(),
    /** Acquisition value, used for replacement charges and the late-fee cap (FR-LIB-02). */
    valueVnd: vndCol().notNull().default(0),
    acquiredVia: text().notNull(),
    acquiredAt: ts().notNull().defaultNow(),
    shelf: text(),
    /** Retail variant it was transferred from (FR-INV-13). */
    sourceVariantId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('lib_copy_barcode_uq').on(t.barcode),
    uniqueIndex('lib_copy_no_uq').on(t.titleId, t.copyNo),
    index('lib_copy_status_idx').on(t.titleId, t.status),
    check('lib_copy_status_ck', inList(t.status, LIB_COPY_STATUSES)),
    check('lib_copy_via_ck', inList(t.acquiredVia, LIB_ACQUIRED_VIA)),
    check('lib_copy_value_ck', sql`${t.valueVnd} >= 0`),
  ],
);

export const loan = library.table(
  'loan',
  {
    id: id(),
    copyId: uuid()
      .notNull()
      .references(() => libCopy.id),
    customerId: uuid()
      .notNull()
      .references(() => customer.id),
    loanedAt: ts().notNull(),
    dueAt: ts().notNull(),
    returnedAt: ts(),
    closedAs: text(),
    renewals: integer().notNull().default(0),
    returnCondition: text(),
    createdBy: uuid().references(() => appUser.id),
    closedBy: uuid().references(() => appUser.id),
  },
  (t) => [
    // One open loan per copy (TDD §4.8): the final arbiter of two check-outs of one copy.
    uniqueIndex('loan_open_copy_uq').on(t.copyId).where(sql`${t.returnedAt} is null`),
    index('loan_customer_idx').on(t.customerId, t.returnedAt),
    index('loan_due_idx').on(t.dueAt).where(sql`${t.returnedAt} is null`),
    check('loan_closed_as_ck', sql`(${t.returnedAt} is null) = (${t.closedAs} is null) and (${t.closedAs} is null or ${inList(t.closedAs, LOAN_CLOSED_AS)})`),
  ],
);

export const loanRenewal = library.table(
  'loan_renewal',
  {
    id: id(),
    loanId: uuid()
      .notNull()
      .references(() => loan.id),
    renewedAt: ts().notNull(),
    newDueAt: ts().notNull(),
    by: uuid().references(() => appUser.id),
  },
  (t) => [index('loan_renewal_loan_idx').on(t.loanId)],
);

export const libReservation = library.table(
  'lib_reservation',
  {
    id: id(),
    titleId: uuid()
      .notNull()
      .references(() => libTitle.id),
    customerId: uuid()
      .notNull()
      .references(() => customer.id),
    queuedAt: ts().notNull(),
    status: text().notNull().default('queued'),
    /** The copy held for the borrower once one is returned (FR-LIB-13). */
    copyId: uuid().references(() => libCopy.id),
    holdUntil: ts(),
    createdBy: uuid().references(() => appUser.id),
  },
  (t) => [
    index('lib_reservation_title_idx').on(t.titleId, t.queuedAt),
    uniqueIndex('lib_reservation_open_uq').on(t.titleId, t.customerId).where(sql`${t.status} in ('queued', 'held')`),
    check('lib_reservation_status_ck', inList(t.status, LIB_RESERVATION_STATUSES)),
  ],
);

/** Loan fees, late fees and lost/damage charges: revenue when raised, paid through the POS (BR-14). */
export const libCharge = library.table(
  'lib_charge',
  {
    id: id(),
    customerId: uuid()
      .notNull()
      .references(() => customer.id),
    loanId: uuid().references(() => loan.id),
    kind: text().notNull(),
    /** Before the buyer discount (FR-LIB-18). */
    listVnd: vndCol().notNull(),
    discountPct: integer().notNull().default(0),
    amountVnd: vndCol().notNull(),
    status: text().notNull().default('unpaid'),
    saleId: uuid().references(() => sale.id),
    paidAt: ts(),
    waivedBy: uuid().references(() => appUser.id),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('lib_charge_customer_idx').on(t.customerId, t.status),
    index('lib_charge_sale_idx').on(t.saleId).where(sql`${t.saleId} is not null`),
    check('lib_charge_kind_ck', inList(t.kind, LIB_CHARGE_KINDS)),
    check('lib_charge_status_ck', inList(t.status, LIB_CHARGE_STATUSES)),
    check('lib_charge_amount_ck', sql`${t.amountVnd} > 0 and ${t.listVnd} >= ${t.amountVnd}`),
    check('lib_charge_paid_ck', sql`(${t.status} = 'paid') = (${t.saleId} is not null)`),
  ],
);
