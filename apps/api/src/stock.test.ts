import * as inventory from '@bookstore/modules/inventory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, startHarness, type Harness } from './testing.js';

/** Catalogue, inventory and purchasing end to end (FR-CAT, FR-INV, FR-PUR; UC-05, UC-07). */
let h: Harness;
let owner: string;
let roles: Record<string, string>;
let warehouse: string;
let cashier: string;
let categoryId: string;
let publisherId: string;
let supplierId: string;
let consignorId: string;
let bookVariant: string;
let bookItem: string;

beforeAll(async () => {
  h = await startHarness();
  ({ owner, roles } = await h.setupOwner());
  warehouse = await h.staff(owner, 'kho', roles.warehouse!);
  cashier = await h.staff(owner, 'thu', roles.cashier!);
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

const newBook = (over: Record<string, unknown> = {}) => ({
  supplierId,
  supplierInvoiceNo: 'HD-NCC-001',
  line: {
    item: {
      kind: 'book',
      i18n: {
        en: { title: 'Cho Toi Xin Mot Ve Di Tuoi Tho', description: 'A novel by Nguyễn Nhật Ánh.' },
        vi: { title: 'Cho tôi xin một vé đi tuổi thơ' },
      },
      authors: ['Nguyễn Nhật Ánh'],
      publisherId,
      categoryIds: [categoryId],
    },
    variant: { sku: 'SACH-NNA-0012', isbn: '978-604-1-23456-7', weightG: 250, vatBp: 0 },
    imageFileIds: ['00000000-0000-7000-8000-00000000000a'],
    costVnd: 50000,
    sellingPriceVnd: 98000,
    qty: 10,
    ...over,
  },
});

describe('master data', () => {
  it('creates a category, publisher and suppliers', async () => {
    const c = await h.call('POST', '/api/v1/catalog/categories', { cookie: warehouse, body: { i18n: { en: { name: 'Children' }, vi: { name: 'Thiếu nhi' } } } });
    expect(c.status).toBe(201);
    categoryId = c.body.id;
    publisherId = (await h.call('POST', '/api/v1/catalog/publishers', { cookie: warehouse, body: { i18n: { en: { name: 'NXB Trẻ' } } } })).body.id;
    const dupe = await h.call('POST', '/api/v1/catalog/publishers', { cookie: warehouse, body: { i18n: { en: { name: 'nxb tre' } } } });
    expect(dupe.body.error.code).toBe('duplicate_publisher');
    supplierId = (
      await h.call('POST', '/api/v1/purchasing/suppliers', {
        cookie: warehouse,
        body: { name: 'Fahasa', kind: 'distributor', tracksPayables: true, termsDays: 30, taxCode: '0300000001' },
      })
    ).body.id;
    consignorId = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: warehouse, body: { name: 'NXB Kim Đồng', kind: 'publisher', isConsignor: true } })).body.id;
    expect(supplierId && consignorId).toBeTruthy();
  });
});

describe('quick stock-in of a new product (FR-PUR-02, FR-PUR-04, UC-05)', () => {
  it('requires the English description (FR-WEB-22)', async () => {
    const body = newBook();
    (body.line.item.i18n.en as Record<string, unknown>).description = '';
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', { cookie: warehouse, body });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body.error.details)).toContain('tiếng Anh');
  });

  it('creates the product and its first stock-in in one step', async () => {
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', { cookie: warehouse, body: newBook() });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.entryNo).toBe('SI-2026-00001');
    expect(r.body.lines[0]).toMatchObject({ createdProduct: true, marginFlag: false, avgCostVnd: 50000 });
    expect(r.body.payableId).toBeTruthy(); // supplier tracks payables (FR-PUR-06)
    bookVariant = r.body.lines[0].variantId;

    const found = await h.call('GET', `/api/v1/catalog/lookup?code=9786041234567`, { cookie: cashier });
    expect(found.body.variantId).toBe(bookVariant);
  });

  it('blocks duplicate SKU and ISBN (FR-CAT-05)', async () => {
    const sku = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', { cookie: warehouse, body: newBook() });
    expect(sku.status).toBe(409);
    expect(sku.body.error.code).toBe('duplicate_sku');
    expect(sku.body.error.message).toContain('SACH-NNA-0012');
    const isbnOnly = newBook();
    isbnOnly.line.variant.sku = 'SACH-NNA-9999';
    const isbn = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', { cookie: warehouse, body: isbnOnly });
    expect(isbn.body.error.code).toBe('duplicate_isbn');
  });

  it('gives an internal barcode to an item without one (FR-CAT-04)', async () => {
    const pen = newBook({
      item: { kind: 'stationery', i18n: { en: { title: 'Blue ballpoint pen', description: 'Thien Long pen' } }, categoryIds: [categoryId] },
      variant: { sku: 'VPP-0012', weightG: 10, vatBp: 1000 },
      costVnd: 3000,
      sellingPriceVnd: 6000,
      qty: 100,
    });
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', { cookie: warehouse, body: pen });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [bc] = await h.t.sql`select code, kind from catalog.barcode b join catalog.item_variant v on v.id = b.variant_id where v.sku = 'VPP-0012'`;
    expect(bc!.kind).toBe('internal');
    expect(bc!.code).toMatch(/^20\d{11}$/);
  });
});

describe('quick stock-in of an existing product (FR-PUR-03, FR-PUR-05, FR-INV-08)', () => {
  it('updates moving-average cost and the price history', async () => {
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/existing', {
      cookie: warehouse,
      body: { line: { variantId: bookVariant, costVnd: 56000, sellingPriceVnd: 105000, qty: 5 } },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.lines[0]).toMatchObject({ priceChanged: true, avgCostVnd: 52000 });
    const history = (await h.call('GET', `/api/v1/catalog/variants/${bookVariant}/price-history`, { cookie: warehouse })).body.items;
    expect(history.map((p: { priceVnd: number }) => p.priceVnd)).toEqual([105000, 98000]);
    const audit = (await h.call('GET', `/api/v1/admin/audit?entity=item_variant&entityId=${bookVariant}`, { cookie: owner })).body.items;
    expect(audit[0]).toMatchObject({ action: 'price.change', before: { priceVnd: 98000 }, after: { priceVnd: 105000 } });
  });

  it('flags a cost that makes the selling price unprofitable', async () => {
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/existing', {
      cookie: warehouse,
      body: { line: { variantId: bookVariant, costVnd: 110000, sellingPriceVnd: 105000, qty: 1 } },
    });
    expect(r.body.lines[0].marginFlag).toBe(true);
  });
});

describe('product list and detail (FR-CAT-14, Design §12.1)', () => {
  it('searches without diacritics and shows SKU only', async () => {
    const r = await h.call('GET', '/api/v1/catalog/items?q=nguyen nhat anh', { cookie: cashier });
    expect(r.body.total).toBe(1);
    expect(r.body.items[0]).toMatchObject({ sku: 'SACH-NNA-0012', available: 16 });
    expect(r.body.items[0]).not.toHaveProperty('isbn13');
    bookItem = r.body.items[0].itemId;
  });

  it('shows cost and margin only with permission (TDD §10.3)', async () => {
    const asCashier = (await h.call('GET', `/api/v1/catalog/items/${bookItem}`, { cookie: cashier })).body;
    expect(asCashier.variants[0]).not.toHaveProperty('avgCostVnd');
    const asWarehouse = (await h.call('GET', `/api/v1/catalog/items/${bookItem}`, { cookie: warehouse })).body;
    expect(asWarehouse.variants[0].avgCostVnd).toBe(Math.round((15 * 52000 + 110000) / 16));
    expect(asWarehouse.variants[0].stock).toMatchObject({ onHand: 16, available: 16 });
  });

  it('filters by kind, several states and categories, with on-hand, cost (by permission) and last update', async () => {
    const list = async (qs: string, cookie = warehouse) => (await h.call('GET', `/api/v1/catalog/items?${qs}`, { cookie })).body;
    const row = (await list('q=nguyen nhat anh')).items[0];
    expect(row).toMatchObject({ onHand: 16, avgCostVnd: Math.round((15 * 52000 + 110000) / 16) });
    expect(new Date(row.updatedAt).getTime()).not.toBeNaN();
    expect(new Date(row.lastMovementAt).getTime()).not.toBeNaN();
    // The product's stock page shows which stock-in entry (and supplier) each receipt came from.
    const moves = (await h.call('GET', `/api/v1/inventory/movements?variant=${row.variantId}`, { cookie: warehouse })).body.items as { refType: string; refDocNo: string | null }[];
    const receipt = moves.find((m) => m.refType === 'stock_in');
    expect(receipt?.refDocNo).toBeTruthy();
    // Filter by the time of the latest stock change.
    const last = new Date(row.lastMovementAt).getTime();
    const ids = async (qs: string) => (await list(qs)).items.map((r: { variantId: string }) => r.variantId);
    expect(await ids(`changedFrom=${new Date(last - 1000).toISOString()}&changedTo=${new Date(last + 1000).toISOString()}`)).toContain(row.variantId);
    expect(await ids(`changedFrom=${new Date(last + 1000).toISOString()}`)).not.toContain(row.variantId);
    expect((await list('q=nguyen nhat anh', cashier)).items[0]).not.toHaveProperty('avgCostVnd');
    expect((await list('kind=book')).items.every((r: { kind: string }) => r.kind === 'book')).toBe(true);
    expect((await list('kind=stationery,other')).items.map((r: { itemId: string }) => r.itemId)).not.toContain(bookItem);
    expect((await list('stock=low,out,in_stock')).total).toBe((await list('')).total);
    expect((await list('status=active,hidden')).items.map((r: { itemId: string }) => r.itemId)).toContain(bookItem);
    const cats = (await h.call('GET', '/api/v1/catalog/categories', { cookie: warehouse })).body.items as { id: string; kinds: string[] }[];
    const bookCat = cats.find((c) => c.kinds.includes('book'));
    expect(bookCat, JSON.stringify(cats.map((c) => c.kinds))).toBeTruthy();
    expect((await list(`category=${bookCat!.id}`)).items.map((r: { itemId: string }) => r.itemId)).toContain(bookItem);
    expect((await h.call('GET', '/api/v1/catalog/items?kind=ebook', { cookie: warehouse })).status).toBe(400);
  });

  it('creates a product from the Products page with opening stock at cost (Design §12.1)', async () => {
    const [cat] = (await h.call('GET', '/api/v1/catalog/categories', { cookie: warehouse })).body.items as { id: string }[];
    const r = await h.call('POST', '/api/v1/catalog/items', {
      cookie: warehouse,
      body: {
        kind: 'stationery',
        unit: 'cái',
        i18n: { en: { title: 'Sổ tay A5', description: 'Sổ tay bìa cứng' } },
        categoryIds: [cat!.id],
        variants: [{ sku: 'VPP-SO-A5', weightG: 200, priceVnd: 45000, vatBp: 1000 }],
        opening: { qty: 12, costVnd: 30000 },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const v = (await h.call('GET', `/api/v1/catalog/items/${r.body.itemId}`, { cookie: warehouse })).body.variants[0];
    expect(v.stock).toMatchObject({ onHand: 12 });
    expect(v.avgCostVnd).toBe(30000);

    // Cost without a quantity: zero stock, cost kept, stock invariant intact.
    const empty = await h.call('POST', '/api/v1/catalog/items', {
      cookie: warehouse,
      body: {
        kind: 'other',
        unit: 'hộp quà',
        i18n: { en: { title: 'Hộp quà', description: 'Hộp quà giấy kraft' } },
        categoryIds: [cat!.id],
        variants: [{ sku: 'KHAC-HOP-QUA', weightG: 150, priceVnd: 20000, vatBp: 1000 }],
        opening: { costVnd: 12000 },
      },
    });
    expect(empty.status, JSON.stringify(empty.body)).toBe(201);
    const ev = (await h.call('GET', `/api/v1/catalog/items/${empty.body.itemId}`, { cookie: warehouse })).body.variants[0];
    expect(ev.stock).toMatchObject({ onHand: 0 });
    expect(ev.avgCostVnd).toBe(12000);
    const drift = await h.t.sql`select 1 from inventory.stock_level s where s.on_hand <> (select coalesce(sum(qty_delta), 0) from inventory.stock_movement m where m.variant_id = s.variant_id and m.location = s.location)`;
    expect(drift).toHaveLength(0);
    // Setting a cost needs catalog.import or purchasing.manage.
    const denied = await h.call('POST', '/api/v1/catalog/items', { cookie: cashier, body: { kind: 'other', i18n: { en: { title: 'X', description: 'X' } }, categoryIds: [cat!.id], variants: [{ sku: 'KHAC-X', weightG: 1, priceVnd: 1, vatBp: 1000 }], opening: { costVnd: 1 } } });
    expect(denied.status).toBe(403);
  });
});

describe('adjustments (FR-INV-07)', () => {
  it('posts small adjustments with a reason; large ones need approval', async () => {
    // Lower the threshold so two units (about 111.000 ₫) need approval.
    expect((await h.call('PUT', '/api/v1/admin/settings', { cookie: owner, body: { 'inventory.adjust_approval_vnd': 100000 } })).status).toBe(204);
    const small = await h.call('POST', '/api/v1/inventory/adjustments', { cookie: warehouse, body: { variantId: bookVariant, qtyDelta: -1, reasonCode: 'damaged', writeOff: true } });
    expect(small.status, JSON.stringify(small.body)).toBe(201);
    expect(small.body.docNo).toBe('DC-2026-00001');

    const big = { variantId: bookVariant, qtyDelta: -2, reasonCode: 'lost' };
    const denied = await h.call('POST', '/api/v1/inventory/adjustments', { cookie: warehouse, body: big });
    expect(denied.body.error).toMatchObject({ code: 'approval_required', details: { thresholdVnd: 100000 } });

    const approval = await h.call('POST', '/api/v1/auth/approve', {
      cookie: warehouse,
      body: { approverUsername: 'lan', pin: '246810', action: 'stock_adjustment', subject: bookVariant },
    });
    const ok = await h.call('POST', '/api/v1/inventory/adjustments', { cookie: warehouse, body: { ...big, approvalToken: approval.body.approvalToken } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    // The approval is single use.
    const reuse = await h.call('POST', '/api/v1/inventory/adjustments', { cookie: warehouse, body: { ...big, approvalToken: approval.body.approvalToken } });
    expect(reuse.body.error.code).toBe('approval_required');
    // A user holding the approving permission needs no token.
    expect((await h.call('POST', '/api/v1/inventory/adjustments', { cookie: owner, body: { ...big, qtyDelta: 2, reasonCode: 'found' } })).status).toBe(201);
  });

  it('keeps the ledger equal to the stock level (TDD §5.4)', async () => {
    const [row] = await h.t.sql`
      select s.on_hand, (select sum(qty_delta) from inventory.stock_movement m where m.variant_id = s.variant_id)::int as ledger
      from inventory.stock_level s where s.variant_id = ${bookVariant}`;
    expect(row!.on_hand).toBe(row!.ledger);
    expect(row!.on_hand).toBe(15);
    const mv = await h.call('GET', `/api/v1/inventory/movements?variant=${bookVariant}`, { cookie: warehouse });
    expect(mv.body.items.map((m: { type: string }) => m.type)).toEqual(['adjustment', 'adjustment', 'write_off', 'stock_in', 'stock_in', 'stock_in']);
  });
});

describe('blind stock count (FR-INV-06, UC-07)', () => {
  it('hides expected quantities from counters and posts variances on approval', async () => {
    const c = await h.call('POST', '/api/v1/inventory/counts', { cookie: warehouse, body: { scope: { kind: 'variants', variantIds: [bookVariant] }, blind: true } });
    expect(c.body.docNo).toBe('KK-2026-00001');
    const view = await h.call('GET', `/api/v1/inventory/counts/${c.body.id}`, { cookie: warehouse });
    expect(view.body.lines[0]).not.toHaveProperty('expected');
    for (let i = 0; i < 5; i++) await h.call('POST', `/api/v1/inventory/counts/${c.body.id}/lines`, { cookie: warehouse, body: { variantId: bookVariant, qty: 1 } });
    expect((await h.call('POST', `/api/v1/inventory/counts/${c.body.id}/approve`, { cookie: warehouse })).status).toBe(403);
    expect((await h.call('POST', `/api/v1/inventory/counts/${c.body.id}/submit`, { cookie: warehouse })).status).toBe(204);
    const asOwner = await h.call('GET', `/api/v1/inventory/counts/${c.body.id}`, { cookie: owner });
    expect(asOwner.body.lines[0]).toMatchObject({ expected: 15, counted: 5, variance: -10 });
    expect((await h.call('POST', `/api/v1/inventory/counts/${c.body.id}/approve`, { cookie: owner })).body.posted).toBe(1);
    const lv = await h.call('GET', `/api/v1/inventory/levels?variant=${bookVariant}`, { cookie: warehouse });
    expect(lv.body.items[0].onHand).toBe(5);
  });

  it('scopes by product type, round-trips the count sheet and can be cancelled before approval', async () => {
    const c = await h.call('POST', '/api/v1/inventory/counts', { cookie: warehouse, body: { scope: { kind: 'types', itemKinds: ['book'] }, blind: true } });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const view = (await h.call('GET', `/api/v1/inventory/counts/${c.body.id}`, { cookie: warehouse })).body as { lines: { sku: string }[] };
    expect(view.lines.map((l) => l.sku)).toContain('SACH-NNA-0012');
    expect(view.lines.every((l) => l.sku.startsWith('SACH'))).toBe(true);

    const req = (method: string, path: string, body?: Uint8Array, mime = 'text/csv') =>
      h.app.request(path, { method, headers: { origin: ORIGIN, 'x-bms-request': '1', cookie: warehouse, 'content-type': mime }, ...(body && { body: body as never }) });
    // CSV sheet: blind, so no expected column.
    const csv = await (await req('GET', `/api/v1/inventory/counts/${c.body.id}/sheet?format=csv`)).text();
    const head = csv.replace(/^﻿/, '').split('\r\n')[0]!;
    expect(head).toBe('SKU,Sản phẩm,Đếm được');
    expect((await req('GET', `/api/v1/inventory/counts/${c.body.id}/sheet`)).headers.get('content-type')).toContain('spreadsheetml');

    // A bad row rejects the whole upload; a good one sets the counts.
    const bad = await req('POST', `/api/v1/inventory/counts/${c.body.id}/sheet`, new TextEncoder().encode('﻿SKU,Sản phẩm,Đếm được\r\nNOPE,x,3\r\n'));
    expect(bad.status).toBe(422);
    const ok = await req('POST', `/api/v1/inventory/counts/${c.body.id}/sheet`, new TextEncoder().encode('﻿SKU,Sản phẩm,Đếm được\r\nSACH-NNA-0012,x,7\r\n'));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ updated: 1, counted: 1 });

    expect((await h.call('POST', `/api/v1/inventory/counts/${c.body.id}/cancel`, { cookie: warehouse })).status).toBe(204);
    expect((await h.call('GET', `/api/v1/inventory/counts/${c.body.id}`, { cookie: warehouse })).body.status).toBe('cancelled');
    expect((await h.call('POST', `/api/v1/inventory/counts/${c.body.id}/cancel`, { cookie: warehouse })).status).toBe(409);
  });
});

describe('consignment stock-in (FR-PUR-09)', () => {
  it('creates a lot, no payable and leaves the average cost unchanged', async () => {
    const before = (await h.call('GET', `/api/v1/catalog/items/${bookItem}`, { cookie: warehouse })).body.variants[0].avgCostVnd;
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/existing', {
      cookie: warehouse,
      body: { supplierId: consignorId, consignment: true, consignmentDiscountBp: 3000, line: { variantId: bookVariant, costVnd: 73500, sellingPriceVnd: 105000, qty: 20 } },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.payableId).toBeNull();
    const after = (await h.call('GET', `/api/v1/catalog/items/${bookItem}`, { cookie: warehouse })).body.variants[0];
    expect(after.avgCostVnd).toBe(before);
    expect(after.stock.onHand).toBe(25);
    const [lot] = await h.t.sql`select qty_received, discount_bp from purchasing.consignment_lot where variant_id = ${bookVariant}`;
    expect(lot).toMatchObject({ qty_received: 20, discount_bp: 3000 });
    const notConsignor = await h.call('POST', '/api/v1/purchasing/stock-in/existing', {
      cookie: warehouse,
      body: { supplierId, consignment: true, line: { variantId: bookVariant, costVnd: 1, sellingPriceVnd: 105000, qty: 1 } },
    });
    expect(notConsignor.body.error.code).toBe('not_a_consignor');
  });
});

describe('payables (FR-PUR-06)', () => {
  it('needs the payables permission, ages balances and refuses overpayment', async () => {
    expect((await h.call('GET', '/api/v1/purchasing/payables', { cookie: warehouse })).status).toBe(403);
    const list = await h.call('GET', '/api/v1/purchasing/payables', { cookie: owner });
    const first = list.body.items.find((p: { amountVnd: number }) => p.amountVnd === 500000);
    expect(first).toMatchObject({ balanceVnd: 500000, ageingBucket: 'current' });
    const pay = await h.call('POST', `/api/v1/purchasing/payables/${first.id}/payments`, { cookie: owner, body: { amountVnd: 200000, method: 'transfer' } });
    expect(pay.body).toEqual({ balanceVnd: 300000, status: 'open' });
    const over = await h.call('POST', `/api/v1/purchasing/payables/${first.id}/payments`, { cookie: owner, body: { amountVnd: 400000, method: 'cash' } });
    expect(over.body.error.code).toBe('overpayment');
    h.clock.advance(45 * 86_400_000);
    const aged = await h.call('GET', '/api/v1/purchasing/payables', { cookie: await h.login('lan', 'chu-cua-hang-2026') });
    expect(aged.body.items.find((p: { id: string }) => p.id === first.id).ageingBucket).toBe('1-30');
  });
});

describe('no overselling under concurrency (TDD §13.2)', () => {
  it('ten parallel sales of the last unit: exactly one succeeds', async () => {
    const [v] = await h.t.sql`select v.id from catalog.item_variant v where v.sku = 'VPP-0012'`;
    const variantId = v!.id as string;
    const [lvl] = await h.t.sql`select on_hand from inventory.stock_level where variant_id = ${variantId}`;
    // Leave exactly one unit.
    await h.t.db.transaction((tx) =>
      inventory.apply(tx, h.ctx(), { variantId, type: 'adjustment', qtyDelta: -(lvl!.on_hand - 1), refType: 'test', refId: variantId, force: true }),
    );
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        h.t.db.transaction((tx) => inventory.apply(tx, h.ctx(), { variantId, type: 'sale', qtyDelta: -1, refType: 'test', refId: variantId })),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected');
    expect(rejected.every((a) => (a.reason as { code?: string }).code === 'insufficient_stock')).toBe(true);
    const [after] = await h.t.sql`select on_hand from inventory.stock_level where variant_id = ${variantId}`;
    expect(after!.on_hand).toBe(0);
  });
});
