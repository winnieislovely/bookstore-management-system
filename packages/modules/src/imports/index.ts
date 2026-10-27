import { schema } from '@bookstore/db';
import { foldText, isMarginTooLow, netOfVat, normalizeIsbn, normalizePhone, parseVnd, vnd, type Permission } from '@bookstore/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as catalog from '../catalog/index.js';
import * as customers from '../customers/index.js';
import * as inventory from '../inventory/index.js';
import * as purchasing from '../purchasing/index.js';
import * as settings from '../settings/index.js';
import { AppError, can, errors, requirePermission, type Ctx, type Tx } from '../platform/index.js';
import { readTable, writeTable } from './parse.js';

/**
 * Staged importer (FR-ADM-07, FR-CAT-11, FR-PUR-14, FR-CRM-09, TDD §4.12):
 * upload → map columns → validate → preview → commit (all rows or none).
 * Rows are re-validated at commit, so data changed since the preview cannot slip through.
 */

export const IMPORT_KINDS = ['products', 'stock_in', 'customers'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

const PERMISSION: Record<ImportKind, Permission> = { products: 'catalog.import', stock_in: 'catalog.import', customers: 'data.import' };

interface Field {
  key: string;
  /** Template header (Vietnamese staff UI). */
  label: string;
  aliases: string[];
  example: string;
  hint?: string;
}

const F = (key: string, label: string, aliases: string[], example: string, hint?: string): Field => ({ key, label, aliases, example, ...(hint && { hint }) });

const COMMON_PRODUCT = {
  sku: F('sku', 'SKU', ['sku', 'ma sku', 'ma hang'], 'SACH-NNA-0012', 'Bắt buộc. Mã của cửa hàng, khác ISBN.'),
  isbn: F('isbn', 'ISBN', ['isbn', 'isbn13', 'isbn 13'], '9786041234567', 'Không bắt buộc. Cột riêng, không dùng làm SKU.'),
  itemType: F('item_type', 'Loại hàng', ['loai hang', 'loai', 'item type', 'item'], 'Sách', 'Sách / Văn phòng phẩm / Khác.'),
  name: F('name', 'Tên sản phẩm', ['ten san pham', 'ten', 'product name', 'name'], 'Cho Toi Xin Mot Ve Di Tuoi Tho', 'Tên tiếng Anh (bắt buộc với sản phẩm mới).'),
  description: F('description', 'Mô tả', ['mo ta', 'description'], 'A novel by Nguyen Nhat Anh.', 'Mô tả tiếng Anh (bắt buộc với sản phẩm mới).'),
  category: F('category', 'Danh mục', ['danh muc', 'category'], 'Children', 'Tên hoặc đường dẫn của danh mục đã có.'),
  cost: F('cost', 'Giá nhập', ['gia nhap', 'cost', 'cost price', 'gia von'], '50000'),
  price: F('price', 'Giá bán', ['gia ban', 'price', 'selling price'], '98000', 'Đã gồm VAT.'),
  weight: F('weight', 'Khối lượng (g)', ['khoi luong (g)', 'khoi luong', 'weight (g)', 'weight'], '250'),
  vat: F('vat', 'Thuế VAT (%)', ['thue vat (%)', 'vat (%)', 'vat', 'thue suat', 'thue'], '0', '0, 5, 8 hoặc 10.'),
};

const FIELDS: Record<ImportKind, Field[]> = {
  stock_in: [
    COMMON_PRODUCT.sku,
    COMMON_PRODUCT.isbn,
    COMMON_PRODUCT.itemType,
    COMMON_PRODUCT.name,
    COMMON_PRODUCT.description,
    COMMON_PRODUCT.category,
    F('supplier', 'Nhà cung cấp', ['nha cung cap', 'supplier', 'ncc'], 'Fahasa', 'Một nhà cung cấp cho cả tệp.'),
    COMMON_PRODUCT.cost,
    COMMON_PRODUCT.price,
    COMMON_PRODUCT.weight,
    F('qty', 'Số lượng', ['so luong', 'quantity', 'qty', 'sl'], '10'),
    COMMON_PRODUCT.vat,
    F('invoice_no', 'Số hóa đơn NCC', ['so hoa don ncc', 'so hoa don', 'invoice no', 'supplier invoice'], 'HD-0001'),
    F('note', 'Ghi chú', ['ghi chu', 'note'], ''),
  ],
  products: [
    COMMON_PRODUCT.sku,
    COMMON_PRODUCT.isbn,
    COMMON_PRODUCT.itemType,
    COMMON_PRODUCT.name,
    F('name_vi', 'Tên tiếng Việt', ['ten tieng viet', 'name vi', 'name (vi)'], 'Cho tôi xin một vé đi tuổi thơ', 'Không bắt buộc.'),
    COMMON_PRODUCT.description,
    COMMON_PRODUCT.category,
    F('authors', 'Tác giả', ['tac gia', 'authors', 'author'], 'Nguyễn Nhật Ánh', 'Nhiều tác giả cách nhau bằng dấu ;'),
    F('publisher', 'Nhà xuất bản', ['nha xuat ban', 'nxb', 'publisher'], 'NXB Trẻ', 'Tên nhà xuất bản đã có.'),
    COMMON_PRODUCT.price,
    COMMON_PRODUCT.cost,
    COMMON_PRODUCT.vat,
    COMMON_PRODUCT.weight,
    F('opening_qty', 'Tồn đầu kỳ', ['ton dau ky', 'ton dau', 'opening stock', 'opening qty'], '10', 'Cần giá nhập nếu lớn hơn 0.'),
    F('min_stock', 'Tồn tối thiểu', ['ton toi thieu', 'min stock'], '3'),
  ],
  customers: [
    F('name', 'Họ tên', ['ho ten', 'ten khach hang', 'ten', 'name'], 'Trần Thị B'),
    F('phone', 'Số điện thoại', ['so dien thoai', 'sdt', 'dien thoai', 'phone'], '0912345678'),
    F('email', 'Email', ['email', 'e-mail'], 'b@example.com'),
    F('birth_date', 'Ngày sinh', ['ngay sinh', 'birth date', 'birthday'], '24/10/1990', 'dd/MM/yyyy.'),
    F('points', 'Điểm', ['diem', 'diem tich luy', 'points'], '120'),
  ],
};

export interface RowIssue {
  column: string;
  value: string;
  message: string;
}

type Cells = Record<string, string>;

// ---------------------------------------------------------------------------------------------
// Column mapping

/** Map headers to field keys by template label or alias; `mapping` (header → key) overrides. */
function mapColumns(kind: ImportKind, header: string[], mapping?: Record<string, string>): Map<number, string> {
  const map = new Map<number, string>();
  const fields = FIELDS[kind];
  header.forEach((h, i) => {
    const override = mapping?.[h];
    if (override && fields.some((f) => f.key === override)) return void map.set(i, override);
    const folded = foldText(h);
    const f = fields.find((x) => foldText(x.label) === folded || x.aliases.includes(folded));
    if (f && ![...map.values()].includes(f.key)) map.set(i, f.key);
  });
  return map;
}

function labelOf(kind: ImportKind, key: string): string {
  return FIELDS[kind].find((f) => f.key === key)?.label ?? key;
}

// ---------------------------------------------------------------------------------------------
// Value parsing

const ITEM_TYPES: Record<string, 'book' | 'stationery' | 'other'> = {
  sach: 'book',
  book: 'book',
  'van phong pham': 'stationery',
  vpp: 'stationery',
  stationery: 'stationery',
  khac: 'other',
  other: 'other',
};

function parseInt0(v: string): number | null {
  const s = v.replace(/[.,\s]/g, '');
  return /^\d+$/.test(s) ? Number(s) : null;
}

function parseVat(v: string): number | null {
  const n = Number(v.replace('%', '').replace(',', '.').trim());
  return [0, 5, 8, 10].includes(n) ? n * 100 : null;
}

function parseDate(v: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (iso) return v;
  const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (vn) return `${vn[3]}-${vn[2]!.padStart(2, '0')}-${vn[1]!.padStart(2, '0')}`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// Validation

interface Lookups {
  categories: Map<string, string>;
  suppliers: Map<string, typeof schema.supplier.$inferSelect>;
  publishers: Map<string, string>;
  variants: Map<string, { id: string; vatBp: number; title: string }>;
  isbns: Map<string, string>;
  barcodes: Set<string>;
  phones: Set<string>;
  minMarginBp: number;
}

async function loadLookups(tx: Tx, ctx: Ctx): Promise<Lookups> {
  const categories = new Map<string, string>();
  for (const c of await tx.select().from(schema.category)) {
    categories.set(c.slug, c.id);
    categories.set(foldText(c.i18n.en.name), c.id);
    if (c.i18n.vi?.name) categories.set(foldText(c.i18n.vi.name), c.id);
  }
  const suppliers = new Map((await tx.select().from(schema.supplier).where(eq(schema.supplier.status, 'active'))).map((s) => [foldText(s.name), s]));
  const publishers = new Map<string, string>();
  for (const p of await tx.select().from(schema.publisher)) {
    publishers.set(foldText(p.i18n.en.name), p.id);
    if (p.i18n.vi?.name) publishers.set(foldText(p.i18n.vi.name), p.id);
  }
  const variants = new Map<string, { id: string; vatBp: number; title: string }>();
  const isbns = new Map<string, string>();
  const rows = await tx
    .select({ id: schema.itemVariant.id, sku: schema.itemVariant.sku, isbn: schema.itemVariant.isbn13, vatBp: schema.itemVariant.vatBp, title: sql<string>`${schema.item.i18n} -> 'en' ->> 'title'` })
    .from(schema.itemVariant)
    .innerJoin(schema.item, eq(schema.item.id, schema.itemVariant.itemId));
  for (const v of rows) {
    variants.set(v.sku, { id: v.id, vatBp: v.vatBp, title: v.title });
    if (v.isbn) isbns.set(v.isbn, v.title);
  }
  const barcodes = new Set((await tx.select({ code: schema.barcode.code }).from(schema.barcode)).map((b) => b.code));
  const phones = new Set((await tx.select({ p: schema.customer.phoneE164 }).from(schema.customer)).flatMap((c) => (c.p ? [c.p] : [])));
  const cfg = await settings.snapshot(ctx, tx);
  return { categories, suppliers, publishers, variants, isbns, barcodes, phones, minMarginBp: cfg['purchasing.min_margin_bp'] };
}

export interface ValidatedRow {
  rowNo: number;
  cells: Cells;
  errors: RowIssue[];
  warnings: RowIssue[];
  /** stock_in: `new` creates a product, `existing` adds stock (Design §12.4 chips). */
  tag: 'new' | 'existing' | 'customer';
  parsed: Record<string, unknown>;
}

function validateRows(kind: ImportKind, rows: { rowNo: number; cells: Cells }[], lk: Lookups): { rows: ValidatedRow[]; header: Record<string, string | null> } {
  const out: ValidatedRow[] = [];
  const seenSku = new Map<string, number>();
  const seenIsbn = new Map<string, number>();
  const seenPhone = new Map<string, number>();
  const fileLevel: Record<string, string | null> = { supplier: null, invoice_no: null, note: null };

  for (const { rowNo, cells } of rows) {
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];
    const err = (key: string, message: string) => errors.push({ column: labelOf(kind, key), value: cells[key] ?? '', message });
    const warn = (key: string, message: string) => warnings.push({ column: labelOf(kind, key), value: cells[key] ?? '', message });
    const get = (k: string) => (cells[k] ?? '').trim();
    const parsed: Record<string, unknown> = {};
    let tag: ValidatedRow['tag'] = 'customer';

    if (kind === 'customers') {
      if (!get('name')) err('name', 'Thiếu họ tên.');
      const phone = normalizePhone(get('phone'));
      if (!phone) err('phone', 'Số điện thoại không hợp lệ.');
      else if (lk.phones.has(phone)) err('phone', 'Đã có khách hàng với số này.');
      else if (seenPhone.has(phone)) err('phone', `Trùng số điện thoại với dòng ${seenPhone.get(phone)}.`);
      else seenPhone.set(phone, rowNo);
      const email = get('email');
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) err('email', 'Email không hợp lệ.');
      const birth = get('birth_date');
      const birthDate = birth ? parseDate(birth) : null;
      if (birth && !birthDate) err('birth_date', 'Ngày sinh có dạng dd/MM/yyyy.');
      const points = get('points') ? parseInt0(get('points')) : 0;
      if (points === null) err('points', 'Điểm phải là số nguyên không âm.');
      Object.assign(parsed, { name: get('name'), phone: get('phone'), email: email || undefined, birthDate: birthDate ?? undefined, points: points ?? 0 });
      out.push({ rowNo, cells, errors, warnings, tag, parsed });
      continue;
    }

    // products and stock_in
    const sku = get('sku');
    if (!sku) err('sku', 'Thiếu SKU (bắt buộc).');
    else if (seenSku.has(sku)) err('sku', `Trùng SKU với dòng ${seenSku.get(sku)}.`);
    else seenSku.set(sku, rowNo);
    const existing = sku ? lk.variants.get(sku) : undefined;
    if (kind === 'products' && existing) err('sku', `SKU đã có cho '${existing.title}'.`);
    tag = kind === 'stock_in' && existing ? 'existing' : 'new';

    const price = get('price') ? parseVnd(get('price')) : null;
    const cost = get('cost') ? parseVnd(get('cost')) : null;
    if (price === null || price < 0) err('price', 'Thiếu giá bán.');

    if (kind === 'stock_in') {
      const qty = parseInt0(get('qty'));
      if (!qty) err('qty', 'Số lượng phải lớn hơn 0.');
      if (cost === null) err('cost', 'Thiếu giá nhập.');
      for (const k of ['supplier', 'invoice_no', 'note'] as const) {
        const v = get(k);
        if (!v) continue;
        if (fileLevel[k] === null) fileLevel[k] = v;
        else if (foldText(fileLevel[k]!) !== foldText(v)) err(k, 'Cả tệp là một phiếu nhập: giá trị này phải giống các dòng khác.');
      }
      parsed.qty = qty;
    } else {
      const opening = get('opening_qty') ? parseInt0(get('opening_qty')) : 0;
      if (opening === null) err('opening_qty', 'Tồn đầu kỳ phải là số nguyên không âm.');
      if ((opening ?? 0) > 0 && cost === null) err('cost', 'Cần giá nhập khi có tồn đầu kỳ.');
      const min = get('min_stock') ? parseInt0(get('min_stock')) : null;
      if (get('min_stock') && min === null) err('min_stock', 'Tồn tối thiểu phải là số nguyên.');
      Object.assign(parsed, { openingQty: opening ?? 0, minStock: min });
    }
    Object.assign(parsed, { sku, priceVnd: price, costVnd: cost });

    if (tag === 'new') {
      const type = ITEM_TYPES[foldText(get('item_type'))];
      if (!type) err('item_type', 'Loại hàng: Sách, Văn phòng phẩm hoặc Khác.');
      if (!get('name')) err('name', 'Sản phẩm mới cần tên tiếng Anh.');
      if (!get('description')) err('description', 'Sản phẩm mới cần mô tả tiếng Anh (FR-WEB-22).');
      const categoryId = lk.categories.get(foldText(get('category'))) ?? lk.categories.get(get('category'));
      if (!get('category')) err('category', 'Sản phẩm mới cần danh mục.');
      else if (!categoryId) err('category', 'Danh mục chưa có. Tạo danh mục trước rồi nhập lại.');
      const weight = parseInt0(get('weight'));
      if (!weight) err('weight', 'Khối lượng (gram) phải lớn hơn 0.');
      const vatBp = parseVat(get('vat'));
      if (vatBp === null) err('vat', 'Thuế VAT: 0, 5, 8 hoặc 10.');
      let isbn13: string | null = null;
      if (get('isbn')) {
        isbn13 = normalizeIsbn(get('isbn'));
        if (!isbn13) err('isbn', 'ISBN không hợp lệ.');
        else if (lk.isbns.has(isbn13)) err('isbn', `ISBN đã có cho '${lk.isbns.get(isbn13)}'.`);
        else if (seenIsbn.has(isbn13)) err('isbn', `Trùng ISBN với dòng ${seenIsbn.get(isbn13)}.`);
        else if (lk.barcodes.has(isbn13)) err('isbn', 'ISBN đã được dùng làm mã vạch của sản phẩm khác.');
        else seenIsbn.set(isbn13, rowNo);
      }
      let publisherId: string | null = null;
      if (kind === 'products' && get('publisher')) {
        publisherId = lk.publishers.get(foldText(get('publisher'))) ?? null;
        if (!publisherId) err('publisher', 'Nhà xuất bản chưa có trong danh sách.');
      }
      // Images are optional on import; the product is flagged "missing image" (FR-CAT-11).
      warn('name', 'Thiếu ảnh: thêm ảnh sau trên trang sản phẩm.');
      Object.assign(parsed, {
        kind: type,
        title: get('name'),
        titleVi: get('name_vi') || undefined,
        description: get('description'),
        categoryId,
        weightG: weight,
        vatBp,
        isbn13,
        publisherId,
        authors: get('authors') ? get('authors').split(';').map((a) => a.trim()).filter(Boolean) : [],
      });
    }

    // Margin warning (FR-PUR-05).
    const vat = tag === 'existing' ? existing!.vatBp : (parsed.vatBp as number | null);
    if (price !== null && cost !== null && vat !== null && vat !== undefined && isMarginTooLow(netOfVat(vnd(price), vat), vnd(cost), lk.minMarginBp)) {
      warn('cost', 'Giá nhập làm giá bán không đủ lợi nhuận.');
    }
    if (tag === 'existing') parsed.variantId = existing!.id;
    out.push({ rowNo, cells, errors, warnings, tag, parsed });
  }

  if (kind === 'stock_in') {
    const supplierName = fileLevel.supplier;
    const needsSupplier = out.some((r) => r.tag === 'new');
    const supplier = supplierName ? lk.suppliers.get(foldText(supplierName)) : undefined;
    const first = out[0];
    if (supplierName && !supplier && first) first.errors.push({ column: labelOf(kind, 'supplier'), value: supplierName, message: 'Nhà cung cấp chưa có. Tạo nhà cung cấp trước.' });
    if (needsSupplier && !supplierName && first) first.errors.push({ column: labelOf(kind, 'supplier'), value: '', message: 'Sản phẩm mới cần nhà cung cấp.' });
    fileLevel.supplierId = supplier?.id ?? null;
  }
  return { rows: out, header: fileLevel };
}

// ---------------------------------------------------------------------------------------------
// Preview

export interface PreviewResult {
  jobId: string;
  kind: ImportKind;
  summary: {
    rows: number;
    errorRows: number;
    warningRows: number;
    newProducts: number;
    existingProducts: number;
    totalCostVnd: number;
    supplier: string | null;
    unmappedHeaders: string[];
    missingColumns: string[];
  };
  rows: { rowNo: number; tag: ValidatedRow['tag']; sku?: string; name?: string; errors: RowIssue[]; warnings: RowIssue[] }[];
}

function readRows(kind: ImportKind, table: string[][], mapping?: Record<string, string>) {
  const [header = [], ...body] = table;
  const map = mapColumns(kind, header, mapping);
  const unmapped = header.filter((h, i) => h && !map.has(i));
  const required: Record<ImportKind, string[]> = { stock_in: ['sku', 'cost', 'price', 'qty'], products: ['sku', 'name', 'price'], customers: ['name', 'phone'] };
  const present = new Set(map.values());
  const missing = required[kind].filter((k) => !present.has(k)).map((k) => labelOf(kind, k));
  const rows = body.map((cells, i) => {
    const obj: Cells = {};
    for (const [col, key] of map) obj[key] = cells[col] ?? '';
    return { rowNo: i + 2, cells: obj };
  });
  return { rows, unmapped, missing };
}

export async function preview(ctx: Ctx, kind: ImportKind, file: { bytes: Uint8Array; mime: string }, mapping?: Record<string, string>): Promise<PreviewResult> {
  const actor = requirePermission(ctx, PERMISSION[kind]);
  const table = await readTable(file.bytes, file.mime).catch(() => {
    throw new AppError(400, 'unreadable_file', 'Không đọc được tệp. Hãy dùng tệp mẫu (.xlsx hoặc .csv).');
  });
  if (table.length < 2) throw new AppError(400, 'empty_file', 'Tệp không có dòng dữ liệu nào.');
  if (table.length > 20_001) throw new AppError(400, 'file_too_long', 'Tệp có quá 20.000 dòng. Hãy chia nhỏ tệp.');
  const { rows, unmapped, missing } = readRows(kind, table, mapping);
  if (missing.length) throw new AppError(400, 'missing_columns', `Tệp thiếu cột: ${missing.join(', ')}. Hãy dùng tệp mẫu.`, { missing, unmapped });

  return ctx.db.transaction(async (tx) => {
    const lk = await loadLookups(tx, ctx);
    const v = validateRows(kind, rows, lk);
    const summary = summarize(kind, v, unmapped, missing, lk);
    const [job] = await tx
      .insert(schema.importJob)
      .values({ kind, status: 'validated', summary: { ...summary, mapping: mapping ?? null }, createdBy: actor.userId })
      .returning({ id: schema.importJob.id });
    for (let i = 0; i < v.rows.length; i += 500) {
      await tx.insert(schema.importRow).values(
        v.rows.slice(i, i + 500).map((r) => ({ jobId: job!.id, rowNo: r.rowNo, payload: r.cells, errors: r.errors, warnings: r.warnings })),
      );
    }
    return { jobId: job!.id, kind, summary, rows: v.rows.map(viewRow) };
  });
}

function summarize(kind: ImportKind, v: ReturnType<typeof validateRows>, unmapped: string[], missing: string[], lk: Lookups): PreviewResult['summary'] {
  const totalCost = kind === 'stock_in' ? v.rows.reduce((a, r) => a + ((r.parsed.costVnd as number) ?? 0) * ((r.parsed.qty as number) ?? 0), 0) : 0;
  const supplierId = v.header.supplierId;
  return {
    rows: v.rows.length,
    errorRows: v.rows.filter((r) => r.errors.length).length,
    warningRows: v.rows.filter((r) => r.warnings.length).length,
    newProducts: kind === 'customers' ? 0 : v.rows.filter((r) => r.tag === 'new').length,
    existingProducts: v.rows.filter((r) => r.tag === 'existing').length,
    totalCostVnd: totalCost,
    supplier: supplierId ? ([...lk.suppliers.values()].find((s) => s.id === supplierId)?.name ?? null) : null,
    unmappedHeaders: unmapped,
    missingColumns: missing,
  };
}

function viewRow(r: ValidatedRow) {
  return {
    rowNo: r.rowNo,
    tag: r.tag,
    ...(r.cells.sku !== undefined && { sku: r.cells.sku }),
    ...(r.cells.name !== undefined && { name: r.cells.name }),
    errors: r.errors,
    warnings: r.warnings,
  };
}

export async function getJob(ctx: Ctx, jobId: string) {
  const [job] = await ctx.db.select().from(schema.importJob).where(eq(schema.importJob.id, jobId));
  if (!job) throw errors.notFound('Lượt nhập');
  requirePermission(ctx, PERMISSION[job.kind as ImportKind]);
  return job;
}

// ---------------------------------------------------------------------------------------------
// Commit

export async function commit(ctx: Ctx, jobId: string) {
  const job = await getJob(ctx, jobId);
  const kind = job.kind as ImportKind;
  if (job.status === 'committed') throw errors.conflict('import_committed', 'Lượt nhập này đã được ghi.');
  return ctx.db.transaction(async (tx) => {
    // Lock the job so a double click cannot commit twice.
    const [locked] = await tx.select().from(schema.importJob).where(and(eq(schema.importJob.id, jobId), eq(schema.importJob.status, 'validated'))).for('update');
    if (!locked) throw errors.conflict('import_committed', 'Lượt nhập này đã được ghi.');
    const stored = await tx.select().from(schema.importRow).where(eq(schema.importRow.jobId, jobId)).orderBy(asc(schema.importRow.rowNo));
    const lk = await loadLookups(tx, ctx);
    const v = validateRows(kind, stored.map((r) => ({ rowNo: r.rowNo, cells: r.payload as Cells })), lk);
    if (v.rows.some((r) => r.errors.length)) {
      for (const r of v.rows) {
        await tx.update(schema.importRow).set({ errors: r.errors, warnings: r.warnings }).where(and(eq(schema.importRow.jobId, jobId), eq(schema.importRow.rowNo, r.rowNo)));
      }
      throw new AppError(422, 'import_has_errors', 'Còn dòng lỗi nên chưa ghi được. Tải báo cáo lỗi, sửa tệp rồi nhập lại.', {
        errorRows: v.rows.filter((r) => r.errors.length).length,
      });
    }

    let result: Record<string, unknown>;
    if (kind === 'stock_in') result = await commitStockIn(tx, ctx, jobId, v);
    else if (kind === 'products') result = await commitProducts(tx, ctx, jobId, v);
    else result = await commitCustomers(tx, ctx, v);

    await tx.update(schema.importJob).set({ status: 'committed', result, updatedAt: ctx.clock.now() }).where(eq(schema.importJob.id, jobId));
    await audit.record(tx, ctx, { action: 'import.commit', entity: 'import_job', entityId: jobId, after: { kind, rows: v.rows.length, ...result } });
    return { jobId, kind, rows: v.rows.length, ...result };
  });
}

/** Parsed product row, valid once `validateRows` reported no errors for it. */
interface ProductRow {
  sku: string;
  priceVnd: number;
  costVnd: number;
  qty: number;
  variantId: string;
  kind: 'book' | 'stationery' | 'other';
  title: string;
  titleVi?: string;
  description: string;
  categoryId: string;
  weightG: number;
  vatBp: number;
  isbn13: string | null;
  publisherId: string | null;
  authors: string[];
  minStock: number | null;
}

function itemFields(p: ProductRow) {
  return {
    kind: p.kind,
    i18n: { en: { title: p.title, description: p.description }, ...(p.titleVi && { vi: { title: p.titleVi } }) },
    authors: p.authors,
    publisherId: p.publisherId,
    categoryIds: [p.categoryId],
  };
}

function variantFields(p: ProductRow) {
  return { sku: p.sku, ...(p.isbn13 && { isbn: p.isbn13 }), weightG: p.weightG, vatBp: p.vatBp, minStock: p.minStock ?? null };
}

async function newItemInput(r: ValidatedRow): Promise<catalog.ItemInput> {
  const p = r.parsed as unknown as ProductRow;
  return { ...itemFields(p), variants: [{ ...variantFields(p), priceVnd: p.priceVnd }] };
}

/** The whole file becomes one stock-in entry with one entry number (FR-PUR-14). */
async function commitStockIn(tx: Tx, ctx: Ctx, jobId: string, v: ReturnType<typeof validateRows>) {
  const lines: purchasing.StockInInput['lines'] = [];
  for (const r of v.rows) {
    const p = r.parsed as unknown as ProductRow;
    if (r.tag === 'existing') {
      lines.push({ kind: 'existing', variantId: p.variantId, costVnd: p.costVnd, sellingPriceVnd: p.priceVnd, qty: p.qty });
    } else {
      lines.push({ kind: 'new', item: itemFields(p), variant: variantFields(p), imageFileIds: [], costVnd: p.costVnd, sellingPriceVnd: p.priceVnd, qty: p.qty });
    }
  }
  const posted = await purchasing.postStockInTx(tx, ctx, {
    supplierId: (v.header.supplierId as string | null) ?? null,
    ...(v.header.invoice_no && { supplierInvoiceNo: v.header.invoice_no }),
    ...(v.header.note && { note: v.header.note }),
    source: 'import',
    importJobId: jobId,
    lines,
  }, { allowMissingImage: true });
  return { entryId: posted.id, entryNo: posted.entryNo, totalCostVnd: posted.totalCostVnd, newProducts: posted.lines.filter((l) => l.createdProduct).length };
}

/** Products with opening stock (FR-CAT-11, FR-ADM-07): a `stock_in` movement at the row cost. */
async function commitProducts(tx: Tx, ctx: Ctx, jobId: string, v: ReturnType<typeof validateRows>) {
  let created = 0;
  let openingUnits = 0;
  const variantIds: string[] = [];
  for (const r of v.rows) {
    const made = await catalog.createItemTx(tx, ctx, await newItemInput(r));
    variantIds.push(made.variantIds[0]!);
    created++;
    const qty = r.parsed.openingQty as number;
    if (qty > 0) {
      await inventory.apply(tx, ctx, { variantId: made.variantIds[0]!, type: 'stock_in', qtyDelta: qty, unitCostVnd: r.parsed.costVnd as number, refType: 'import_job', refId: jobId, note: 'Tồn đầu kỳ' });
      openingUnits += qty;
    }
  }
  return { created, openingUnits, variantIds };
}

/** Customers with points (FR-CRM-09): imported points expire 12 months after import (TDD §4.12). */
async function commitCustomers(tx: Tx, ctx: Ctx, v: ReturnType<typeof validateRows>) {
  let created = 0;
  let points = 0;
  const customerIds: string[] = [];
  for (const r of v.rows) {
    const p = r.parsed as { name: string; phone: string; email?: string; birthDate?: string; points: number };
    const c = await customers.createCustomerTx(tx, ctx, {
      name: p.name,
      phone: p.phone,
      ...(p.email && { email: p.email }),
      ...(p.birthDate && { birthDate: p.birthDate }),
      source: 'import',
    });
    customerIds.push(c.id);
    if (p.points > 0) {
      await customers.post(tx, ctx, { customerId: c.id, delta: p.points, reason: 'import', note: 'Điểm chuyển từ hệ thống cũ' });
      points += p.points;
    }
    created++;
  }
  return { created, points, customerIds };
}

// ---------------------------------------------------------------------------------------------
// Template and error report (Design §12.10)

export async function template(ctx: Ctx, kind: ImportKind): Promise<Uint8Array> {
  requirePermission(ctx, PERMISSION[kind]);
  const fields = FIELDS[kind];
  const guide = [
    'Mỗi dòng là một bản ghi. Không đổi tên tiêu đề cột.',
    ...fields.filter((f) => f.hint).map((f) => `${f.label}: ${f.hint}`),
    ...(kind === 'stock_in'
      ? ['Cả tệp được ghi thành một phiếu nhập (một số phiếu).', 'SKU đã có: cộng tồn với giá nhập, giá bán, số lượng.', 'SKU mới: tạo sản phẩm, cần đủ loại hàng, tên, mô tả, danh mục, khối lượng, VAT.']
      : []),
    ...(kind !== 'customers' ? ['Ảnh không nhập được qua Excel: sản phẩm mới sẽ được đánh dấu “Thiếu ảnh” để thêm ảnh sau.'] : []),
  ].join('\n');
  return writeTable('Dữ liệu', fields.map((f) => f.label), [fields.map((f) => f.example)], guide);
}

export async function errorReport(ctx: Ctx, jobId: string): Promise<Uint8Array> {
  const job = await getJob(ctx, jobId);
  const rows = await ctx.db.select().from(schema.importRow).where(eq(schema.importRow.jobId, jobId)).orderBy(asc(schema.importRow.rowNo));
  const lines: (string | number)[][] = [];
  for (const r of rows) {
    for (const e of r.errors as RowIssue[]) lines.push([r.rowNo, 'Lỗi', e.column, e.value, e.message]);
    for (const w of r.warnings as RowIssue[]) lines.push([r.rowNo, 'Cảnh báo', w.column, w.value, w.message]);
  }
  return writeTable(`Báo cáo ${job.kind}`, ['Dòng', 'Mức', 'Cột', 'Giá trị', 'Nội dung'], lines);
}


export { readTable, writeTable } from './parse.js';

// ---------------------------------------------------------------------------------------------
// Catalogue export (FR-CAT-11): the product import layout, so a file can be edited and imported
// again. Cost appears only with `catalog.view_cost`; "Tồn đầu kỳ" carries the current stock.

export async function exportCatalog(ctx: Ctx): Promise<Uint8Array> {
  const actor = requirePermission(ctx, 'catalog.import');
  const showCost = can(actor, 'catalog.view_cost');
  const rows = await ctx.db.execute<{
    sku: string;
    isbn13: string | null;
    kind: string;
    title: string;
    title_vi: string | null;
    description: string | null;
    category: string | null;
    authors: string[];
    publisher: string | null;
    price_vnd: string;
    avg_cost: string | null;
    vat_bp: number;
    weight_g: number;
    on_hand: number;
    min_stock: number | null;
  }>(sql`
    select v.sku, v.isbn13, i.kind, i.i18n -> 'en' ->> 'title' as title, i.i18n -> 'vi' ->> 'title' as title_vi,
           i.i18n -> 'en' ->> 'description' as description,
           (select c.i18n -> 'en' ->> 'name' from catalog.item_category ic join catalog.category c on c.id = ic.category_id where ic.item_id = i.id order by c.sort, c.slug limit 1) as category,
           i.authors, (select p.i18n -> 'en' ->> 'name' from catalog.publisher p where p.id = i.publisher_id) as publisher,
           v.price_vnd, (select max(s.avg_cost_vnd) from inventory.stock_level s where s.variant_id = v.id) as avg_cost,
           v.vat_bp, v.weight_g, coalesce((select sum(s.on_hand) from inventory.stock_level s where s.variant_id = v.id), 0)::int as on_hand, v.min_stock
    from catalog.item_variant v join catalog.item i on i.id = v.item_id order by v.sku`);
  const typeLabel: Record<string, string> = { book: 'Sách', stationery: 'Văn phòng phẩm', other: 'Khác', bundle: 'Khác' };
  const fields = FIELDS.products.filter((f) => showCost || f.key !== 'cost');
  const body = rows.map((r) => {
    const values: Record<string, string | number | null> = {
      sku: r.sku,
      isbn: r.isbn13,
      item_type: typeLabel[r.kind] ?? 'Khác',
      name: r.title,
      name_vi: r.title_vi,
      description: r.description,
      category: r.category,
      authors: r.authors.join('; '),
      publisher: r.publisher,
      price: Number(r.price_vnd),
      cost: r.avg_cost === null ? null : Number(r.avg_cost),
      vat: r.vat_bp / 100,
      weight: r.weight_g,
      opening_qty: r.on_hand,
      min_stock: r.min_stock,
    };
    return fields.map((f) => values[f.key] ?? null);
  });
  await audit.record(ctx.db, ctx, { action: 'catalog.export', entity: 'catalog', after: { rows: body.length } });
  return writeTable('Sản phẩm', fields.map((f) => f.label), body);
}

export { rollback } from './rollback.js';

/** Create-product page with its cost and optional opening stock (FR-CAT-01, Design §12.1). */
export const CreateProductSchema = catalog.ItemSchema.extend({
  /**
   * Cost, plus opening stock posted like the Excel product import (FR-CAT-11) when `qty` > 0, or
   * as a consignment stock-in from a consignor supplier (FR-CAT-01, FR-PUR-09).
   */
  opening: z
    .object({
      costVnd: z.number().int().min(0),
      qty: z.number().int().min(0).optional(),
      supplierId: z.uuid().optional(),
      consignment: z.boolean().default(false),
      consignmentDiscountBp: z.number().int().min(0).max(10000).optional(),
      consignmentDeadline: z.iso.datetime().optional(),
    })
    .refine((o) => !o.consignment || (!!o.supplierId && (o.qty ?? 0) > 0), { message: 'Hàng ký gửi cần chọn nhà cung cấp và số lượng nhập lần đầu.', path: ['consignment'] })
    .optional(),
});

export async function createProduct(ctx: Ctx, input: z.input<typeof CreateProductSchema>) {
  const actor = requirePermission(ctx, 'catalog.edit');
  const { opening, ...item } = CreateProductSchema.parse(input);
  if (opening && !can(actor, 'catalog.import') && !can(actor, 'purchasing.manage')) {
    throw new AppError(403, 'forbidden', 'Bạn không có quyền nhập giá nhập hoặc tồn đầu kỳ.');
  }
  return ctx.db.transaction(async (tx) => {
    const made = await catalog.createItemTx(tx, ctx, item);
    const variantId = made.variantIds[0]!;
    if (opening?.supplierId && opening.qty) {
      // The product's first stock-in (FR-PUR-02, FR-PUR-04): one SI entry from the supplier. A
      // consignment one keeps the cost on the product and adds a lot without touching the average
      // cost (TDD §4.3).
      if (opening.consignment) await tx.insert(schema.stockLevel).values({ variantId, location: 'floor', onHand: 0, avgCostVnd: opening.costVnd }).onConflictDoNothing();
      await purchasing.postStockInTx(tx, ctx, {
        supplierId: opening.supplierId,
        consignment: opening.consignment,
        ...(opening.consignmentDiscountBp !== undefined && { consignmentDiscountBp: opening.consignmentDiscountBp }),
        ...(opening.consignmentDeadline && { consignmentDeadline: opening.consignmentDeadline }),
        note: 'Tồn đầu kỳ',
        lines: [{ kind: 'existing', variantId, costVnd: opening.costVnd, sellingPriceVnd: item.variants[0]!.priceVnd, qty: opening.qty }],
      });
    } else if (opening?.qty) {
      await inventory.apply(tx, ctx, { variantId, type: 'stock_in', qtyDelta: opening.qty, unitCostVnd: opening.costVnd, refType: 'item', refId: made.itemId, note: 'Tồn đầu kỳ' });
    } else if (opening) {
      // No stock yet: keep the cost on an empty level row (on hand 0 still equals the movement sum).
      await tx.insert(schema.stockLevel).values({ variantId, location: 'floor', onHand: 0, avgCostVnd: opening.costVnd }).onConflictDoNothing();
    }
    return made;
  });
}

export { countSheet, uploadCountSheet } from './count-sheet.js';
