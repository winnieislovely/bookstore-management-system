import { schema } from '@bookstore/db';
import {
  borrowBlocks,
  BORROW_BLOCK_TEXT,
  composeCallNo,
  daysLate,
  dueAfter,
  foldText,
  isOverdue,
  lateFee,
  LIB_LANGUAGES,
  LIB_PAYMENT_METHODS,
  loanFee,
  discountedLoanFees,
  normalizeDewey,
  normalizeIsbn,
  replacementCharge,
  type SettingsSnapshot,
} from '@bookstore/domain';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as inventory from '../inventory/index.js';
import * as notifications from '../notifications/index.js';
import * as settings from '../settings/index.js';
import { AppError, can, emit, errors, nextDocNo, requirePermission, tsParam, type Ctx, type Tx } from '../platform/index.js';

/**
 * Library (SRS §3.9, TDD §4.8): a lending collection with its own catalogue. Borrowers are
 * customers found by phone; each loan raises a loan-fee charge, returns raise late fees, and every
 * charge is paid through the POS as a service line (FR-POS-08).
 */

type Rules = Pick<
  SettingsSnapshot,
  | 'library.loan_fee_vnd'
  | 'library.loan_days'
  | 'library.renewals'
  | 'library.max_loans'
  | 'library.fine_per_day_vnd'
  | 'library.grace_days'
  | 'library.lost_fee_vnd'
  | 'library.remind_days'
  | 'library.hold_days'
  | 'library.fee_discount_spend_vnd'
  | 'library.fee_discount_pct'
>;

async function rules(ctx: Ctx, tx: Tx): Promise<Rules> {
  return settings.snapshot(ctx, tx);
}

const lateRules = (r: Rules) => ({ finePerDayVnd: r['library.fine_per_day_vnd'], graceDays: r['library.grace_days'] });
const feeRules = (r: Rules) => ({ loanFeeVnd: r['library.loan_fee_vnd'], discountSpendVnd: r['library.fee_discount_spend_vnd'], discountPct: r['library.fee_discount_pct'] });

/** Lifetime net spend on goods: completed counter sales and Done online orders, less returns (FR-LIB-18). */
export async function lifetimeSpend(tx: Tx, customerId: string): Promise<number> {
  const [r] = await tx.execute<{ spend: string }>(sql`
    select coalesce((select sum(total_vnd) from reports.sale_line where customer_id = ${customerId}::uuid and item_class = 'goods'), 0)
         - coalesce((select sum(refund_vnd) from reports.return_line where customer_id = ${customerId}::uuid and variant_id is not null), 0) as spend`);
  return Math.max(0, Number(r!.spend));
}

// =============================================================================================
// Titles (FR-LIB-01)

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  text(max)
    .nullish()
    .transform((v) => (v ? v : null));

/** Copies added with a title or later: entry date, count, value and source (FR-LIB-02). */
export const CopiesBlock = z.object({
  count: z.number().int().min(0).max(50).default(1),
  /** Entry date (store day); default today. */
  acquiredAt: z.iso.date().optional(),
  valueVnd: z.number().int().min(0).default(0),
  acquiredVia: z.enum(['purchase', 'donation']).default('purchase'),
});

export const TitleSchema = z.object({
  title: z.string().trim().min(1, 'Cần nhập tên sách.').max(300),
  authors: z.array(z.string().trim().min(1).max(160)).max(10).default([]),
  isbn13: optText(20),
  publisher: optText(160),
  year: z.number().int().min(1000).max(2100).nullish(),
  language: z.enum(LIB_LANGUAGES),
  category: optText(120),
  /** Dewey number; empty while the title is unclassified (FR-LIB-01). */
  dewey: optText(30).refine((v) => v === null || normalizeDewey(v) !== null, { message: 'Số Dewey gồm 3 chữ số, có thể thêm phần thập phân (ví dụ 891.733).' }),
  /** Cutter with the title letter (`D67c`). */
  cutter: optText(20),
  /** First copies, saved with a new title in one step (ignored on update). */
  copies: CopiesBlock.optional(),
});

function searchText(t: { callNo: string | null; title: string; authors: string[]; isbn13: string | null }) {
  return foldText([t.callNo ?? '', t.title, ...t.authors, t.isbn13 ?? ''].join(' '));
}

function isbnOf(raw: string | null): string | null {
  if (!raw) return null;
  const isbn = normalizeIsbn(raw);
  if (!isbn) throw new AppError(400, 'invalid_isbn', `ISBN '${raw}' không hợp lệ.`);
  return isbn;
}

/** Title fields with the normalised Dewey and the composed call number (`891.733 D67c`, or null). */
function titleValues(data: z.output<typeof TitleSchema>) {
  const { copies: _copies, ...rest } = data;
  const dewey = normalizeDewey(rest.dewey);
  const cutter = rest.cutter ? rest.cutter.replace(/\s+/g, '') : null;
  const isbn13 = isbnOf(rest.isbn13);
  const callNo = composeCallNo(dewey, cutter);
  return { ...rest, dewey, cutter, isbn13, callNo, year: rest.year ?? null, searchText: searchText({ ...rest, isbn13, callNo }) };
}

export async function createTitle(ctx: Ctx, input: z.input<typeof TitleSchema>) {
  requirePermission(ctx, 'library.manage');
  const data = TitleSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const values = titleValues(data);
    const [row] = await tx.insert(schema.libTitle).values(values).returning({ id: schema.libTitle.id, callNo: schema.libTitle.callNo });
    const copies = data.copies?.count ? await insertCopies(tx, ctx, row!.id, data.copies.count, copyValues(ctx, data.copies)) : [];
    await audit.record(tx, ctx, { action: 'library.title.create', entity: 'lib_title', entityId: row!.id, after: { ...values, barcodes: copies.map((c) => c.barcode) } });
    return { ...row!, copies };
  });
}

export async function updateTitle(ctx: Ctx, id: string, input: z.input<typeof TitleSchema>) {
  requirePermission(ctx, 'library.manage');
  const data = TitleSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.libTitle).where(eq(schema.libTitle.id, id)).for('update');
    if (!before) throw errors.notFound('Đầu sách');
    // Accession numbers never change; a new call number only needs new spine labels.
    const values = titleValues(data);
    await tx
      .update(schema.libTitle)
      .set({ ...values, updatedAt: ctx.clock.now(), version: sql`${schema.libTitle.version} + 1` })
      .where(eq(schema.libTitle.id, id));
    await audit.record(tx, ctx, { action: 'library.title.update', entity: 'lib_title', entityId: id, before, after: values });
    return { id, callNo: values.callNo };
  });
}

export const TitlesQuery = z.object({
  q: z.string().trim().max(100).optional(),
  language: z.enum(LIB_LANGUAGES).optional(),
  /** Titles with at least one copy in this status. */
  status: z.enum(['available', 'reserved', 'on_loan', 'lost', 'damaged']).optional(),
  category: z.string().trim().max(120).optional(),
  /** Only titles without a call number (Chưa phân loại). */
  unclassified: z.union([z.boolean(), z.stringbool()]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function listTitles(ctx: Ctx, input: z.input<typeof TitlesQuery>) {
  requireAny(ctx);
  const q = TitlesQuery.parse(input);
  const t = schema.libTitle;
  const where: SQL[] = [];
  if (q.language) where.push(eq(t.language, q.language));
  if (q.category) where.push(eq(t.category, q.category));
  if (q.unclassified) where.push(sql`${t.callNo} is null`);
  if (q.status) where.push(sql`exists (select 1 from library.lib_copy c where c.title_id = library.lib_title.id and c.status = ${q.status})`);
  if (q.q) {
    const folded = foldText(q.q);
    where.push(sql`(${t.searchText} like ${`%${folded}%`} or exists (select 1 from library.lib_copy c where c.title_id = library.lib_title.id and replace(lower(c.barcode), '-', '') = replace(lower(${q.q}), '-', '')))`);
  }
  const items = await ctx.db
    .select({
      id: t.id,
      callNo: t.callNo,
      dewey: t.dewey,
      cutter: t.cutter,
      title: t.title,
      authors: t.authors,
      language: t.language,
      category: t.category,
      // Qualified by hand: a single-table select renders columns unqualified.
      copies: sql<number>`(select count(*)::int from library.lib_copy c where c.title_id = library.lib_title.id)`,
      available: sql<number>`(select count(*)::int from library.lib_copy c where c.title_id = library.lib_title.id and c.status = 'available')`,
      queued: sql<number>`(select count(*)::int from library.lib_reservation r where r.title_id = library.lib_title.id and r.status = 'queued')`,
      onLoan: sql<number>`(select count(*)::int from library.lib_copy c where c.title_id = library.lib_title.id and c.status = 'on_loan')`,
      // Earliest due date of an open loan: when a reserved title should be back (FR-LIB-13).
      nextDueAt: sql<string | null>`(select min(l.due_at) from library.loan l join library.lib_copy c on c.id = l.copy_id where c.title_id = library.lib_title.id and l.returned_at is null)`,
    })
    .from(t)
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${t.callNo} asc nulls last`, asc(t.title))
    .limit(q.limit);
  const categories = await ctx.db.execute<{ category: string }>(sql`select distinct category from library.lib_title where category is not null order by category`);
  return { items, categories: categories.map((c) => c.category) };
}

function requireAny(ctx: Ctx) {
  if (!ctx.actor) throw errors.unauthenticated();
  if (!can(ctx.actor, 'library.manage') && !can(ctx.actor, 'library.lend')) throw errors.forbidden('library.lend');
  return ctx.actor;
}

export async function getTitle(ctx: Ctx, id: string) {
  requireAny(ctx);
  const [title] = await ctx.db.select().from(schema.libTitle).where(eq(schema.libTitle.id, id));
  if (!title) throw errors.notFound('Đầu sách');
  const copies = await ctx.db.execute<{
    id: string;
    copy_no: number;
    barcode: string;
    status: string;
    condition: string | null;
    value_vnd: string;
    acquired_via: string;
    acquired_at: Date;
    shelf: string | null;
    due_at: Date | null;
    borrower_name: string | null;
    borrower_phone: string | null;
  }>(sql`
    select c.id, c.copy_no, c.barcode, c.status, c.condition, c.value_vnd, c.acquired_via, c.acquired_at, c.shelf,
           l.due_at, cu.name as borrower_name, cu.phone_e164 as borrower_phone
    from library.lib_copy c
    left join library.loan l on l.copy_id = c.id and l.returned_at is null
    left join crm.customer cu on cu.id = l.customer_id
    where c.title_id = ${id}::uuid order by c.copy_no`);
  const reservations = await reservationsOf(ctx, sql`r.title_id = ${id}::uuid`);
  return {
    ...title,
    copies: copies.map((c) => ({
      id: c.id,
      copyNo: c.copy_no,
      barcode: c.barcode,
      status: c.status,
      condition: c.condition,
      valueVnd: Number(c.value_vnd),
      acquiredVia: c.acquired_via,
      acquiredAt: c.acquired_at,
      shelf: c.shelf,
      loan: c.due_at ? { dueAt: c.due_at, overdue: isOverdue(asDate(c.due_at), ctx.clock.now()), borrowerName: c.borrower_name, borrowerPhone: c.borrower_phone } : null,
    })),
    reservations,
  };
}

// =============================================================================================
// Copies (FR-LIB-02, FR-INV-13)

export const AddCopiesSchema = CopiesBlock.extend({
  count: z.number().int().min(1).max(50).default(1),
  shelf: optText(60),
  condition: optText(200),
});

/** Entry date at the start of that store day, or now when it is today or not given. */
function copyValues(ctx: Ctx, b: { acquiredAt?: string | undefined; valueVnd: number; acquiredVia: 'purchase' | 'donation'; shelf?: string | null; condition?: string | null }) {
  const now = ctx.clock.now();
  const today = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  const acquiredAt = !b.acquiredAt || b.acquiredAt === today ? now : new Date(`${b.acquiredAt}T00:00:00+07:00`);
  return { valueVnd: b.valueVnd, acquiredVia: b.acquiredVia, shelf: b.shelf ?? null, condition: b.condition ?? null, acquiredAt };
}

/** Next `n` accession numbers of a prefix, consecutive and never reused (FR-LIB-01): `EN-000125`. */
async function allocateAccession(tx: Tx, prefix: 'VN' | 'EN', n: number): Promise<string[]> {
  const [row] = await tx
    .insert(schema.libAccessionCounter)
    .values({ prefix, lastNo: n })
    .onConflictDoUpdate({ target: schema.libAccessionCounter.prefix, set: { lastNo: sql`${schema.libAccessionCounter.lastNo} + ${n}` } })
    .returning({ lastNo: schema.libAccessionCounter.lastNo });
  const last = row!.lastNo;
  return Array.from({ length: n }, (_, i) => `${prefix}-${String(last - n + i + 1).padStart(6, '0')}`);
}

async function insertCopies(
  tx: Tx,
  ctx: Ctx,
  titleId: string,
  n: number,
  values: { valueVnd: number; acquiredVia: 'purchase' | 'donation' | 'transfer'; shelf: string | null; condition: string | null; acquiredAt?: Date; sourceVariantId?: string },
) {
  const [title] = await tx.select({ id: schema.libTitle.id, language: schema.libTitle.language }).from(schema.libTitle).where(eq(schema.libTitle.id, titleId)).for('update');
  if (!title) throw errors.notFound('Đầu sách');
  const [last] = await tx.execute<{ n: number }>(sql`select coalesce(max(copy_no), 0)::int as n from library.lib_copy where title_id = ${titleId}::uuid`);
  const now = ctx.clock.now();
  const barcodes = await allocateAccession(tx, title.language === 'vi' ? 'VN' : 'EN', n);
  const rows = barcodes.map((barcode, i) => ({ titleId, copyNo: last!.n + i + 1, barcode, ...values, acquiredAt: values.acquiredAt ?? now, createdAt: now }));
  return tx.insert(schema.libCopy).values(rows).returning({ id: schema.libCopy.id, barcode: schema.libCopy.barcode, copyNo: schema.libCopy.copyNo });
}

export async function addCopies(ctx: Ctx, titleId: string, input: z.input<typeof AddCopiesSchema>) {
  requirePermission(ctx, 'library.manage');
  const data = AddCopiesSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const copies = await insertCopies(tx, ctx, titleId, data.count, copyValues(ctx, data));
    await audit.record(tx, ctx, { action: 'library.copy.add', entity: 'lib_title', entityId: titleId, after: { ...data, barcodes: copies.map((c) => c.barcode) } });
    return { items: copies };
  });
}

export const TransferSchema = z.object({
  variantId: z.uuid(),
  count: z.number().int().min(1).max(50).default(1),
  shelf: optText(60),
});

/**
 * Transfer retail stock into the collection (FR-LIB-02, FR-INV-13): the units leave sale stock at
 * cost (`library_transfer`); each copy's value is the selling price, its replacement value.
 */
export async function transferFromStock(ctx: Ctx, titleId: string, input: z.input<typeof TransferSchema>) {
  requirePermission(ctx, 'library.manage');
  requirePermission(ctx, 'inventory.adjust');
  const data = TransferSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [v] = await tx.select({ id: schema.itemVariant.id, priceVnd: schema.itemVariant.priceVnd, sku: schema.itemVariant.sku }).from(schema.itemVariant).where(eq(schema.itemVariant.id, data.variantId));
    if (!v) throw errors.notFound('Sản phẩm');
    await inventory.apply(tx, ctx, { variantId: v.id, type: 'library_transfer', qtyDelta: -data.count, refType: 'lib_title', refId: titleId });
    const copies = await insertCopies(tx, ctx, titleId, data.count, { valueVnd: v.priceVnd, acquiredVia: 'transfer', shelf: data.shelf, condition: null, sourceVariantId: v.id });
    await audit.record(tx, ctx, { action: 'library.copy.transfer', entity: 'lib_title', entityId: titleId, after: { sku: v.sku, count: data.count, barcodes: copies.map((c) => c.barcode) } });
    return { items: copies };
  });
}

export const UpdateCopySchema = z.object({
  shelf: optText(60).optional(),
  condition: optText(200).optional(),
  valueVnd: z.number().int().min(0).optional(),
  /** Back on the shelf after repair, or out of circulation as damaged without a charge. */
  status: z.enum(['available', 'damaged']).optional(),
});

export async function updateCopy(ctx: Ctx, id: string, input: z.input<typeof UpdateCopySchema>) {
  requirePermission(ctx, 'library.manage');
  const data = UpdateCopySchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [c] = await tx.select().from(schema.libCopy).where(eq(schema.libCopy.id, id)).for('update');
    if (!c) throw errors.notFound('Bản sách');
    if (data.status && data.status !== c.status && !['available', 'damaged'].includes(c.status)) {
      throw errors.conflict('copy_busy', `Bản ${c.barcode} đang ${c.status === 'on_loan' ? 'được mượn' : c.status === 'reserved' ? 'được giữ cho khách' : 'báo mất'}; không đổi trạng thái ở đây.`);
    }
    await tx
      .update(schema.libCopy)
      .set({ ...data, updatedAt: ctx.clock.now() })
      .where(eq(schema.libCopy.id, id));
    if (data.status === 'available' && c.status !== 'available') await placeReturnedCopy(tx, ctx, id);
    await audit.record(tx, ctx, { action: 'library.copy.update', entity: 'lib_copy', entityId: id, before: c, after: data });
    return { id };
  });
}

/** A lost copy turned up: back on the shelf and the unpaid lost charge cancelled (FR-LIB-11). */
export async function markFound(ctx: Ctx, copyId: string) {
  requirePermission(ctx, 'library.lend');
  return ctx.db.transaction(async (tx) => {
    const [c] = await tx.select().from(schema.libCopy).where(eq(schema.libCopy.id, copyId)).for('update');
    if (!c) throw errors.notFound('Bản sách');
    if (c.status !== 'lost') throw errors.conflict('copy_not_lost', `Bản ${c.barcode} không ở trạng thái Mất.`);
    const cancelled = await tx
      .update(schema.libCharge)
      .set({ status: 'cancelled', reason: 'Đã tìm thấy sách' })
      .where(and(eq(schema.libCharge.kind, 'lost'), eq(schema.libCharge.status, 'unpaid'), sql`${schema.libCharge.loanId} in (select id from library.loan where copy_id = ${copyId}::uuid)`))
      .returning({ id: schema.libCharge.id });
    await tx.update(schema.libCopy).set({ status: 'available', updatedAt: ctx.clock.now() }).where(eq(schema.libCopy.id, copyId));
    await placeReturnedCopy(tx, ctx, copyId);
    await audit.record(tx, ctx, { action: 'library.copy.found', entity: 'lib_copy', entityId: copyId, after: { cancelledCharges: cancelled.length } });
    return { id: copyId, cancelledCharges: cancelled.length };
  });
}

export async function labels(ctx: Ctx, copyIds: string[]) {
  requireAny(ctx);
  if (!copyIds.length) return { items: [] };
  const rows = await ctx.db
    .select({ barcode: schema.libCopy.barcode, callNo: schema.libTitle.callNo, dewey: schema.libTitle.dewey, cutter: schema.libTitle.cutter, title: schema.libTitle.title, language: schema.libTitle.language })
    .from(schema.libCopy)
    .innerJoin(schema.libTitle, eq(schema.libTitle.id, schema.libCopy.titleId))
    .where(inArray(schema.libCopy.id, copyIds))
    .orderBy(asc(schema.libCopy.barcode));
  return { items: rows };
}

export const CopiesQuery = z.object({
  q: z.string().trim().min(1).max(100),
  status: z.enum(['available', 'reserved', 'on_loan', 'lost', 'damaged']).optional(),
});

/** Copies matching an accession number (with or without the hyphen), a call number or a title (Design §13.8). */
export async function searchCopies(ctx: Ctx, input: z.input<typeof CopiesQuery>) {
  requireAny(ctx);
  const q = CopiesQuery.parse(input);
  const folded = foldText(q.q);
  const rows = await ctx.db
    .select({ id: schema.libCopy.id, barcode: schema.libCopy.barcode, status: schema.libCopy.status, shelf: schema.libCopy.shelf, callNo: schema.libTitle.callNo, title: schema.libTitle.title })
    .from(schema.libCopy)
    .innerJoin(schema.libTitle, eq(schema.libTitle.id, schema.libCopy.titleId))
    .where(
      and(
        q.status ? eq(schema.libCopy.status, q.status) : undefined,
        sql`(replace(upper(${schema.libCopy.barcode}), '-', '') like replace(upper(${`${q.q}%`}), '-', '') or ${schema.libTitle.searchText} like ${`%${folded}%`})`,
      ),
    )
    .orderBy(asc(schema.libCopy.barcode))
    .limit(20);
  return { items: rows };
}

/** The scan step of check-out: one copy by its exact barcode, never a fuzzy title match. */
export async function copyByBarcode(ctx: Ctx, barcode: string) {
  requireAny(ctx);
  const [row] = await ctx.db
    .select({ id: schema.libCopy.id, barcode: schema.libCopy.barcode, status: schema.libCopy.status, callNo: schema.libTitle.callNo, title: schema.libTitle.title })
    .from(schema.libCopy)
    .innerJoin(schema.libTitle, eq(schema.libTitle.id, schema.libCopy.titleId))
    .where(sql`replace(upper(${schema.libCopy.barcode}), '-', '') = replace(upper(${barcode.trim()}), '-', '')`);
  if (!row) throw new AppError(404, 'copy_not_found', `Không tìm thấy bản sách có mã ${barcode.trim()}.`, { barcode });
  return row;
}

// =============================================================================================
// Borrowers (FR-LIB-05, FR-LIB-15)

async function borrowerState(tx: Tx, customerId: string, now: Date) {
  const [r] = await tx.execute<{ open: number; overdue: number; unpaid: string }>(sql`
    select (select count(*)::int from library.loan where customer_id = ${customerId}::uuid and returned_at is null) as open,
           (select count(*)::int from library.loan where customer_id = ${customerId}::uuid and returned_at is null and due_at < ${tsParam(now)}) as overdue,
           (select coalesce(sum(amount_vnd), 0) from library.lib_charge where customer_id = ${customerId}::uuid and status = 'unpaid') as unpaid`);
  return { openLoans: r!.open, overdueLoans: r!.overdue, unpaidChargesVnd: Number(r!.unpaid) };
}

const LOAN_ROW = sql`
  l.id, l.copy_id, l.customer_id, l.loaned_at, l.due_at, l.returned_at, l.closed_as, l.renewals,
  c.barcode, c.value_vnd, t.id as title_id, t.call_no as code, t.title, cu.name as customer_name, cu.phone_e164 as customer_phone`;

type LoanRow = {
  id: string;
  copy_id: string;
  customer_id: string;
  loaned_at: Date;
  due_at: Date;
  returned_at: Date | null;
  closed_as: string | null;
  renewals: number;
  barcode: string;
  value_vnd: string;
  title_id: string;
  code: string | null;
  title: string;
  customer_name: string;
  customer_phone: string | null;
};

/** Raw queries return timestamps as text. */
const asDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

function fixLoan(l: LoanRow): LoanRow {
  return { ...l, loaned_at: asDate(l.loaned_at), due_at: asDate(l.due_at), returned_at: l.returned_at === null ? null : asDate(l.returned_at) };
}

function loanView(raw: LoanRow, now: Date, r: Rules) {
  const l = fixLoan(raw);
  const open = l.returned_at === null;
  return {
    id: l.id,
    copyId: l.copy_id,
    customerId: l.customer_id,
    customerName: l.customer_name,
    customerPhone: l.customer_phone,
    titleId: l.title_id,
    callNo: l.code,
    title: l.title,
    barcode: l.barcode,
    loanedAt: l.loaned_at,
    dueAt: l.due_at,
    returnedAt: l.returned_at,
    closedAs: l.closed_as,
    renewals: l.renewals,
    renewalsLeft: Math.max(0, r['library.renewals'] - l.renewals),
    overdue: open && isOverdue(l.due_at, now),
    daysLate: open ? daysLate(l.due_at, now) : 0,
    /** Accruing late fee, binding only at return (TDD §4.8). */
    lateFeeVnd: open ? lateFee(l.due_at, now, Number(l.value_vnd), lateRules(r)) : 0,
  };
}

export async function borrower(ctx: Ctx, customerId: string) {
  requireAny(ctx);
  const now = ctx.clock.now();
  const tx = ctx.db;
  const [c] = await tx.select({ id: schema.customer.id, name: schema.customer.name, phone: schema.customer.phoneE164 }).from(schema.customer).where(eq(schema.customer.id, customerId));
  if (!c) throw errors.notFound('Khách hàng');
  const r = await rules(ctx, tx);
  const state = await borrowerState(tx, customerId, now);
  const spendVnd = await lifetimeSpend(tx, customerId);
  const loans = await tx.execute<LoanRow>(sql`
    select ${LOAN_ROW} from library.loan l
    join library.lib_copy c on c.id = l.copy_id join library.lib_title t on t.id = c.title_id join crm.customer cu on cu.id = l.customer_id
    where l.customer_id = ${customerId}::uuid order by l.returned_at is null desc, l.loaned_at desc limit 100`);
  return {
    customer: c,
    ...state,
    maxLoans: r['library.max_loans'],
    blocks: borrowBlocks(state, r['library.max_loans'], 1),
    spendVnd,
    fee: loanFee(spendVnd, feeRules(r)),
    discountSpendVnd: r['library.fee_discount_spend_vnd'],
    loanDays: r['library.loan_days'],
    openLoans: loans.filter((l) => l.returned_at === null).map((l) => loanView(l, now, r)),
    history: loans.filter((l) => l.returned_at !== null).map((l) => loanView(l, now, r)),
    charges: await chargesOf(tx, sql`ch.customer_id = ${customerId}::uuid`, 100),
    reservations: await reservationsOf(ctx, sql`r.customer_id = ${customerId}::uuid and r.status in ('queued', 'held')`),
  };
}

async function chargesOf(tx: Tx, where: SQL, limit: number) {
  const rows = await tx.execute<{
    id: string;
    kind: string;
    list_vnd: string;
    discount_pct: number;
    amount_vnd: string;
    status: string;
    reason: string | null;
    created_at: Date;
    paid_at: Date | null;
    receipt_no: string | null;
    code: string | null;
    title: string | null;
    barcode: string | null;
  }>(sql`
    select ch.id, ch.kind, ch.list_vnd, ch.discount_pct, ch.amount_vnd, ch.status, ch.reason, ch.created_at, ch.paid_at,
           coalesce(p.doc_no, s.doc_no) as receipt_no, t.call_no as code, t.title, c.barcode
    from library.lib_charge ch
    left join library.lib_payment p on p.id = ch.payment_id
    left join sales.sale s on s.id = ch.sale_id
    left join library.loan l on l.id = ch.loan_id
    left join library.lib_copy c on c.id = l.copy_id
    left join library.lib_title t on t.id = c.title_id
    where ${where} order by ch.created_at desc limit ${limit}`);
  return rows.map((x) => ({
    id: x.id,
    kind: x.kind,
    listVnd: Number(x.list_vnd),
    discountPct: x.discount_pct,
    amountVnd: Number(x.amount_vnd),
    status: x.status,
    reason: x.reason,
    createdAt: x.created_at,
    paidAt: x.paid_at,
    /** Desk receipt, or the POS sale for charges paid before 4 Nov 2026. */
    receiptNo: x.receipt_no,
    callNo: x.code,
    title: x.title,
    barcode: x.barcode,
  }));
}

export const CHARGE_TEXT: Record<string, string> = { loan_fee: 'Phí mượn sách', late_fee: 'Phí trả trễ', lost: 'Phí mất sách', damage: 'Phí hỏng sách' };

// =============================================================================================
// Library cash book (FR-LIB-09a): every fee is collected at the desk, never through the POS

/** Cash or bank transfer only; a transfer reference may be noted (FR-LIB-09a). */
export const PaymentSchema = z.object({
  method: z.enum(['cash', 'transfer']),
  ref: z.string().trim().max(60).optional(),
});

/** One receipt for the given unpaid charges of one borrower; they become paid. */
async function collect(tx: Tx, ctx: Ctx, customerId: string, chargeIds: string[], payment: z.infer<typeof PaymentSchema>) {
  // No charges: the 0 VND receipt of a free loan, which is still the loan slip (FR-LIB-09a).
  const rows = chargeIds.length ? await tx.select().from(schema.libCharge).where(inArray(schema.libCharge.id, chargeIds)).for('update') : [];
  if (rows.length !== new Set(chargeIds).size) throw errors.notFound('Khoản thu thư viện');
  for (const r of rows) {
    if (r.customerId !== customerId) throw new AppError(422, 'charge_customer', 'Khoản thu là của khách khác.');
    if (r.status !== 'unpaid') throw errors.conflict('charge_not_unpaid', 'Một khoản đã được thu hoặc miễn. Hãy tải lại rồi thử lại.');
  }
  const amountVnd = rows.reduce((a, r) => a + r.amountVnd, 0);
  const now = ctx.clock.now();
  const docNo = await nextDocNo(tx, 'LIBP', now);
  const [p] = await tx
    .insert(schema.libPayment)
    .values({ docNo, kind: 'receipt', customerId, method: payment.method, amountVnd, ref: payment.ref ?? null, receivedBy: ctx.actor!.userId, receivedAt: now })
    .returning({ id: schema.libPayment.id });
  if (chargeIds.length) await tx.update(schema.libCharge).set({ status: 'paid', paymentId: p!.id, paidAt: now }).where(inArray(schema.libCharge.id, chargeIds));
  await audit.record(tx, ctx, { action: 'library.payment', entity: 'lib_payment', entityId: p!.id, after: { docNo, method: payment.method, amountVnd, chargeIds } });
  return { id: p!.id, docNo, amountVnd, method: payment.method };
}

export const PayChargesSchema = z.object({
  customerId: z.uuid(),
  chargeIds: z.array(z.uuid()).min(1, 'Chọn ít nhất một khoản.').max(50),
  payment: PaymentSchema,
});

/** Owed charges (late, lost, damage, or any left unpaid) collected at the desk. */
export async function payCharges(ctx: Ctx, input: z.input<typeof PayChargesSchema>) {
  requirePermission(ctx, 'library.lend');
  const data = PayChargesSchema.parse(input);
  return ctx.db.transaction((tx) => collect(tx, ctx, data.customerId, data.chargeIds, data.payment));
}

export const RefundSchema = z.object({ reason: z.string().trim().min(1, 'Cần nhập lý do hoàn tiền.').max(500) });

/** A receipt taken by mistake: a negative entry in the cash book; its charges are owed again. */
export async function refundPayment(ctx: Ctx, paymentId: string, input: z.input<typeof RefundSchema>) {
  const actor = requirePermission(ctx, 'library.fine_waive');
  const data = RefundSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.libPayment).where(eq(schema.libPayment.id, paymentId)).for('update');
    if (!p) throw errors.notFound('Phiếu thu');
    if (p.kind !== 'receipt') throw errors.conflict('not_a_receipt', 'Chỉ hoàn được phiếu thu.');
    if (p.amountVnd === 0) throw errors.conflict('nothing_to_refund', `Phiếu ${p.docNo} là 0 ₫, không có gì để hoàn.`);
    const [done] = await tx.select({ id: schema.libPayment.id }).from(schema.libPayment).where(eq(schema.libPayment.refundOf, p.id));
    if (done) throw errors.conflict('already_refunded', `Phiếu ${p.docNo} đã được hoàn trước đó.`);
    const now = ctx.clock.now();
    const docNo = await nextDocNo(tx, 'LIBP', now);
    const [r] = await tx
      .insert(schema.libPayment)
      .values({ docNo, kind: 'refund', customerId: p.customerId, method: p.method, amountVnd: -p.amountVnd, ref: p.ref, refundOf: p.id, reason: data.reason, receivedBy: actor.userId, receivedAt: now })
      .returning({ id: schema.libPayment.id });
    await tx.update(schema.libCharge).set({ status: 'unpaid', paymentId: null, paidAt: null }).where(eq(schema.libCharge.paymentId, p.id));
    await audit.record(tx, ctx, { action: 'library.payment.refund', entity: 'lib_payment', entityId: p.id, after: { refundDocNo: docNo, reason: data.reason, amountVnd: p.amountVnd } });
    return { id: r!.id, docNo, amountVnd: -p.amountVnd };
  });
}

export const PaymentsQuery = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  method: z.enum(LIB_PAYMENT_METHODS).optional(),
});

/** The cash book for a period, newest first, with totals by method (FR-LIB-09a). */
export async function listPayments(ctx: Ctx, input: z.input<typeof PaymentsQuery>) {
  requirePermission(ctx, 'library.lend');
  const q = PaymentsQuery.parse(input);
  const start = new Date(`${q.from}T00:00:00+07:00`);
  const end = new Date(new Date(`${q.to}T00:00:00+07:00`).getTime() + 86_400_000);
  const rows = await ctx.db.execute<{
    id: string;
    doc_no: string;
    kind: string;
    method: string;
    amount_vnd: string;
    ref: string | null;
    reason: string | null;
    received_at: Date | string;
    customer_id: string;
    customer_name: string;
    received_by: string | null;
    refunded: boolean;
    refund_of_no: string | null;
    items: string | null;
  }>(sql`
    select p.id, p.doc_no, p.kind, p.method, p.amount_vnd, p.ref, p.reason, p.received_at, p.customer_id, cu.name as customer_name, u.display_name as received_by,
           exists (select 1 from library.lib_payment r where r.refund_of = p.id) as refunded,
           (select o.doc_no from library.lib_payment o where o.id = p.refund_of) as refund_of_no,
           (select string_agg(case ch.kind when 'loan_fee' then 'Phí mượn' when 'late_fee' then 'Phí trả trễ' when 'lost' then 'Phí mất sách' else 'Phí hỏng sách' end
                   || coalesce(' ' || c.barcode, ''), ', ' order by ch.created_at)
              from library.lib_charge ch left join library.loan l on l.id = ch.loan_id left join library.lib_copy c on c.id = l.copy_id
             where ch.payment_id = coalesce(p.refund_of, p.id)) as items
    from library.lib_payment p join crm.customer cu on cu.id = p.customer_id left join platform.app_user u on u.id = p.received_by
    where p.received_at >= ${tsParam(start)} and p.received_at < ${tsParam(end)} ${q.method ? sql`and p.method = ${q.method}` : sql``}
    order by p.received_at desc, p.doc_no desc limit 500`);
  const items = rows.map((x) => ({
    id: x.id,
    docNo: x.doc_no,
    kind: x.kind,
    method: x.method,
    amountVnd: Number(x.amount_vnd),
    ref: x.ref,
    reason: x.reason,
    receivedAt: x.received_at,
    customerId: x.customer_id,
    customerName: x.customer_name,
    receivedBy: x.received_by,
    refunded: x.refunded,
    refundOfNo: x.refund_of_no,
    items: x.items,
  }));
  const totals = { cash: 0, transfer: 0, card: 0, all: 0 };
  for (const i of items) {
    totals[i.method as 'cash' | 'transfer' | 'card'] += i.amountVnd;
    totals.all += i.amountVnd;
  }
  return { from: q.from, to: q.to, items, totals };
}

// =============================================================================================
// Check-out, check-in, renewal, loss (FR-LIB-07, 08, 11, 12)

export const CheckoutSchema = z
  .object({
    customerId: z.uuid(),
    /** Loan fees are taken at the desk before the loans are recorded (FR-LIB-07, FR-LIB-09a); not needed for reservations only. */
    payment: PaymentSchema.optional(),
    /** Entered by hand; replaces the automatic buyer discount (FR-LIB-18). */
    discount: z
      .object({ kind: z.enum(['pct', 'vnd']), value: z.number().int().min(0) })
      .refine((d) => d.kind !== 'pct' || d.value <= 100, { message: 'Ưu đãi tối đa 100%.' })
      .optional(),
    barcodes: z
      .array(z.string().trim().min(1).max(40))
      .max(20)
      .default([])
      .refine((b) => new Set(b.map((x) => x.toUpperCase())).size === b.length, 'Mỗi cuốn chỉ quét một lần.'),
    /** Titles with no copy on the shelf, reserved on the same form (FR-LIB-13). */
    holdTitleIds: z
      .array(z.uuid())
      .max(20)
      .default([])
      .refine((t) => new Set(t).size === t.length, 'Mỗi đầu sách chỉ đặt giữ một lần.'),
  })
  .refine((d) => d.barcodes.length + d.holdTitleIds.length > 0, { message: 'Hãy thêm ít nhất một cuốn.', path: ['barcodes'] })
  .refine((d) => d.barcodes.length === 0 || !!d.payment, { message: 'Chọn phương thức thanh toán.', path: ['payment'] });

async function raiseCharge(tx: Tx, ctx: Ctx, v: { customerId: string; loanId: string | null; kind: 'loan_fee' | 'late_fee' | 'lost' | 'damage'; listVnd: number; discountPct?: number; amountVnd: number }) {
  if (v.amountVnd <= 0) return null;
  const [row] = await tx
    .insert(schema.libCharge)
    .values({ customerId: v.customerId, loanId: v.loanId, kind: v.kind, listVnd: v.listVnd, discountPct: v.discountPct ?? 0, amountVnd: v.amountVnd, createdAt: ctx.clock.now() })
    .returning({ id: schema.libCharge.id, amountVnd: schema.libCharge.amountVnd });
  return row!;
}

export async function checkout(ctx: Ctx, input: z.input<typeof CheckoutSchema>) {
  const actor = requirePermission(ctx, 'library.lend');
  const data = CheckoutSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const now = ctx.clock.now();
    const r = await rules(ctx, tx);
    // Lock the borrower so two desks cannot pass the loan limit together.
    const [cust] = await tx.select({ id: schema.customer.id, name: schema.customer.name }).from(schema.customer).where(eq(schema.customer.id, data.customerId)).for('update');
    if (!cust) throw errors.notFound('Khách hàng');
    const state = await borrowerState(tx, cust.id, now);
    // Reservations do not count toward the loan limit; it is checked when the copy is collected (FR-LIB-13).
    const blocks = borrowBlocks(state, r['library.max_loans'], data.barcodes.length).filter((b) => data.barcodes.length > 0 || b !== 'limit_reached');
    if (blocks.length) {
      throw new AppError(422, 'borrow_blocked', blocks.map((b) => BORROW_BLOCK_TEXT[b]).join(' '), { blocks, ...state, maxLoans: r['library.max_loans'] });
    }
    const locked = await tx
      .select()
      .from(schema.libCopy)
      .where(inArray(sql`replace(upper(${schema.libCopy.barcode}), '-', '')`, data.barcodes.map((b) => b.toUpperCase().replace(/-/g, ''))))
      .for('update');
    const titles = locked.length
      ? await tx.select({ id: schema.libTitle.id, title: schema.libTitle.title, callNo: schema.libTitle.callNo }).from(schema.libTitle).where(inArray(schema.libTitle.id, locked.map((c) => c.titleId)))
      : [];
    const titleOf = new Map(titles.map((t) => [t.id, t]));
    const byBarcode = new Map(locked.map((c) => [c.barcode.toUpperCase().replace(/-/g, ""), { c, title: titleOf.get(c.titleId)!.title, callNo: titleOf.get(c.titleId)!.callNo }]));
    const fee = loanFee(await lifetimeSpend(tx, cust.id), feeRules(r));
    if (data.discount?.kind === 'vnd' && data.discount.value > fee.listVnd * data.barcodes.length) {
      throw new AppError(422, 'discount_too_high', 'Ưu đãi không được lớn hơn phí mượn.');
    }
    const manual = data.discount ? discountedLoanFees(fee.listVnd, data.barcodes.length, data.discount) : null;
    const dueAt = dueAfter(now, r['library.loan_days']);
    const out = [];
    const feeIds: string[] = [];
    for (const b of data.barcodes) {
      const x = byBarcode.get(b.toUpperCase().replace(/-/g, ""));
      if (!x) throw new AppError(404, 'copy_not_found', `Không tìm thấy bản sách có mã ${b}.`, { barcode: b });
      const c = x.c;
      let hold: { id: string } | undefined;
      if (c.status === 'reserved') {
        [hold] = await tx
          .select({ id: schema.libReservation.id })
          .from(schema.libReservation)
          .where(and(eq(schema.libReservation.copyId, c.id), eq(schema.libReservation.status, 'held'), eq(schema.libReservation.customerId, cust.id)));
        if (!hold) throw errors.conflict('copy_held', `Bản ${c.barcode} đang được giữ cho khách khác.`, { barcode: c.barcode });
      } else if (c.status !== 'available') {
        throw errors.conflict('copy_not_available', `Bản ${c.barcode} không sẵn để cho mượn (${c.status === 'on_loan' ? 'đang được mượn' : c.status === 'lost' ? 'đã báo mất' : 'đang hỏng'}).`, { barcode: c.barcode, status: c.status });
      }
      const [loan] = await tx.insert(schema.loan).values({ copyId: c.id, customerId: cust.id, loanedAt: now, dueAt, createdBy: actor.userId }).returning({ id: schema.loan.id });
      await tx.update(schema.libCopy).set({ status: 'on_loan', updatedAt: now }).where(eq(schema.libCopy.id, c.id));
      if (hold) await tx.update(schema.libReservation).set({ status: 'collected' }).where(eq(schema.libReservation.id, hold.id));
      const i: number = out.length;
      const copyFee: { listVnd: number; discountPct: number; amountVnd: number } = manual ? { listVnd: fee.listVnd, discountPct: manual.discountPcts[i]!, amountVnd: manual.amounts[i]! } : fee;
      const ch = await raiseCharge(tx, ctx, { customerId: cust.id, loanId: loan!.id, kind: 'loan_fee', ...copyFee });
      if (ch) feeIds.push(ch.id);
      out.push({ loanId: loan!.id, barcode: c.barcode, callNo: x.callNo, title: x.title, dueAt, feeVnd: copyFee.amountVnd, listFeeVnd: fee.listVnd });
    }
    // Every check-out issues a receipt, 0 VND for a free loan; its number is the loan slip (FR-LIB-09a).
    const receipt = out.length ? await collect(tx, ctx, cust.id, feeIds, data.payment ?? { method: 'cash' }) : null;
    if (receipt) await tx.update(schema.loan).set({ slipId: receipt.id }).where(inArray(schema.loan.id, out.map((o) => o.loanId)));
    // Titles with no copy on the shelf are reserved on the same form (FR-LIB-13, UC-17 3b).
    const holds = [];
    for (const titleId of data.holdTitleIds) holds.push(await reserveTx(tx, ctx, actor.userId, titleId, cust.id));
    await audit.record(tx, ctx, { action: 'library.checkout', entity: 'customer', entityId: cust.id, after: { barcodes: out.map((o) => o.barcode), holds: holds.map((h) => h.callNo ?? h.title), dueAt, feeVnd: fee.amountVnd, discount: data.discount ?? null, receipt: receipt?.docNo } });
    return { customerId: cust.id, customerName: cust.name, dueAt, discountPct: fee.discountPct, loans: out, holds, totalFeeVnd: out.reduce((a, o) => a + o.feeVnd, 0), receiptNo: receipt?.docNo ?? null };
  });
}

/**
 * Where a copy goes when it comes back to the shelf: held for the first queued reservation of its
 * title (staff call that borrower from the hold, FR-LIB-13), otherwise available.
 */
async function placeReturnedCopy(tx: Tx, ctx: Ctx, copyId: string) {
  const [c] = await tx.select({ titleId: schema.libCopy.titleId }).from(schema.libCopy).where(eq(schema.libCopy.id, copyId));
  const [next] = await tx
    .select({ id: schema.libReservation.id, customerId: schema.libReservation.customerId })
    .from(schema.libReservation)
    .where(and(eq(schema.libReservation.titleId, c!.titleId), eq(schema.libReservation.status, 'queued')))
    .orderBy(asc(schema.libReservation.queuedAt), asc(schema.libReservation.id))
    .limit(1)
    .for('update', { skipLocked: true });
  if (!next) {
    await tx.update(schema.libCopy).set({ status: 'available', updatedAt: ctx.clock.now() }).where(eq(schema.libCopy.id, copyId));
    return null;
  }
  const days = (await rules(ctx, tx))['library.hold_days'];
  const holdUntil = dueAfter(ctx.clock.now(), days);
  await tx.update(schema.libReservation).set({ status: 'held', copyId, holdUntil }).where(eq(schema.libReservation.id, next.id));
  await tx.update(schema.libCopy).set({ status: 'reserved', updatedAt: ctx.clock.now() }).where(eq(schema.libCopy.id, copyId));
  const [cu] = await tx.select({ name: schema.customer.name, phone: schema.customer.phoneE164 }).from(schema.customer).where(eq(schema.customer.id, next.customerId));
  return { reservationId: next.id, customerName: cu!.name, customerPhone: cu!.phone, holdUntil };
}

export const CheckinSchema = z.object({
  barcode: z.string().trim().min(1).max(40),
  condition: z.enum(['ok', 'damaged']).default('ok'),
});

export async function checkin(ctx: Ctx, input: z.input<typeof CheckinSchema>) {
  const actor = requirePermission(ctx, 'library.lend');
  const data = CheckinSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const now = ctx.clock.now();
    const r = await rules(ctx, tx);
    const [l] = await tx.execute<LoanRow>(sql`
      select ${LOAN_ROW} from library.loan l
      join library.lib_copy c on c.id = l.copy_id join library.lib_title t on t.id = c.title_id join crm.customer cu on cu.id = l.customer_id
      where replace(upper(c.barcode), '-', '') = replace(upper(${data.barcode}), '-', '') and l.returned_at is null for update of l, c`).then((rows) => rows.map(fixLoan));
    if (!l) {
      const [c] = await tx.select({ id: schema.libCopy.id }).from(schema.libCopy).where(sql`replace(upper(${schema.libCopy.barcode}), '-', '') = replace(upper(${data.barcode}), '-', '')`);
      throw c ? errors.conflict('not_on_loan', `Bản ${data.barcode} không có lượt mượn nào đang mở.`) : new AppError(404, 'copy_not_found', `Không tìm thấy bản sách có mã ${data.barcode}.`);
    }
    const days = daysLate(l.due_at, now);
    const value = Number(l.value_vnd);
    const late = lateFee(l.due_at, now, value, lateRules(r));
    await tx
      .update(schema.loan)
      .set({ returnedAt: now, closedAs: 'returned', returnCondition: data.condition, closedBy: actor.userId })
      .where(eq(schema.loan.id, l.id));
    await raiseCharge(tx, ctx, { customerId: l.customer_id, loanId: l.id, kind: 'late_fee', listVnd: late, amountVnd: late });
    let damageVnd = 0;
    let hold = null;
    if (data.condition === 'damaged') {
      damageVnd = replacementCharge(value, r['library.lost_fee_vnd']);
      await raiseCharge(tx, ctx, { customerId: l.customer_id, loanId: l.id, kind: 'damage', listVnd: damageVnd, amountVnd: damageVnd });
      await tx.update(schema.libCopy).set({ status: 'damaged', updatedAt: now }).where(eq(schema.libCopy.id, l.copy_id));
    } else {
      hold = await placeReturnedCopy(tx, ctx, l.copy_id);
    }
    await emit(tx, 'loan.returned', { loanId: l.id, copyId: l.copy_id, customerId: l.customer_id });
    await audit.record(tx, ctx, { action: 'library.checkin', entity: 'loan', entityId: l.id, after: { condition: data.condition, daysLate: days, lateFeeVnd: late, damageVnd } });
    return {
      loanId: l.id,
      barcode: l.barcode,
      callNo: l.code,
      title: l.title,
      customerId: l.customer_id,
      customerName: l.customer_name,
      customerPhone: l.customer_phone,
      dueAt: l.due_at,
      daysLate: days,
      lateFeeVnd: late,
      damageVnd,
      hold,
    };
  });
}

async function lockOpenLoan(tx: Tx, loanId: string) {
  const [row] = await tx.execute<LoanRow>(sql`
    select ${LOAN_ROW} from library.loan l
    join library.lib_copy c on c.id = l.copy_id join library.lib_title t on t.id = c.title_id join crm.customer cu on cu.id = l.customer_id
    where l.id = ${loanId}::uuid for update of l, c`);
  if (!row) throw errors.notFound('Lượt mượn');
  const l = fixLoan(row);
  if (l.returned_at) throw errors.conflict('loan_closed', `Lượt mượn ${l.barcode} đã kết thúc.`);
  return l;
}

export const RenewSchema = z.object({ payment: PaymentSchema });

/** One more loan period for another loan fee, taken at the desk (FR-LIB-12, BR-13). */
export async function renew(ctx: Ctx, loanId: string, input: z.input<typeof RenewSchema>) {
  const actor = requirePermission(ctx, 'library.lend');
  const data = RenewSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const now = ctx.clock.now();
    const r = await rules(ctx, tx);
    const l = await lockOpenLoan(tx, loanId);
    if (l.renewals >= r['library.renewals']) throw errors.conflict('renewal_limit', `Cuốn này đã gia hạn ${l.renewals} lần, tối đa ${r['library.renewals']} lần.`);
    const [queued] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from library.lib_reservation where title_id = ${l.title_id}::uuid and status = 'queued' and customer_id <> ${l.customer_id}::uuid`);
    if (queued!.n > 0) throw errors.conflict('title_reserved', `“${l.title}” đang có khách khác đặt giữ, không gia hạn được.`);
    const state = await borrowerState(tx, l.customer_id, now);
    const blocks = borrowBlocks(state, r['library.max_loans'], 0);
    if (blocks.length) throw new AppError(422, 'borrow_blocked', blocks.map((b) => BORROW_BLOCK_TEXT[b]).join(' '), { blocks, ...state });
    const newDueAt = dueAfter(l.due_at, r['library.loan_days']);
    const fee = loanFee(await lifetimeSpend(tx, l.customer_id), feeRules(r));
    await tx.update(schema.loan).set({ dueAt: newDueAt, renewals: l.renewals + 1 }).where(eq(schema.loan.id, l.id));
    await tx.insert(schema.loanRenewal).values({ loanId: l.id, renewedAt: now, newDueAt, by: actor.userId });
    const ch = await raiseCharge(tx, ctx, { customerId: l.customer_id, loanId: l.id, kind: 'loan_fee', ...fee });
    const receipt = ch ? await collect(tx, ctx, l.customer_id, [ch.id], data.payment) : null;
    await audit.record(tx, ctx, { action: 'library.renew', entity: 'loan', entityId: l.id, after: { newDueAt, feeVnd: fee.amountVnd, receipt: receipt?.docNo } });
    return { loanId: l.id, dueAt: newDueAt, renewals: l.renewals + 1, feeVnd: fee.amountVnd, receiptNo: receipt?.docNo ?? null };
  });
}

/** The borrower reports the copy lost: replacement value plus processing fee (FR-LIB-11). */
export async function markLost(ctx: Ctx, loanId: string) {
  const actor = requirePermission(ctx, 'library.lend');
  return ctx.db.transaction(async (tx) => {
    const now = ctx.clock.now();
    const r = await rules(ctx, tx);
    const l = await lockOpenLoan(tx, loanId);
    const charge = replacementCharge(Number(l.value_vnd), r['library.lost_fee_vnd']);
    await tx.update(schema.loan).set({ returnedAt: now, closedAs: 'lost', closedBy: actor.userId }).where(eq(schema.loan.id, l.id));
    await tx.update(schema.libCopy).set({ status: 'lost', updatedAt: now }).where(eq(schema.libCopy.id, l.copy_id));
    await raiseCharge(tx, ctx, { customerId: l.customer_id, loanId: l.id, kind: 'lost', listVnd: charge, amountVnd: charge });
    await audit.record(tx, ctx, { action: 'library.lost', entity: 'loan', entityId: l.id, after: { chargeVnd: charge } });
    return { loanId: l.id, chargeVnd: charge };
  });
}

export const WaiveSchema = z.object({ reason: z.string().trim().min(1, 'Cần nhập lý do miễn phí.').max(500) });

export async function waiveCharge(ctx: Ctx, chargeId: string, input: z.input<typeof WaiveSchema>) {
  const actor = requirePermission(ctx, 'library.fine_waive');
  const data = WaiveSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [ch] = await tx.select().from(schema.libCharge).where(eq(schema.libCharge.id, chargeId)).for('update');
    if (!ch) throw errors.notFound('Khoản thu');
    if (ch.status !== 'unpaid') throw errors.conflict('charge_not_unpaid', 'Khoản này đã được thanh toán hoặc xử lý trước đó.');
    await tx.update(schema.libCharge).set({ status: 'waived', waivedBy: actor.userId, reason: data.reason }).where(eq(schema.libCharge.id, chargeId));
    await audit.record(tx, ctx, { action: 'library.charge.waive', entity: 'lib_charge', entityId: chargeId, before: { status: 'unpaid', amountVnd: ch.amountVnd }, after: { status: 'waived', reason: data.reason } });
    return { id: chargeId, status: 'waived' };
  });
}

// =============================================================================================
// POS sales from before 4 Nov 2026 that paid library charges

/** A voided sale gives its library charges back to the borrower as unpaid. */
export async function unpayForVoid(tx: Tx, saleId: string) {
  await tx.update(schema.libCharge).set({ status: 'unpaid', saleId: null, paidAt: null }).where(eq(schema.libCharge.saleId, saleId));
}

// =============================================================================================
// Reservations (FR-LIB-13)

async function reservationsOf(ctx: Ctx, where: SQL) {
  const rows = await ctx.db.execute<{
    id: string;
    title_id: string;
    code: string | null;
    title: string;
    customer_id: string;
    customer_name: string;
    customer_phone: string | null;
    status: string;
    queued_at: Date;
    hold_until: Date | null;
    barcode: string | null;
    position: number;
  }>(sql`
    select r.id, r.title_id, t.call_no as code, t.title, r.customer_id, cu.name as customer_name, cu.phone_e164 as customer_phone, r.status, r.queued_at, r.hold_until, c.barcode,
           (select count(*)::int from library.lib_reservation q where q.title_id = r.title_id and q.status = 'queued' and (q.queued_at, q.id) <= (r.queued_at, r.id)) as position
    from library.lib_reservation r join library.lib_title t on t.id = r.title_id join crm.customer cu on cu.id = r.customer_id
    left join library.lib_copy c on c.id = r.copy_id
    where ${where} order by r.status = 'held' desc, r.queued_at`);
  return rows.map((x) => ({
    id: x.id,
    titleId: x.title_id,
    callNo: x.code,
    title: x.title,
    customerId: x.customer_id,
    customerName: x.customer_name,
    customerPhone: x.customer_phone,
    status: x.status,
    queuedAt: x.queued_at,
    holdUntil: x.hold_until,
    barcode: x.barcode,
    position: x.status === 'queued' ? x.position : null,
  }));
}

export const ReserveSchema = z.object({ titleId: z.uuid(), customerId: z.uuid() });

export async function reserve(ctx: Ctx, input: z.input<typeof ReserveSchema>) {
  const actor = requirePermission(ctx, 'library.lend');
  const data = ReserveSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [cust] = await tx.select({ id: schema.customer.id }).from(schema.customer).where(eq(schema.customer.id, data.customerId)).for('update');
    if (!cust) throw errors.notFound('Khách hàng');
    // Borrowers with overdue loans or unpaid charges cannot reserve (FR-LIB-13).
    const blocks = borrowBlocks(await borrowerState(tx, cust.id, ctx.clock.now()), Number.MAX_SAFE_INTEGER, 0);
    if (blocks.length) throw new AppError(422, 'borrow_blocked', blocks.map((b) => BORROW_BLOCK_TEXT[b]).join(' '), { blocks });
    const h = await reserveTx(tx, ctx, actor.userId, data.titleId, cust.id);
    return { id: h.id, status: 'queued', position: h.position };
  });
}

/** Queue one reservation of a title with no copy on the shelf; the caller has checked the borrower. */
async function reserveTx(tx: Tx, ctx: Ctx, userId: string, titleId: string, customerId: string) {
  const data = { titleId, customerId };
  {
    const [t] = await tx.select({ id: schema.libTitle.id, title: schema.libTitle.title, callNo: schema.libTitle.callNo }).from(schema.libTitle).where(eq(schema.libTitle.id, data.titleId)).for('update');
    if (!t) throw errors.notFound('Đầu sách');
    const [avail] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from library.lib_copy where title_id = ${t.id}::uuid and status = 'available'`);
    if (avail!.n > 0) throw errors.conflict('title_available', `“${t.title}” đang có bản trên kệ, cho mượn luôn thay vì đặt giữ.`);
    const [mine] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from library.loan l join library.lib_copy c on c.id = l.copy_id where c.title_id = ${t.id}::uuid and l.customer_id = ${data.customerId}::uuid and l.returned_at is null`);
    if (mine!.n > 0) throw errors.conflict('already_borrowing', 'Khách đang mượn cuốn này.');
    const [dup] = await tx
      .select({ id: schema.libReservation.id })
      .from(schema.libReservation)
      .where(and(eq(schema.libReservation.titleId, t.id), eq(schema.libReservation.customerId, data.customerId), inArray(schema.libReservation.status, ['queued', 'held'])));
    if (dup) throw errors.conflict('already_reserved', 'Khách đã đặt giữ cuốn này.');
    const [row] = await tx
      .insert(schema.libReservation)
      .values({ titleId: t.id, customerId: data.customerId, queuedAt: ctx.clock.now(), createdBy: userId })
      .returning({ id: schema.libReservation.id });
    await audit.record(tx, ctx, { action: 'library.reserve', entity: 'lib_reservation', entityId: row!.id, after: data });
    const [pos] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from library.lib_reservation where title_id = ${t.id}::uuid and status = 'queued'`);
    return { id: row!.id, titleId: t.id, title: t.title, callNo: t.callNo, position: pos!.n };
  }
}

export async function cancelReservation(ctx: Ctx, id: string) {
  requirePermission(ctx, 'library.lend');
  return ctx.db.transaction(async (tx) => {
    const [res] = await tx.select().from(schema.libReservation).where(eq(schema.libReservation.id, id)).for('update');
    if (!res) throw errors.notFound('Lượt đặt giữ');
    if (res.status !== 'queued' && res.status !== 'held') throw errors.conflict('reservation_closed', 'Lượt đặt giữ đã kết thúc.');
    await tx.update(schema.libReservation).set({ status: 'cancelled' }).where(eq(schema.libReservation.id, id));
    if (res.status === 'held' && res.copyId) await placeReturnedCopy(tx, ctx, res.copyId);
    await audit.record(tx, ctx, { action: 'library.reservation.cancel', entity: 'lib_reservation', entityId: id });
    return { id, status: 'cancelled' };
  });
}

/** `library.reservation_expire` (hourly): uncollected holds expire; the copy goes to the next in line. */
export async function expireHolds(ctx: Ctx): Promise<number> {
  return ctx.db.transaction(async (tx) => {
    const r = schema.libReservation;
    const rows = await tx
      .update(r)
      .set({ status: 'expired' })
      .where(and(eq(r.status, 'held'), sql`${r.holdUntil} < ${tsParam(ctx.clock.now())}`))
      .returning({ copyId: r.copyId });
    for (const x of rows) if (x.copyId) await placeReturnedCopy(tx, ctx, x.copyId);
    return rows.length;
  });
}

// =============================================================================================
// Loan lists and the morning reminder (FR-LIB-14)

// =============================================================================================
// Loan slips (FR-LIB-09a): one row per check-out receipt, with its copies and every charge paid for them

export const SlipsQuery = z.object({
  filter: z.enum(['open', 'due_soon', 'overdue', 'returned', 'all']).default('open'),
  q: z.string().trim().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** Slips: loans grouped by slip; loans from before slips without a receipt are slips of their own. */
const SLIPS = sql`
  with s as (
    select coalesce(l.slip_id, l.id) as id, l.slip_id, l.customer_id,
           count(*)::int as copies,
           count(*) filter (where l.returned_at is null)::int as out,
           min(l.due_at) filter (where l.returned_at is null) as due_at,
           min(l.loaned_at) as loaned_at,
           (array_agg(l.created_by))[1] as created_by
    from library.loan l group by coalesce(l.slip_id, l.id), l.slip_id, l.customer_id
  )
  select s.id, s.slip_id, s.customer_id, s.copies, s.out, s.due_at, p.doc_no,
         coalesce(p.received_at, s.loaned_at) as created_at,
         coalesce(u.display_name, u2.display_name) as received_by,
         cu.name as customer_name, cu.phone_e164 as customer_phone, cu.search_text,
         (select coalesce(sum(ch.amount_vnd), 0) from library.lib_charge ch join library.loan l2 on l2.id = ch.loan_id
           where ch.status = 'paid' and coalesce(l2.slip_id, l2.id) = s.id) as amount_vnd
  from s
  join crm.customer cu on cu.id = s.customer_id
  left join library.lib_payment p on p.id = s.slip_id
  left join platform.app_user u on u.id = p.received_by
  left join platform.app_user u2 on u2.id = s.created_by`;

type SlipRow = {
  id: string;
  slip_id: string | null;
  customer_id: string;
  copies: number;
  out: number;
  due_at: Date | string | null;
  doc_no: string | null;
  created_at: Date | string;
  received_by: string | null;
  customer_name: string;
  customer_phone: string | null;
  amount_vnd: string;
};

const slipView = (s: SlipRow, now: Date) => {
  const dueAt = s.due_at ? asDate(s.due_at) : null;
  return {
    id: s.id,
    docNo: s.doc_no,
    customerId: s.customer_id,
    customerName: s.customer_name,
    customerPhone: s.customer_phone,
    copies: s.copies,
    out: s.out,
    amountVnd: Number(s.amount_vnd),
    dueAt,
    overdue: !!dueAt && isOverdue(dueAt, now),
    createdAt: asDate(s.created_at),
    receivedBy: s.received_by,
  };
};

export async function listSlips(ctx: Ctx, input: z.input<typeof SlipsQuery>) {
  requirePermission(ctx, 'library.lend');
  const q = SlipsQuery.parse(input);
  const now = ctx.clock.now();
  const r = await rules(ctx, ctx.db);
  const soon = dueAfter(now, r['library.remind_days']);
  const where: SQL[] = [];
  if (q.filter === 'open') where.push(sql`out > 0`);
  if (q.filter === 'returned') where.push(sql`out = 0`);
  if (q.filter === 'overdue') where.push(sql`due_at < ${tsParam(now)}`);
  if (q.filter === 'due_soon') where.push(sql`due_at >= ${tsParam(now)} and due_at <= ${tsParam(soon)}`);
  if (q.from) where.push(sql`created_at >= ${tsParam(new Date(`${q.from}T00:00:00+07:00`))}`);
  if (q.to) where.push(sql`created_at < ${tsParam(new Date(new Date(`${q.to}T00:00:00+07:00`).getTime() + 86_400_000))}`);
  if (q.q) {
    const folded = foldText(q.q);
    const digits = q.q.replace(/\D/g, '');
    where.push(sql`(upper(coalesce(doc_no, '')) like ${`%${q.q.toUpperCase()}%`} or search_text like ${`%${folded}%`}
      ${digits.length >= 4 ? sql`or customer_phone like ${`%${digits.slice(-9)}%`}` : sql``}
      or exists (select 1 from library.loan l join library.lib_copy c on c.id = l.copy_id join library.lib_title t on t.id = c.title_id
                 where coalesce(l.slip_id, l.id) = x.id and (t.search_text like ${`%${folded}%`} or replace(upper(c.barcode), '-', '') = replace(upper(${q.q}), '-', ''))))`);
  }
  const rows = await ctx.db.execute<SlipRow>(sql`select * from (${SLIPS}) x ${where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``} order by created_at desc, doc_no desc nulls last limit 300`);
  const [c] = await ctx.db.execute<{ open: number; due_soon: number; overdue: number; returned: number; all: number }>(sql`
    select count(*) filter (where out > 0)::int as open,
           count(*) filter (where due_at >= ${tsParam(now)} and due_at <= ${tsParam(soon)})::int as due_soon,
           count(*) filter (where due_at < ${tsParam(now)})::int as overdue,
           count(*) filter (where out = 0)::int as returned,
           count(*)::int as all
    from (${SLIPS}) x`);
  const [held] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from library.lib_reservation where status = 'held'`);
  return { counts: { open: c!.open, dueSoon: c!.due_soon, overdue: c!.overdue, returned: c!.returned, all: c!.all, held: held!.n }, items: rows.map((s) => slipView(s, now)) };
}

/** One slip: its copies, the receipts and refunds for them, and what is still owed (FR-LIB-09a). */
export async function getSlip(ctx: Ctx, id: string) {
  requirePermission(ctx, 'library.lend');
  const now = ctx.clock.now();
  const r = await rules(ctx, ctx.db);
  const [s] = await ctx.db.execute<SlipRow>(sql`select * from (${SLIPS}) x where id = ${id}::uuid`);
  if (!s) throw errors.notFound('Phiếu mượn');
  const loans = await ctx.db.execute<LoanRow>(sql`
    select ${LOAN_ROW} from library.loan l
    join library.lib_copy c on c.id = l.copy_id join library.lib_title t on t.id = c.title_id join crm.customer cu on cu.id = l.customer_id
    where coalesce(l.slip_id, l.id) = ${id}::uuid order by l.loaned_at, c.barcode`);
  const charges = await ctx.db.execute<{ id: string; kind: string; amount_vnd: number; status: string; payment_id: string | null; barcode: string }>(sql`
    select ch.id, ch.kind, ch.amount_vnd, ch.status, ch.payment_id, c.barcode from library.lib_charge ch
    join library.loan l on l.id = ch.loan_id join library.lib_copy c on c.id = l.copy_id
    where coalesce(l.slip_id, l.id) = ${id}::uuid order by ch.created_at`);
  const paidBy = [...new Set(charges.map((c) => c.payment_id).filter((x): x is string => !!x)), ...(s.slip_id ? [s.slip_id] : [])];
  const payments = paidBy.length
    ? await ctx.db.execute<{ id: string; doc_no: string; kind: string; method: string; amount_vnd: string; reason: string | null; received_at: Date | string; received_by: string | null; refund_of: string | null; refunded: boolean }>(sql`
        select p.id, p.doc_no, p.kind, p.method, p.amount_vnd, p.reason, p.received_at, u.display_name as received_by, p.refund_of,
               exists (select 1 from library.lib_payment x where x.refund_of = p.id) as refunded
        from library.lib_payment p left join platform.app_user u on u.id = p.received_by
        where p.id in (${sql.join(paidBy.map((x) => sql`${x}::uuid`), sql`, `)}) or p.refund_of in (${sql.join(paidBy.map((x) => sql`${x}::uuid`), sql`, `)})
        order by p.received_at, p.doc_no`)
    : [];
  const itemsOf = (paymentId: string) => {
    const mine = charges.filter((c) => c.payment_id === paymentId);
    if (!mine.length) return paymentId === s.slip_id ? 'Phiếu mượn' : null;
    const byKind = new Map<string, number>();
    for (const c of mine) byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
    return [...byKind].map(([k, n]) => `${CHARGE_TEXT[k] ?? k}${n > 1 ? ` ×${n}` : ''}`).join(', ');
  };
  return {
    ...slipView(s, now),
    loans: loans.map((l) => loanView(l, now, r)),
    payments: payments.map((p) => ({
      id: p.id,
      docNo: p.doc_no,
      kind: p.kind,
      method: p.method,
      amountVnd: Number(p.amount_vnd),
      reason: p.reason,
      receivedAt: asDate(p.received_at),
      receivedBy: p.received_by,
      refunded: p.refunded,
      items: p.kind === 'refund' ? null : itemsOf(p.id),
    })),
    owed: charges.filter((c) => c.status === 'unpaid').map((c) => ({ id: c.id, kind: c.kind, label: CHARGE_TEXT[c.kind] ?? c.kind, barcode: c.barcode, amountVnd: Number(c.amount_vnd) })),
  };
}

export const LoansQuery = z.object({
  filter: z.enum(['open', 'due_soon', 'overdue', 'held']).default('open'),
  q: z.string().trim().max(100).optional(),
});

export async function listLoans(ctx: Ctx, input: z.input<typeof LoansQuery>) {
  requirePermission(ctx, 'library.lend');
  const q = LoansQuery.parse(input);
  const now = ctx.clock.now();
  const r = await rules(ctx, ctx.db);
  const counts = await loanCounts(ctx, r);
  if (q.filter === 'held') {
    const search = q.q ? sql` and (cu.search_text like ${`%${foldText(q.q)}%`} or t.search_text like ${`%${foldText(q.q)}%`})` : sql``;
    return { counts, items: [], holds: await reservationsOf(ctx, sql`r.status = 'held'${search}`) };
  }
  const where: SQL[] = [sql`l.returned_at is null`];
  if (q.filter === 'overdue') where.push(sql`l.due_at < ${tsParam(now)}`);
  if (q.filter === 'due_soon') where.push(sql`l.due_at >= ${tsParam(now)} and l.due_at <= ${tsParam(dueAfter(now, r['library.remind_days']))}`);
  if (q.q) {
    const folded = foldText(q.q);
    const digits = q.q.replace(/\D/g, '');
    where.push(sql`(cu.search_text like ${`%${folded}%`} or t.search_text like ${`%${folded}%`} or replace(upper(c.barcode), '-', '') = replace(upper(${q.q}), '-', '') ${digits.length >= 4 ? sql`or cu.phone_e164 like ${`%${digits.slice(-9)}%`}` : sql``})`);
  }
  const rows = await ctx.db.execute<LoanRow>(sql`
    select ${LOAN_ROW} from library.loan l
    join library.lib_copy c on c.id = l.copy_id join library.lib_title t on t.id = c.title_id join crm.customer cu on cu.id = l.customer_id
    where ${sql.join(where, sql` and `)} order by l.due_at limit 300`);
  return { counts, items: rows.map((l) => loanView(l, now, r)), holds: [] };
}

async function loanCounts(ctx: Ctx, r: Rules) {
  const now = ctx.clock.now();
  const [c] = await ctx.db.execute<{ open: number; overdue: number; due_soon: number; held: number }>(sql`
    select count(*)::int as open,
           count(*) filter (where due_at < ${tsParam(now)})::int as overdue,
           count(*) filter (where due_at >= ${tsParam(now)} and due_at <= ${tsParam(dueAfter(now, r['library.remind_days']))})::int as due_soon,
           (select count(*)::int from library.lib_reservation where status = 'held') as held
    from library.loan where returned_at is null`);
  return { open: c!.open, overdue: c!.overdue, dueSoon: c!.due_soon, held: c!.held };
}

/** `library.reminders` (daily 08:00): one in-app notice to library staff; no email (FR-LIB-14, BR-25). */
export async function remindLoans(ctx: Ctx): Promise<{ dueSoon: number; overdue: number }> {
  const r = await rules(ctx, ctx.db);
  const c = await loanCounts(ctx, r);
  if (c.dueSoon + c.overdue > 0) {
    await ctx.db.transaction((tx) => notifications.notifyHolders(tx, 'library.lend', 'library.loans_to_call', { dueSoon: c.dueSoon, overdue: c.overdue }));
  }
  return { dueSoon: c.dueSoon, overdue: c.overdue };
}

// =============================================================================================
// Library report (FR-LIB-16, FR-RPT-07)

export const ReportSchema = z.object({ from: z.iso.date(), to: z.iso.date() });

export async function report(ctx: Ctx, input: z.input<typeof ReportSchema>) {
  requirePermission(ctx, 'report.view');
  const q = ReportSchema.parse(input);
  const start = new Date(`${q.from}T00:00:00+07:00`);
  const end = new Date(new Date(`${q.to}T00:00:00+07:00`).getTime() + 86_400_000);
  const now = ctx.clock.now();
  const inRange = (col: SQL) => sql`${col} >= ${tsParam(start)} and ${col} < ${tsParam(end)}`;
  const [s] = await ctx.db.execute<{ loans: number; renewals: number; returns: number; borrowers: number; open: number; overdue: number; fees: string; late: string; losses: string; waived: string }>(sql`
    select (select count(*)::int from library.loan where ${inRange(sql`loaned_at`)}) as loans,
           (select count(*)::int from library.loan_renewal where ${inRange(sql`renewed_at`)}) as renewals,
           (select count(*)::int from library.loan where ${inRange(sql`returned_at`)} and closed_as = 'returned') as returns,
           (select count(distinct customer_id)::int from library.loan where ${inRange(sql`loaned_at`)}) as borrowers,
           (select count(*)::int from library.loan where returned_at is null) as open,
           (select count(*)::int from library.loan where returned_at is null and due_at < ${tsParam(now)}) as overdue,
           (select coalesce(sum(amount_vnd), 0) from library.lib_charge where status = 'paid' and kind = 'loan_fee' and ${inRange(sql`paid_at`)}) as fees,
           (select coalesce(sum(amount_vnd), 0) from library.lib_charge where status = 'paid' and kind = 'late_fee' and ${inRange(sql`paid_at`)}) as late,
           (select coalesce(sum(amount_vnd), 0) from library.lib_charge where status = 'paid' and kind in ('lost', 'damage') and ${inRange(sql`paid_at`)}) as losses,
           (select coalesce(sum(amount_vnd), 0) from library.lib_charge where status = 'waived' and ${inRange(sql`created_at`)}) as waived`);
  const popular = await ctx.db.execute<{ callNo: string | null; title: string; loans: number }>(sql`
    select t.call_no as "callNo", t.title, count(*)::int as loans from library.loan l join library.lib_copy c on c.id = l.copy_id join library.lib_title t on t.id = c.title_id
    where ${inRange(sql`l.loaned_at`)} group by t.id order by loans desc, t.title limit 10`);
  const collection = await ctx.db.execute<{ language: string; status: string; n: number }>(sql`
    select t.language, c.status, count(*)::int as n from library.lib_copy c join library.lib_title t on t.id = c.title_id group by t.language, c.status order by t.language, c.status`);
  return {
    from: q.from,
    to: q.to,
    loans: s!.loans,
    renewals: s!.renewals,
    returns: s!.returns,
    borrowers: s!.borrowers,
    openLoans: s!.open,
    overdueLoans: s!.overdue,
    loanFeesVnd: Number(s!.fees),
    lateFeesVnd: Number(s!.late),
    lossChargesVnd: Number(s!.losses),
    waivedVnd: Number(s!.waived),
    popular,
    collection,
  };
}

/** Overdue loans for the dashboard (FR-RPT-01). */
/** Library overview now (FR-LIB-15a): copies in the collection (all but lost), available, open and overdue loans. */
/** Store days (UTC+7) from the start of the day, week (Monday) or month containing `now`, to today. */
export function overviewPeriod(period: 'day' | 'week' | 'month', now: Date) {
  const day = new Date(now.getTime() + 7 * 3600_000); // store wall clock, read with getUTC*
  const start = new Date(day);
  if (period === 'week') start.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  if (period === 'month') start.setUTCDate(1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(day) };
}

export async function overviewTx(ctx: Pick<Ctx, 'db' | 'crypto'>, tx: Tx, now: Date) {
  const period = (await settings.snapshot(ctx, tx))['library.overview_period'];
  const { from, to } = overviewPeriod(period, now);
  const start = new Date(`${from}T00:00:00+07:00`);
  const [r] = await tx.execute<{ copies: number; available: number; on_loan: number; overdue: number; collected: string }>(sql`
    select (select count(*)::int from library.lib_copy where status <> 'lost') as copies,
           (select count(*)::int from library.lib_copy where status = 'available') as available,
           (select count(*)::int from library.loan where returned_at is null) as on_loan,
           (select count(*)::int from library.loan where returned_at is null and due_at < ${tsParam(now)}) as overdue,
           (select coalesce(sum(amount_vnd), 0) from library.lib_payment where received_at >= ${tsParam(start)} and received_at <= ${tsParam(now)}) as collected`);
  // Receipts less refunds (refunds are negative) in the library cash book (FR-LIB-15a, FR-LIB-09a).
  return { copies: r!.copies, available: r!.available, collectedVnd: Number(r!.collected), period, from, to, onLoan: r!.on_loan, overdue: r!.overdue };
}

export async function overview(ctx: Ctx) {
  requireAny(ctx);
  return overviewTx(ctx, ctx.db, ctx.clock.now());
}

export async function overdueForDashboard(tx: Tx, now: Date) {
  const rows = await tx.execute<{ id: string; title: string; code: string | null; customer_name: string; customer_phone: string | null; due_at: Date }>(sql`
    select l.id, t.title, t.call_no as code, cu.name as customer_name, cu.phone_e164 as customer_phone, l.due_at from library.loan l
    join library.lib_copy c on c.id = l.copy_id join library.lib_title t on t.id = c.title_id join crm.customer cu on cu.id = l.customer_id
    where l.returned_at is null and l.due_at < ${tsParam(now)} order by l.due_at limit 10`);
  return rows.map((x) => ({ loanId: x.id, title: x.title, callNo: x.code, customerName: x.customer_name, customerPhone: x.customer_phone, dueAt: asDate(x.due_at), daysLate: daysLate(asDate(x.due_at), now) }));
}

