import { readTable, writeTable } from '@bookstore/modules/imports';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, startHarness, type Harness } from './testing.js';

/** Excel/CSV imports, missing-image flag and product photos (FR-CAT-11, FR-PUR-14, FR-CRM-09, FR-ADM-07). */
let h: Harness;
let owner: string;
let warehouse: string;
let cashier: string;
let roles: Record<string, string>;
let existingVariant: string;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

beforeAll(async () => {
  h = await startHarness();
  ({ owner, roles } = await h.setupOwner());
  warehouse = await h.staff(owner, 'kho', roles.warehouse!);
  cashier = await h.staff(owner, 'thu', roles.cashier!);
  const cat = (await h.call('POST', '/api/v1/catalog/categories', { cookie: owner, body: { i18n: { en: { name: 'Children' }, vi: { name: 'Thiếu nhi' } } } })).body.id;
  await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Fahasa', phone: '0900000000' } });
  await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Phương Nam', phone: '0900000000' } });
  await h.call('POST', '/api/v1/catalog/publishers', { cookie: owner, body: { i18n: { en: { name: 'NXB Trẻ' } } } });
  const img = await upload(owner, PNG, 'image/png');
  const r = await h.newProduct({
    cookie: owner,
    body: {
      supplierId: (await h.call('GET', '/api/v1/purchasing/suppliers', { cookie: owner })).body.items[0].id,
      line: {
        item: { kind: 'book', i18n: { en: { title: 'Existing book', description: 'x' } }, categoryIds: [cat] },
        variant: { sku: 'SACH-0001', weightG: 200, vatBp: 0 },
        imageFileIds: [img],
        costVnd: 50000,
        sellingPriceVnd: 98000,
        qty: 10,
      },
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  existingVariant = r.body.lines[0].variantId;
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

async function raw(method: string, path: string, cookie: string, bytes: Uint8Array | undefined, mime: string) {
  const res = await h.app.request(path, {
    method,
    headers: { origin: ORIGIN, 'x-bms-request': '1', cookie, 'content-type': mime },
    ...(bytes && { body: bytes as never }),
  });
  return res;
}

async function upload(cookie: string, bytes: Uint8Array, mime: string): Promise<string> {
  const res = await raw('POST', '/api/v1/files?purpose=image', cookie, bytes, mime);
  const body = (await res.json()) as { id: string };
  expect(res.status, JSON.stringify(body)).toBe(201);
  return body.id;
}

async function previewFile(kind: string, cookie: string, header: string[], rows: (string | number | null)[][]) {
  const bytes = await writeTable('Dữ liệu', header, rows);
  const res = await raw('POST', `/api/v1/admin/import/${kind}/preview`, cookie, bytes, XLSX);
  return { status: res.status, body: (await res.json()) as any };
}

const STOCK_HEADER = ['SKU', 'ISBN', 'Loại hàng', 'Tên sản phẩm', 'Mô tả', 'Danh mục', 'Nhà cung cấp', 'Giá nhập', 'Giá bán', 'Khối lượng (g)', 'Số lượng', 'Thuế VAT (%)', 'Số hóa đơn NCC', 'Ghi chú'];

describe('templates (Design §12.10)', () => {
  it('downloads an XLSX template with the template headers', async () => {
    const res = await h.app.request('/api/v1/admin/import/stock_in/template', { headers: { cookie: warehouse } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(XLSX);
    const table = await readTable(new Uint8Array(await res.arrayBuffer()), XLSX);
    expect(table[0]).toEqual(STOCK_HEADER);
  });
});

describe('bulk stock-in (FR-PUR-14)', () => {
  let jobId: string;

  it('validates every row: errors, new-product tags, margin and missing-image warnings', async () => {
    const r = await previewFile('stock_in', warehouse, STOCK_HEADER, [
      ['SACH-0001', '', '', '', '', '', 'Fahasa', '52.000', '98.000', '', '5', '', 'HD-001', ''],
      ['VPP-0099', '', 'Văn phòng phẩm', 'Blue pen', 'Thien Long pen', 'Thiếu nhi', '', '3000', '6000', '10', '100', '10', '', ''],
      ['VPP-0100', '', 'Văn phòng phẩm', 'Red pen', 'Pen', 'Unknown category', '', '3000', '6000', '10', '5', '10', '', ''],
      ['VPP-0099', '', 'Văn phòng phẩm', 'Dup', 'Dup', 'Children', '', '1', '2', '1', '1', '10', '', ''],
      ['SACH-0002', '978-0-00-000000-0', 'Sách', 'Book', 'A book', 'Children', 'Phương Nam', '120000', '100000', '250', '2', '0', '', ''],
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    jobId = r.body.jobId;
    expect(r.body.summary).toMatchObject({ rows: 5, errorRows: 3, newProducts: 4, existingProducts: 1, supplier: 'Fahasa' });
    const byRow = Object.fromEntries(r.body.rows.map((x: { rowNo: number }) => [x.rowNo, x]));
    expect(byRow[2]).toMatchObject({ tag: 'existing', errors: [] });
    expect(byRow[3]).toMatchObject({ tag: 'new', errors: [] });
    expect(byRow[3].warnings[0].message).toMatch(/Thiếu ảnh/);
    expect(byRow[4].errors[0].message).toMatch(/Danh mục chưa có/);
    expect(byRow[5].errors[0].message).toMatch(/Trùng SKU với dòng 3/);
    const msgs = byRow[6].errors.map((e: { message: string }) => e.message).join(' ');
    expect(msgs).toMatch(/ISBN không hợp lệ/);
    expect(msgs).toMatch(/giống các dòng khác/); // second supplier in one entry
    expect(byRow[6].warnings.map((w: { message: string }) => w.message).join(' ')).toMatch(/không đủ lợi nhuận/);
  });

  it('offers a downloadable error report and refuses to commit with errors', async () => {
    const res = await h.app.request(`/api/v1/admin/import/jobs/${jobId}/errors`, { headers: { cookie: warehouse } });
    const table = await readTable(new Uint8Array(await res.arrayBuffer()), XLSX);
    expect(table[0]).toEqual(['Dòng', 'Mức', 'Cột', 'Giá trị', 'Nội dung']);
    expect(table.some((r) => r[0] === '4' && r[1] === 'Lỗi' && r[2] === 'Danh mục')).toBe(true);
    const c = await h.call('POST', `/api/v1/admin/import/jobs/${jobId}/commit`, { cookie: warehouse });
    expect(c.body.error).toMatchObject({ code: 'import_has_errors', details: { errorRows: 3 } });
  });

  it('commits a clean file as one entry, creating products flagged "missing image"', async () => {
    const r = await previewFile('stock_in', warehouse, STOCK_HEADER, [
      ['SACH-0001', '', '', '', '', '', 'Fahasa', '56000', '105000', '', '5', '', 'HD-002', ''],
      ['VPP-0099', '', 'Văn phòng phẩm', 'Blue pen', 'Thien Long pen', 'thieu nhi', '', '3000', '6000', '10', '100', '10', '', ''],
      ['SACH-0003', '9780306406157', 'Sách', 'Another book', 'Description', 'children', '', '40000', '80000', '300', '3', '0', 'HD-002', ''],
    ]);
    expect(r.body.summary).toMatchObject({ errorRows: 0, newProducts: 2, totalCostVnd: 5 * 56000 + 100 * 3000 + 3 * 40000 });
    const c = await h.call('POST', `/api/v1/admin/import/jobs/${r.body.jobId}/commit`, { cookie: warehouse });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body).toMatchObject({ entryNo: 'SI-2026-00002', newProducts: 2 });
    expect((await h.call('POST', `/api/v1/admin/import/jobs/${r.body.jobId}/commit`, { cookie: warehouse })).body.error.code).toBe('import_committed');

    const entries = (await h.call('GET', '/api/v1/purchasing/stock-in', { cookie: warehouse })).body.items;
    expect(entries[0]).toMatchObject({ entryNo: 'SI-2026-00002', source: 'import', lines: 3, supplierInvoiceNo: 'HD-002' });
    const [lvl] = await h.t.sql`select on_hand from inventory.stock_level where variant_id = ${existingVariant}`;
    expect(lvl!.on_hand).toBe(15);

    const missing = (await h.call('GET', '/api/v1/catalog/items?image=missing', { cookie: warehouse })).body.items;
    expect(missing.map((i: { sku: string }) => i.sku).sort()).toEqual(['SACH-0003', 'VPP-0099']);
    expect(missing[0].missingImage).toBe(true);
  });

  it('a photo added later clears the flag (FR-CAT-10)', async () => {
    const item = (await h.call('GET', '/api/v1/catalog/items?q=blue pen', { cookie: warehouse })).body.items[0];
    const fileId = await upload(warehouse, PNG, 'image/png');
    const r = await h.call('POST', `/api/v1/catalog/items/${item.itemId}/images`, { cookie: warehouse, body: { fileId, alt: { en: 'Blue pen' } } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const missing = (await h.call('GET', '/api/v1/catalog/items?image=missing', { cookie: warehouse })).body.items;
    expect(missing.map((i: { sku: string }) => i.sku)).toEqual(['SACH-0003']);
    const res = await h.app.request(`/api/v1/files/${fileId}`, { headers: { cookie: cashier } });
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('accepts CSV with semicolons and checks permissions', async () => {
    const csv = 'SKU;Giá nhập;Giá bán;Số lượng\nSACH-0001;56000;105000;2\n';
    const ok = await raw('POST', '/api/v1/admin/import/stock_in/preview', warehouse, new TextEncoder().encode(csv), 'text/csv');
    expect(((await ok.json()) as any).summary).toMatchObject({ rows: 1, errorRows: 0, existingProducts: 1 });
    const denied = await raw('POST', '/api/v1/admin/import/stock_in/preview', cashier, new TextEncoder().encode(csv), 'text/csv');
    expect(denied.status).toBe(403);
    const missingCol = await raw('POST', '/api/v1/admin/import/stock_in/preview', warehouse, new TextEncoder().encode('SKU;Giá bán\nX;1\n'), 'text/csv');
    expect(((await missingCol.json()) as any).error.code).toBe('missing_columns');
  });
});

describe('files (TDD §4.12)', () => {
  it('rejects types outside the allow-list and disguised files', async () => {
    expect((await raw('POST', '/api/v1/files?purpose=image', warehouse, new Uint8Array([1, 2, 3]), 'image/gif')).status).toBe(415);
    expect((await raw('POST', '/api/v1/files?purpose=image', warehouse, new Uint8Array([1, 2, 3, 4]), 'image/png')).status).toBe(400);
  });

  it('the stock-in API takes existing products only: new products come from Thêm sản phẩm mới (FR-PUR-02, FR-PUR-03)', async () => {
    const cat = (await h.call('GET', '/api/v1/catalog/categories', { cookie: owner })).body.items[0].id;
    const supplierId = (await h.call('GET', '/api/v1/purchasing/suppliers', { cookie: owner })).body.items[0].id;
    const r = await h.call('POST', '/api/v1/purchasing/stock-in', {
      cookie: warehouse,
      body: {
        supplierId,
        lines: [{ kind: 'new', item: { kind: 'book', i18n: { en: { title: 'New book', description: 'x' } }, categoryIds: [cat] }, variant: { sku: 'NEW-1', weightG: 1, vatBp: 0 }, costVnd: 1, sellingPriceVnd: 2, qty: 1 }],
      },
    });
    expect(r.status).toBe(400);
    expect((await h.t.sql`select count(*)::int as n from catalog.item_variant where sku = 'NEW-1'`)[0]!.n).toBe(0);
    // The old one-line endpoints are gone.
    expect((await h.call('POST', '/api/v1/purchasing/stock-in/new-product', { cookie: warehouse, body: {} })).status).toBe(404);
    expect((await h.call('POST', '/api/v1/purchasing/stock-in/existing', { cookie: warehouse, body: {} })).status).toBe(404);
  });
});

describe('products with opening stock (FR-CAT-11, FR-ADM-07)', () => {
  it('creates products and opening stock; existing SKUs are duplicates', async () => {
    const header = ['SKU', 'ISBN', 'Loại hàng', 'Tên sản phẩm', 'Tên tiếng Việt', 'Mô tả', 'Danh mục', 'Tác giả', 'Nhà xuất bản', 'Giá bán', 'Giá nhập', 'Thuế VAT (%)', 'Khối lượng (g)', 'Tồn đầu kỳ', 'Tồn tối thiểu'];
    const bad = await previewFile('products', warehouse, header, [['SACH-0001', '', 'Sách', 'x', '', 'x', 'Children', '', '', '1', '1', '0', '1', '0', '']]);
    expect(bad.body.rows[0].errors[0].message).toMatch(/SKU đã có/);
    const r = await previewFile('products', warehouse, header, [
      ['SACH-0100', '', 'Sách', 'Mat Biec', 'Mắt biếc', 'Novel', 'Children', 'Nguyễn Nhật Ánh; Khác', 'NXB Trẻ', '110000', '60000', '0', '320', '7', '2'],
    ]);
    expect(r.body.summary.errorRows).toBe(0);
    const c = await h.call('POST', `/api/v1/admin/import/jobs/${r.body.jobId}/commit`, { cookie: warehouse });
    expect(c.body).toMatchObject({ created: 1, openingUnits: 7 });
    const item = (await h.call('GET', '/api/v1/catalog/items?q=mat biec', { cookie: warehouse })).body.items[0];
    expect(item).toMatchObject({ sku: 'SACH-0100', available: 7, minStock: 2, missingImage: true, titleVi: 'Mắt biếc' });
    expect((await h.call('GET', '/api/v1/catalog/items?q=nguyen nhat anh', { cookie: warehouse })).body.total).toBe(1);
  });
});

describe('customers with points (FR-CRM-09)', () => {
  it('imports customers and points that expire 12 months after import', async () => {
    const header = ['Họ tên', 'Số điện thoại', 'Email', 'Ngày sinh', 'Điểm'];
    const r = await previewFile('customers', warehouse, header, [
      ['Trần Thị B', '0912 345 678', 'b@example.com', '24/10/1990', '120'],
      ['Trùng', '+84912345678', '', '', ''],
      ['Lỗi', '12', 'not-an-email', '31-12-1990', '-5'],
    ]);
    expect(r.body.summary).toMatchObject({ rows: 3, errorRows: 2 });
    expect(r.body.rows[1].errors[0].message).toMatch(/Trùng số điện thoại với dòng 2/);
    expect(r.body.rows[2].errors).toHaveLength(4);
    expect((await previewFile('customers', cashier, header, [['A', '0911111111', '', '', '']])).status).toBe(403);

    const ok = await previewFile('customers', warehouse, header, [['Trần Thị B', '0912 345 678', 'b@example.com', '24/10/1990', '120']]);
    const c = await h.call('POST', `/api/v1/admin/import/jobs/${ok.body.jobId}/commit`, { cookie: warehouse });
    expect(c.body).toMatchObject({ created: 1, points: 120 });
    const [row] = await h.t.sql`select c.points_balance, c.birth_date, l.reason, l.expires_at from crm.customer c join crm.points_ledger l on l.customer_id = c.id where c.phone_e164 = '+84912345678'`;
    expect(row).toMatchObject({ points_balance: 120, birth_date: '1990-10-24', reason: 'import' });
    expect(new Date(row!.expires_at).getUTCFullYear()).toBe(2027);
  });
});
