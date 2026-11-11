import { schema } from '@bookstore/db';
import { canTransition, foldText, LIB_LANGUAGES, STOCK_COUNT } from '@bookstore/domain';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import { readTable, writeTable } from '../imports/index.js';
import { AppError, can, errors, nextDocNo, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/**
 * Library counts (FR-LIB-04, TDD §4.8), modelled on stock counts: a session snapshots the copies
 * expected on the shelf in scope; copies are marked found by scanning, on screen (up to 50 lines)
 * or through the count sheet; submit, approve or cancel. Approval only closes the variance report.
 */

/** Above this many copies, results come from scanning or the count sheet (as FR-INV-06). */
export const LIB_COUNT_MARK_LIMIT = 50;

const ON_SHELF = ['available', 'reserved'];

export const CreateLibCountSchema = z.object({
  shelves: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
  languages: z.array(z.enum(LIB_LANGUAGES)).max(2).default([]),
  categories: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  blind: z.boolean().default(false),
});

/** Shelves and categories in use, for the create form. */
export async function scopeOptions(ctx: Ctx) {
  requirePermission(ctx, 'library.count');
  const shelves = await ctx.db.execute<{ shelf: string; n: number }>(sql`select shelf, count(*)::int as n from library.lib_copy where shelf is not null group by shelf order by shelf`);
  const categories = await ctx.db.execute<{ category: string }>(sql`select distinct category from library.lib_title where category is not null order by category`);
  return { shelves: shelves.map((s) => ({ shelf: s.shelf, copies: s.n })), categories: categories.map((c) => c.category) };
}

export async function createCount(ctx: Ctx, input: z.input<typeof CreateLibCountSchema>) {
  const actor = requirePermission(ctx, 'library.count');
  const data = CreateLibCountSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'LCNT', ctx.clock.now());
    const scope = { shelves: data.shelves, languages: data.languages, categories: data.categories };
    const [count] = await tx.insert(schema.libCount).values({ docNo, scope, blind: data.blind, createdBy: actor.userId, createdAt: ctx.clock.now() }).returning({ id: schema.libCount.id });
    const list = (values: string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);
    const where: SQL[] = [sql`c.status in ('available', 'reserved')`];
    if (data.shelves.length) where.push(sql`c.shelf in (${list(data.shelves)})`);
    if (data.languages.length) where.push(sql`t.language in (${list(data.languages)})`);
    if (data.categories.length) where.push(sql`t.category in (${list(data.categories)})`);
    // Snapshot the copies expected on the shelf.
    await tx.execute(sql`
      insert into library.lib_count_line (count_id, copy_id, expected_shelf, expected_status)
      select ${count!.id}::uuid, c.id, c.shelf, c.status from library.lib_copy c join library.lib_title t on t.id = c.title_id
      where ${sql.join(where, sql` and `)}`);
    await audit.record(tx, ctx, { action: 'library.count.create', entity: 'lib_count', entityId: count!.id, after: { docNo, scope, blind: data.blind } });
    return { id: count!.id, docNo };
  });
}

export const LibCountsQuery = z.object({
  status: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export async function listCounts(ctx: Ctx, input: z.input<typeof LibCountsQuery>) {
  requirePermission(ctx, 'library.count');
  const q = LibCountsQuery.parse(input);
  const c = schema.libCount;
  const where: SQL[] = [];
  const statuses = q.status?.split(',').filter(Boolean);
  if (statuses?.length) where.push(inArray(c.status, statuses));
  if (q.from) where.push(sql`${c.createdAt} >= ${q.from}::timestamptz`);
  if (q.to) where.push(sql`${c.createdAt} <= ${q.to}::timestamptz`);
  const term = foldText(q.q ?? '').trim();
  if (term) where.push(sql`(lower(${c.docNo}) like ${`%${term}%`} or lower(public.f_unaccent(coalesce(${schema.appUser.displayName}, ''))) like ${`%${term}%`})`);
  return ctx.db
    .select({
      id: c.id,
      docNo: c.docNo,
      scope: c.scope,
      blind: c.blind,
      status: c.status,
      createdAt: c.createdAt,
      approvedAt: c.approvedAt,
      createdBy: schema.appUser.displayName,
      // Qualified by hand: inside a select subquery the count's columns render unqualified.
      lines: sql<number>`(select count(*)::int from library.lib_count_line l where l.count_id = library.lib_count.id and l.in_scope)`,
      found: sql<number>`(select count(*)::int from library.lib_count_line l where l.count_id = library.lib_count.id and l.in_scope and l.found)`,
      checked: sql<number>`(select count(*)::int from library.lib_count_line l where l.count_id = library.lib_count.id and l.in_scope and l.found is not null)`,
    })
    .from(c)
    .leftJoin(schema.appUser, eq(schema.appUser.id, c.createdBy))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(c.createdAt))
    .limit(100);
}

/** What a line means for the variance report. */
function outcome(l: { inScope: boolean; found: boolean | null; currentStatus: string; currentShelf: string | null; expectedShelf: string | null }) {
  if (!l.inScope) return ON_SHELF.includes(l.currentStatus) ? 'out_of_scope' : `found_${l.currentStatus}`;
  if (l.found === null) return 'unchecked';
  if (!l.found) return 'missing';
  return 'ok';
}

/** Blind sessions hide the system status from counters without the approve permission. */
export async function getCount(ctx: Ctx, id: string) {
  requirePermission(ctx, 'library.count');
  const [count] = await ctx.db.select().from(schema.libCount).where(eq(schema.libCount.id, id));
  if (!count) throw errors.notFound('Phiếu kiểm kê');
  const showStatus = !count.blind || can(ctx.actor, 'library.count_approve');
  const l = schema.libCountLine;
  const rows = await ctx.db
    .select({
      copyId: l.copyId,
      barcode: schema.libCopy.barcode,
      title: schema.libTitle.title,
      callNo: schema.libTitle.callNo,
      inScope: l.inScope,
      expectedShelf: l.expectedShelf,
      expectedStatus: l.expectedStatus,
      currentShelf: schema.libCopy.shelf,
      currentStatus: schema.libCopy.status,
      found: l.found,
      checkedAt: l.checkedAt,
    })
    .from(l)
    .innerJoin(schema.libCopy, eq(schema.libCopy.id, l.copyId))
    .innerJoin(schema.libTitle, eq(schema.libTitle.id, schema.libCopy.titleId))
    .where(eq(l.countId, id))
    .orderBy(asc(schema.libCopy.barcode));
  const lines = rows.map((r) => {
    const o = outcome(r);
    return {
      copyId: r.copyId,
      barcode: r.barcode,
      title: r.title,
      callNo: r.callNo,
      inScope: r.inScope,
      shelf: r.inScope ? r.expectedShelf : r.currentShelf,
      found: r.found,
      checkedAt: r.checkedAt,
      // Out-of-scope lines always say why they are listed; blind hides the status of the snapshot.
      ...((showStatus || !r.inScope) && { status: r.inScope ? r.expectedStatus : r.currentStatus, outcome: o }),
    };
  });
  const inScope = rows.filter((r) => r.inScope);
  return {
    ...count,
    markLimit: LIB_COUNT_MARK_LIMIT,
    summary: {
      lines: inScope.length,
      found: inScope.filter((r) => r.found).length,
      missing: inScope.filter((r) => r.found === false).length,
      unchecked: inScope.filter((r) => r.found === null).length,
      outOfScope: rows.filter((r) => !r.inScope).length,
    },
    lines,
  };
}

async function lockOpen(tx: Tx, id: string) {
  const [count] = await tx.select().from(schema.libCount).where(eq(schema.libCount.id, id)).for('update');
  if (!count) throw errors.notFound('Phiếu kiểm kê');
  if (count.status !== 'open') throw errors.conflict('count_not_open', 'Phiếu kiểm kê đã gửi duyệt hoặc đã đóng, không thể kiểm thêm.');
  return count;
}

export const ScanSchema = z.object({ barcode: z.string().trim().min(1).max(40) });

/** A scanned label: the copy is found; a copy outside the snapshot is added out of scope. */
export async function scan(ctx: Ctx, id: string, input: z.input<typeof ScanSchema>) {
  const actor = requirePermission(ctx, 'library.count');
  const data = ScanSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    await lockOpen(tx, id);
    const [copy] = await tx
      .select({ id: schema.libCopy.id, barcode: schema.libCopy.barcode, status: schema.libCopy.status, shelf: schema.libCopy.shelf, title: schema.libTitle.title })
      .from(schema.libCopy)
      .innerJoin(schema.libTitle, eq(schema.libTitle.id, schema.libCopy.titleId))
      .where(sql`replace(upper(${schema.libCopy.barcode}), '-', '') = replace(upper(${data.barcode}), '-', '')`);
    if (!copy) throw new AppError(404, 'copy_not_found', `Không tìm thấy bản sách có mã ${data.barcode}.`, { barcode: data.barcode });
    const now = ctx.clock.now();
    const l = schema.libCountLine;
    const [line] = await tx
      .update(l)
      .set({ found: true, checkedAt: now, checkedBy: actor.userId })
      .where(and(eq(l.countId, id), eq(l.copyId, copy.id)))
      .returning({ inScope: l.inScope });
    if (line) return { barcode: copy.barcode, title: copy.title, inScope: line.inScope };
    await tx.insert(l).values({ countId: id, copyId: copy.id, inScope: false, expectedShelf: copy.shelf, expectedStatus: copy.status, found: true, checkedAt: now, checkedBy: actor.userId });
    return { barcode: copy.barcode, title: copy.title, inScope: false };
  });
}

export const MarkSchema = z.object({ copyId: z.uuid(), found: z.boolean().nullable() });

/** Marked on the count screen, for counts of up to 50 copies (as FR-INV-06). */
export async function mark(ctx: Ctx, id: string, input: z.input<typeof MarkSchema>) {
  const actor = requirePermission(ctx, 'library.count');
  const data = MarkSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    await lockOpen(tx, id);
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from library.lib_count_line where count_id = ${id}::uuid and in_scope`)) as unknown as [{ n: number }];
    if (n > LIB_COUNT_MARK_LIMIT) throw errors.conflict('count_sheet_required', `Phiếu có hơn ${LIB_COUNT_MARK_LIMIT} bản sách: hãy quét mã hoặc dùng phiếu đếm.`);
    const l = schema.libCountLine;
    const [line] = await tx
      .update(l)
      .set({ found: data.found, checkedAt: data.found === null ? null : ctx.clock.now(), checkedBy: data.found === null ? null : actor.userId })
      .where(and(eq(l.countId, id), eq(l.copyId, data.copyId), eq(l.inScope, true)))
      .returning({ copyId: l.copyId });
    if (!line) throw errors.notFound('Bản sách trong phiếu');
    return { copyId: data.copyId, found: data.found };
  });
}

// ---------------------------------------------------------------------------------------------
// Count sheet (as FR-INV-06): one row per copy in scope, column “Có mặt” = 1 or 0.

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const H_BARCODE = 'Mã bản';
const H_TITLE = 'Tên sách';
const H_SHELF = 'Kệ';
const H_STATUS = 'Trạng thái hệ thống';
const H_FOUND = 'Có mặt';
const STATUS_TEXT: Record<string, string> = { available: 'Còn', reserved: 'Đã giữ', on_loan: 'Đang mượn', lost: 'Mất', damaged: 'Hỏng' };

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function countSheet(ctx: Ctx, id: string, format: 'xlsx' | 'csv') {
  const count = await getCount(ctx, id);
  const lines = count.lines.filter((l) => l.inScope);
  const showStatus = lines.some((l) => 'status' in l);
  const header = [H_BARCODE, H_TITLE, H_SHELF, ...(showStatus ? [H_STATUS] : []), H_FOUND];
  const rows = lines.map((l) => [l.barcode, l.title, l.shelf, ...(showStatus ? [STATUS_TEXT[(l as { status?: string }).status ?? ''] ?? ''] : []), l.found === null ? null : l.found ? 1 : 0]);
  const base = `phieu-kiem-ke-${count.docNo}`;
  if (format === 'csv') {
    const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    return { bytes: new TextEncoder().encode('﻿' + text), mime: 'text/csv; charset=utf-8', filename: `${base}.csv` };
  }
  const note = `Phiếu kiểm kê ${count.docNo}\nĐiền 1 vào cột “${H_FOUND}” nếu thấy sách trên kệ, 0 nếu không thấy; để trống nếu chưa kiểm.\nKhông đổi cột “${H_BARCODE}”. Tải tệp này lên lại ở trang phiếu kiểm kê.`;
  return { bytes: await writeTable('Phieu kiem ke', header, rows, note), mime: XLSX, filename: `${base}.xlsx` };
}

export async function uploadCountSheet(ctx: Ctx, id: string, file: { bytes: Uint8Array; mime: string }) {
  const actor = requirePermission(ctx, 'library.count');
  if (file.mime !== XLSX && file.mime !== 'text/csv') throw new AppError(415, 'unsupported_file_type', 'Chỉ nhận tệp Excel (.xlsx) hoặc CSV.');
  const [head, ...body] = await readTable(file.bytes, file.mime);
  const col = (name: string) => (head ?? []).findIndex((h) => foldText(h.replace(/^\uFEFF/, '')) === foldText(name));
  const iBarcode = col(H_BARCODE);
  const iFound = col(H_FOUND);
  if (iBarcode < 0 || iFound < 0) throw new AppError(400, 'count_sheet_columns', `Tệp cần có cột “${H_BARCODE}” và “${H_FOUND}”. Hãy dùng phiếu đếm tải từ hệ thống.`);
  return ctx.db.transaction(async (tx) => {
    await lockOpen(tx, id);
    const lines = await tx
      .select({ copyId: schema.libCountLine.copyId, barcode: schema.libCopy.barcode })
      .from(schema.libCountLine)
      .innerJoin(schema.libCopy, eq(schema.libCopy.id, schema.libCountLine.copyId))
      .where(and(eq(schema.libCountLine.countId, id), eq(schema.libCountLine.inScope, true)));
    const byBarcode = new Map(lines.map((l) => [l.barcode.toUpperCase(), l.copyId]));
    const bad: { row: number; barcode: string; message: string }[] = [];
    const updates: { copyId: string; found: boolean }[] = [];
    body.forEach((r, i) => {
      const barcode = (r[iBarcode] ?? '').trim();
      const raw = (r[iFound] ?? '').trim();
      if (!raw) return;
      const copyId = byBarcode.get(barcode.toUpperCase());
      if (!copyId) return void bad.push({ row: i + 2, barcode, message: 'Mã bản không có trong phiếu kiểm kê này.' });
      if (raw !== '1' && raw !== '0') return void bad.push({ row: i + 2, barcode, message: `“${raw}” không hợp lệ (điền 1 hoặc 0).` });
      updates.push({ copyId, found: raw === '1' });
    });
    if (bad.length) throw new AppError(422, 'count_sheet_invalid', `Có ${bad.length} dòng lỗi, chưa lưu kết quả nào. Sửa tệp rồi tải lên lại.`, { rows: bad.slice(0, 50) });
    const now = ctx.clock.now();
    for (const u of updates) {
      await tx
        .update(schema.libCountLine)
        .set({ found: u.found, checkedAt: now, checkedBy: actor.userId })
        .where(and(eq(schema.libCountLine.countId, id), eq(schema.libCountLine.copyId, u.copyId)));
    }
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from library.lib_count_line where count_id = ${id}::uuid and in_scope and found is not null`)) as unknown as [{ n: number }];
    return { updated: updates.length, checked: n };
  });
}

// ---------------------------------------------------------------------------------------------
// Submit, cancel, approve

async function transition(tx: Tx, id: string, to: 'submitted' | 'approved' | 'cancelled') {
  const [count] = await tx.select().from(schema.libCount).where(eq(schema.libCount.id, id)).for('update');
  if (!count) throw errors.notFound('Phiếu kiểm kê');
  if (!canTransition(STOCK_COUNT, count.status as keyof typeof STOCK_COUNT, to)) throw errors.conflict('invalid_transition', 'Không thể chuyển phiếu kiểm kê sang trạng thái này.');
  return count;
}

export async function submitCount(ctx: Ctx, id: string) {
  requirePermission(ctx, 'library.count');
  await ctx.db.transaction(async (tx) => {
    await transition(tx, id, 'submitted');
    await tx.update(schema.libCount).set({ status: 'submitted' }).where(eq(schema.libCount.id, id));
  });
}

export async function cancelCount(ctx: Ctx, id: string) {
  requirePermission(ctx, 'library.count');
  await ctx.db.transaction(async (tx) => {
    const count = await transition(tx, id, 'cancelled');
    await tx.update(schema.libCount).set({ status: 'cancelled' }).where(eq(schema.libCount.id, id));
    await audit.record(tx, ctx, { action: 'library.count.cancel', entity: 'lib_count', entityId: id, after: { docNo: count.docNo } });
  });
}

/** Approval closes the variance report; no copy status or shelf changes (FR-LIB-04). */
export async function approveCount(ctx: Ctx, id: string) {
  const actor = requirePermission(ctx, 'library.count_approve');
  return ctx.db.transaction(async (tx) => {
    const count = await transition(tx, id, 'approved');
    const now = ctx.clock.now();
    await tx.update(schema.libCount).set({ status: 'approved', approvedBy: actor.userId, approvedAt: now }).where(eq(schema.libCount.id, id));
    await audit.record(tx, ctx, { action: 'library.count.approve', entity: 'lib_count', entityId: id, after: { docNo: count.docNo } });
    return { id, status: 'approved', approvedAt: now };
  });
}
