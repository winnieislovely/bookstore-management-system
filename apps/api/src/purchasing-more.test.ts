import { writeTable } from '@bookstore/modules/imports';
import * as jobs from '@bookstore/modules/jobs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, startHarness, type Harness } from './testing.js';

/** Bundles, import rollback, consignment alerts. */
let h: Harness;
let owner: string;
let warehouse: string;
let cashier: string;
let roles: Record<string, string>;
let cat: string;
let supplierId: string;
let notebook: string;
let pen: string;
let shiftId: string;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

beforeAll(async () => {
  h = await startHarness();
  ({ owner, roles } = await h.setupOwner());
  warehouse = await h.staff(owner, 'kho', roles.warehouse!);
  cashier = await h.staff(owner, 'thu', roles.cashier!);
  cat = (await h.call('POST', '/api/v1/catalog/categories', { cookie: owner, body: { i18n: { en: { name: 'Stationery' } } } })).body.id;
  supplierId = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Thiên Long', kind: 'vendor' } })).body.id;
  const mk = async (sku: string, price: number, qty: number, minStock: number | null = null) => {
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', {
      cookie: owner,
      body: {
        supplierId,
        line: {
          item: { kind: 'stationery', i18n: { en: { title: sku, description: sku } }, categoryIds: [cat] },
          variant: { sku, weightG: 50, vatBp: 1000, minStock },
          imageFileIds: ['00000000-0000-7000-8000-00000000000a'],
          costVnd: price / 2,
          sellingPriceVnd: price,
          qty,
        },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.lines[0].variantId as string;
  };
  notebook = await mk('NB-01', 20000, 30, 10);
  pen = await mk('PEN-01', 6000, 100);
  const registerId = (await h.call('GET', '/api/v1/pos/registers', { cookie: cashier })).body.items[0].id;
  shiftId = (await h.call('POST', '/api/v1/pos/shifts/open', { cookie: cashier, body: { registerId, floatVnd: 0 } })).body.id;
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

const sell = (lines: [string, number][], total: number) =>
  h.call('POST', '/api/v1/pos/sales', {
    cookie: cashier,
    body: { lines: lines.map(([variantId, qty], i) => ({ lineId: `l${i}`, variantId, qty })), shiftId, payments: [{ method: 'cash', amountVnd: total }] },
  });

describe('bundles (FR-CAT-12)', () => {
  let bundle: string;

  it('a bundle has components, no own stock, and availability from its components', async () => {
    const r = await h.call('POST', '/api/v1/catalog/items', {
      cookie: warehouse,
      body: { kind: 'bundle', i18n: { en: { title: 'Notebook + 2 pens', description: 'Combo' } }, categoryIds: [cat], variants: [{ sku: 'COMBO-01', weightG: 150, priceVnd: 28000, vatBp: 1000 }] },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    bundle = r.body.variantIds[0];
    expect((await h.call('PUT', `/api/v1/catalog/variants/${bundle}/components`, { cookie: warehouse, body: { components: [{ variantId: notebook, qty: 1 }] } })).status).toBe(400);
    expect((await h.call('PUT', `/api/v1/catalog/variants/${notebook}/components`, { cookie: warehouse, body: { components: [{ variantId: pen, qty: 1 }, { variantId: bundle, qty: 1 }] } })).body.error.code).toBe('not_a_bundle');
    const set = await h.call('PUT', `/api/v1/catalog/variants/${bundle}/components`, { cookie: warehouse, body: { components: [{ variantId: notebook, qty: 1 }, { variantId: pen, qty: 2 }] } });
    expect(set.body).toMatchObject({ available: 30 });
    const list = (await h.call('GET', '/api/v1/catalog/items?q=combo', { cookie: cashier })).body.items[0];
    expect(list).toMatchObject({ sku: 'COMBO-01', available: 30 });
    const stockIn = await h.call('POST', '/api/v1/purchasing/stock-in/existing', { cookie: warehouse, body: { line: { variantId: bundle, costVnd: 1, sellingPriceVnd: 28000, qty: 1 } } });
    expect(stockIn.body.error.code).toBe('bundle_has_no_stock');
  });

  it('selling a bundle deducts its components (bundle_use)', async () => {
    expect((await sell([[bundle, 2]], 56000)).status).toBe(201);
    const levels = await h.t.sql`select variant_id, on_hand from inventory.stock_level where variant_id in (${notebook}, ${pen}) order by on_hand`;
    expect(levels.map((l) => l.on_hand)).toEqual([28, 96]);
    expect((await h.call('GET', '/api/v1/catalog/items?q=combo', { cookie: cashier })).body.items[0].available).toBe(28);
  });
});

describe('stock-in without supplier orders (FR-PUR-07 removed)', () => {
  it('adds stock directly; the supplier-order endpoints are gone', async () => {
    for (const qty of [8, 12]) {
      const r = await h.call('POST', '/api/v1/purchasing/stock-in/existing', { cookie: warehouse, body: { line: { variantId: notebook, costVnd: 10000, sellingPriceVnd: 20000, qty } } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    expect((await h.call('GET', '/api/v1/purchasing/orders', { cookie: warehouse })).status).toBe(404);
  });
});

describe('import rollback (FR-ADM-07)', () => {
  const header = ['SKU', 'ISBN', 'Loại hàng', 'Tên sản phẩm', 'Mô tả', 'Danh mục', 'Nhà cung cấp', 'Giá nhập', 'Giá bán', 'Khối lượng (g)', 'Số lượng', 'Thuế VAT (%)', 'Số hóa đơn NCC', 'Ghi chú'];
  const importFile = async (rows: (string | number)[][]) => {
    const bytes = await writeTable('Dữ liệu', header, rows);
    const res = await h.app.request('/api/v1/admin/import/stock_in/preview', { method: 'POST', headers: { origin: ORIGIN, 'x-bms-request': '1', cookie: warehouse, 'content-type': XLSX }, body: bytes as never });
    const p = (await res.json()) as { jobId: string; summary: { errorRows: number } };
    expect(p.summary.errorRows).toBe(0);
    const c = await h.call('POST', `/api/v1/admin/import/jobs/${p.jobId}/commit`, { cookie: warehouse });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    return p.jobId;
  };

  it('reverses stock, price, average cost and created products', async () => {
    const before = (await h.t.sql`select s.on_hand, s.avg_cost_vnd, v.price_vnd from inventory.stock_level s join catalog.item_variant v on v.id = s.variant_id where s.variant_id = ${notebook}`)[0]!;
    const jobId = await importFile([
      ['NB-01', '', '', '', '', '', 'Thiên Long', '14000', '22000', '', '10', '', '', ''],
      ['NEW-99', '', 'Văn phòng phẩm', 'Eraser', 'Eraser', 'Stationery', '', '2000', '5000', '10', '40', '10', '', ''],
    ]);
    const r = await h.call('POST', `/api/v1/admin/import/jobs/${jobId}/rollback`, { cookie: warehouse });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'rolled_back', products: 1, units: 50 });
    const after = (await h.t.sql`select s.on_hand, s.avg_cost_vnd, v.price_vnd from inventory.stock_level s join catalog.item_variant v on v.id = s.variant_id where s.variant_id = ${notebook}`)[0]!;
    expect(after).toEqual(before);
    const [eraser] = await h.t.sql`select v.sku, v.status, (select count(*)::int from catalog.barcode b where b.variant_id = v.id) as barcodes from catalog.item_variant v where v.sku like 'NEW-99~rb-%'`;
    expect(eraser).toMatchObject({ status: 'discontinued', barcodes: 0 });
    expect((await h.call('POST', `/api/v1/admin/import/jobs/${jobId}/rollback`, { cookie: warehouse })).body.error.code).toBe('import_not_committed');
    // The freed SKU can be imported again.
    await importFile([['NEW-99', '', 'Văn phòng phẩm', 'Eraser', 'Eraser', 'Stationery', 'Thiên Long', '2000', '5000', '10', '5', '10', '', '']]);
    expect(await jobs.integrityCheck(h.ctx())).toEqual([]);
  });

  it('is blocked once the imported goods have been sold', async () => {
    const jobId = await importFile([['NEW-77', '', 'Văn phòng phẩm', 'Ruler', 'Ruler', 'Stationery', 'Thiên Long', '3000', '7000', '20', '5', '10', '', '']]);
    const v = (await h.t.sql`select id from catalog.item_variant where sku = 'NEW-77'`)[0]!.id as string;
    expect((await sell([[v, 1]], 7000)).status).toBe(201);
    const r = await h.call('POST', `/api/v1/admin/import/jobs/${jobId}/rollback`, { cookie: warehouse });
    expect(r.body.error).toMatchObject({ code: 'rollback_blocked' });
    expect(r.body.error.details.reasons.join(' ')).toMatch(/NEW-77 đã được bán/);
  });

  it('customer imports roll back until a customer buys or uses points', async () => {
    const bytes = await writeTable('Dữ liệu', ['Họ tên', 'Số điện thoại', 'Điểm'], [['Khách nhập', '0933333333', '50']]);
    const res = await h.app.request('/api/v1/admin/import/customers/preview', { method: 'POST', headers: { origin: ORIGIN, 'x-bms-request': '1', cookie: warehouse, 'content-type': XLSX }, body: bytes as never });
    const jobId = ((await res.json()) as { jobId: string }).jobId;
    await h.call('POST', `/api/v1/admin/import/jobs/${jobId}/commit`, { cookie: warehouse });
    const r = await h.call('POST', `/api/v1/admin/import/jobs/${jobId}/rollback`, { cookie: warehouse });
    expect(r.body).toMatchObject({ status: 'rolled_back', customers: 1 });
    const [c] = await h.t.sql`select phone_e164, points_balance, anonymised_at from crm.customer where name = 'Đã hoàn tác nhập'`;
    expect(c).toMatchObject({ phone_e164: null, points_balance: 0 });
    expect(await jobs.integrityCheck(h.ctx())).toEqual([]);
  });
});

describe('consignment deadline alerts (FR-PUR-13)', () => {
  it('notifies payables holders once per lot near its deadline', async () => {
    const consignor = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Kim Đồng', kind: 'publisher', isConsignor: true } })).body.id;
    const deadline = new Date(h.clock.now().getTime() + 3 * 86_400_000).toISOString();
    await h.call('POST', '/api/v1/purchasing/stock-in/existing', {
      cookie: owner,
      body: { supplierId: consignor, consignment: true, consignmentDeadline: deadline, line: { variantId: pen, costVnd: 3000, sellingPriceVnd: 6000, qty: 10 } },
    });
    const far = new Date(h.clock.now().getTime() + 30 * 86_400_000).toISOString();
    await h.call('POST', '/api/v1/purchasing/stock-in/existing', {
      cookie: owner,
      body: { supplierId: consignor, consignment: true, consignmentDeadline: far, line: { variantId: notebook, costVnd: 10000, sellingPriceVnd: 20000, qty: 10 } },
    });
    expect(await jobs.consignmentDeadlineAlert(h.ctx())).toBe(1);
    expect(await jobs.consignmentDeadlineAlert(h.ctx())).toBe(0);
    const n = (await h.call('GET', '/api/v1/notifications', { cookie: owner })).body.items;
    expect(n[0]).toMatchObject({ template: 'consignment.deadline', vars: { sku: 'PEN-01', remaining: 10, supplier: 'Kim Đồng' } });
    expect((await h.call('GET', '/api/v1/notifications', { cookie: warehouse })).body.items).toHaveLength(0);
  });
});
