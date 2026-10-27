import { schema } from '@bookstore/db';
import { foldText } from '@bookstore/domain';
import { and, eq, sql } from 'drizzle-orm';
import * as inventory from '../inventory/index.js';
import { AppError, errors, requirePermission, type Ctx } from '../platform/index.js';
import { readTable, writeTable } from './parse.js';

/**
 * Count sheet (FR-INV-06, TDD §6.2): download the count lines as XLSX/CSV to count away from the
 * screen, then upload the filled sheet to set counted quantities by SKU in one transaction.
 */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const H_SKU = 'SKU';
const H_TITLE = 'Sản phẩm';
const H_EXPECTED = 'Hệ thống';
const H_COUNTED = 'Đếm được';

const csvCell = (v: string | number | null) => {
  const s = v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function countSheet(ctx: Ctx, id: string, format: 'xlsx' | 'csv') {
  const count = await inventory.getCount(ctx, id);
  // Blind counts keep expected quantities out of the sheet unless the user may approve (TDD §4.2).
  const showExpected = count.lines.length ? 'expected' in count.lines[0]! : !count.blind;
  const header = [H_SKU, H_TITLE, ...(showExpected ? [H_EXPECTED] : []), H_COUNTED];
  const rows = count.lines.map((l) => [l.sku, l.title, ...(showExpected ? [(l as { expected?: number }).expected ?? null] : []), l.counted]);
  const base = `phieu-dem-${count.docNo}`;
  if (format === 'csv') {
    const text = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    // BOM so Excel opens the Vietnamese text as UTF-8.
    return { bytes: new TextEncoder().encode('\uFEFF' + text), mime: 'text/csv; charset=utf-8', filename: `${base}.csv` };
  }
  const note = `Phiếu đếm ${count.docNo}\nĐiền số đếm vào cột “${H_COUNTED}”, để trống những dòng chưa đếm.\nKhông đổi cột SKU. Tải tệp này lên lại ở trang phiếu kiểm.`;
  return { bytes: await writeTable('Phieu dem', header, rows, note), mime: XLSX, filename: `${base}.xlsx` };
}

export async function uploadCountSheet(ctx: Ctx, id: string, file: { bytes: Uint8Array; mime: string }) {
  requirePermission(ctx, 'inventory.count');
  if (file.mime !== XLSX && file.mime !== 'text/csv') throw new AppError(415, 'unsupported_file_type', 'Chỉ nhận tệp Excel (.xlsx) hoặc CSV.');
  const table = await readTable(file.bytes, file.mime);
  const [head, ...body] = table;
  const col = (name: string) => (head ?? []).findIndex((h) => foldText(h.replace(/^\uFEFF/, '')) === foldText(name));
  const iSku = col(H_SKU);
  const iCounted = col(H_COUNTED);
  if (iSku < 0 || iCounted < 0) throw new AppError(400, 'count_sheet_columns', `Tệp cần có cột “${H_SKU}” và “${H_COUNTED}”. Hãy dùng phiếu đếm tải từ hệ thống.`);

  return ctx.db.transaction(async (tx) => {
    const [count] = await tx.select().from(schema.stockCount).where(eq(schema.stockCount.id, id)).for('update');
    if (!count) throw errors.notFound('Phiếu kiểm kho');
    if (count.status !== 'open') throw errors.conflict('count_not_open', 'Phiếu kiểm kho đã nộp, không thể đếm thêm.');
    const lines = await tx
      .select({ variantId: schema.stockCountLine.variantId, sku: schema.itemVariant.sku })
      .from(schema.stockCountLine)
      .innerJoin(schema.itemVariant, eq(schema.itemVariant.id, schema.stockCountLine.variantId))
      .where(eq(schema.stockCountLine.countId, id));
    const bySku = new Map(lines.map((l) => [l.sku.trim().toUpperCase(), l.variantId]));
    const errorsFound: { row: number; sku: string; message: string }[] = [];
    const updates: { variantId: string; counted: number }[] = [];
    body.forEach((r, i) => {
      const rowNo = i + 2;
      const sku = (r[iSku] ?? '').trim();
      const raw = (r[iCounted] ?? '').trim();
      if (!sku && !raw) return;
      if (raw === '') return; // not counted yet
      const variantId = bySku.get(sku.toUpperCase());
      if (!variantId) return void errorsFound.push({ row: rowNo, sku, message: 'SKU không có trong phiếu kiểm này.' });
      const n = Number(raw.replace(/[.\s]/g, '').replace(',', '.'));
      if (!Number.isInteger(n) || n < 0) return void errorsFound.push({ row: rowNo, sku, message: `Số đếm “${raw}” không hợp lệ (cần số nguyên ≥ 0).` });
      updates.push({ variantId, counted: n });
    });
    if (errorsFound.length) throw new AppError(422, 'count_sheet_invalid', `Có ${errorsFound.length} dòng lỗi, chưa lưu số đếm nào. Sửa tệp rồi tải lên lại.`, { rows: errorsFound.slice(0, 50) });
    const now = ctx.clock.now();
    for (const u of updates) {
      await tx
        .update(schema.stockCountLine)
        .set({ counted: u.counted, updatedAt: now })
        .where(and(eq(schema.stockCountLine.countId, id), eq(schema.stockCountLine.variantId, u.variantId)));
    }
    const [{ counted }] = (await tx.execute<{ counted: number }>(sql`select count(*)::int as counted from inventory.stock_count_line where count_id = ${id}::uuid and counted is not null`)) as unknown as [{ counted: number }];
    return { updated: updates.length, counted, lines: lines.length };
  });
}
