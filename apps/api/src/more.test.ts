import { CUSTOMER_REFS } from '@bookstore/modules/customers';
import { readTable } from '@bookstore/modules/imports';
import * as jobs from '@bookstore/modules/jobs';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, startHarness, type Harness } from './testing.js';

/** Master data, customer merge/history/export, labels, catalogue export, offline returns. */
let h: Harness;
let owner: string;
let cashier: string;
let warehouse: string;
let manager: string;
let roles: Record<string, string>;
let book: string;
let shiftId: string;
let registerId: string;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

beforeAll(async () => {
  h = await startHarness();
  ({ owner, roles } = await h.setupOwner());
  cashier = await h.staff(owner, 'thu', roles.cashier!);
  warehouse = await h.staff(owner, 'kho', roles.warehouse!);
  manager = await h.staff(owner, 'quanly', roles.manager!, '112233');
  const cat = (await h.call('POST', '/api/v1/catalog/categories', { cookie: owner, body: { i18n: { en: { name: 'Children' } } } })).body.id;
  const supplier = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Fahasa', kind: 'distributor' } })).body.id;
  const r = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', {
    cookie: owner,
    body: {
      supplierId: supplier,
      line: {
        item: { kind: 'book', i18n: { en: { title: 'Ticket to Childhood', description: 'Novel' }, vi: { title: 'Cho tôi xin một vé đi tuổi thơ' } }, authors: ['Nguyễn Nhật Ánh'], categoryIds: [cat] },
        variant: { sku: 'SACH-NNA-0012', isbn: '9786041234567', weightG: 250, vatBp: 0, listPriceVnd: 120000 },
        imageFileIds: ['00000000-0000-7000-8000-00000000000a'],
        costVnd: 50000,
        sellingPriceVnd: 98000,
        qty: 20,
      },
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  book = r.body.lines[0].variantId;
  registerId = (await h.call('GET', '/api/v1/pos/registers', { cookie: cashier })).body.items[0].id;
  shiftId = (await h.call('POST', '/api/v1/pos/shifts/open', { cookie: cashier, body: { registerId, floatVnd: 0 } })).body.id;
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

const sell = async (customerId: string | null, qty = 1) => {
  const r = await h.call('POST', '/api/v1/pos/sales', {
    cookie: cashier,
    body: { lines: [{ lineId: 'a', variantId: book, qty }], shiftId, customerId, payments: [{ method: 'cash', amountVnd: 98000 * qty }] },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
};

describe('master data (FR-ADM-10)', () => {
  it('is seeded, readable by staff and editable by the owner', async () => {
    const reasons = (await h.call('GET', '/api/v1/admin/master-data/reason_code', { cookie: warehouse })).body.items;
    expect(reasons.map((r: { code: string }) => r.code)).toEqual(['damaged', 'lost', 'found', 'correction', 'gift']);
    expect((await h.call('GET', '/api/v1/admin/master-data/order_source', { cookie: cashier })).body.items).toHaveLength(8);
    expect((await h.call('PUT', '/api/v1/admin/master-data/reason_code/gift', { cookie: manager, body: { name: 'x' } })).status).toBe(403);
    const renamed = await h.call('PUT', '/api/v1/admin/master-data/reason_code/damaged', { cookie: owner, body: { name: 'Hỏng, rách' } });
    expect(renamed.status).toBe(200);
    expect((await h.call('PUT', '/api/v1/admin/master-data/payment_method/voucher', { cookie: owner, body: { name: 'Voucher' } })).body.error.code).toBe('fixed_codes');
    expect((await h.call('PUT', '/api/v1/admin/master-data/holiday/tet-2027', { cookie: owner, body: { name: 'Tết' } })).body.error.code).toBe('date_required');
    expect((await h.call('PUT', '/api/v1/admin/master-data/holiday/tet-2027', { cookie: owner, body: { name: 'Tết', date: '2027-02-06' } })).status).toBe(200);
  });

  it('stock adjustments must use an active reason code', async () => {
    await h.call('PUT', '/api/v1/admin/master-data/reason_code/gift', { cookie: owner, body: { name: 'Tặng', active: false, sort: 5 } });
    const inactive = await h.call('POST', '/api/v1/inventory/adjustments', { cookie: warehouse, body: { variantId: book, qtyDelta: -1, reasonCode: 'gift' } });
    expect(inactive.body.error.code).toBe('invalid_reason_code');
    expect((await h.call('POST', '/api/v1/inventory/adjustments', { cookie: warehouse, body: { variantId: book, qtyDelta: -1, reasonCode: 'nope' } })).status).toBe(400);
    expect((await h.call('POST', '/api/v1/inventory/adjustments', { cookie: warehouse, body: { variantId: book, qtyDelta: -1, reasonCode: 'damaged' } })).status).toBe(201);
  });
});

describe('customer merge (FR-CRM-02, TDD §4.9)', () => {
  it('the reference registry covers every foreign key to customers', async () => {
    const fks = await h.t.sql<{ ref: string }[]>`
      select tc.table_schema || '.' || tc.table_name || ':' || kcu.column_name as ref
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and ccu.table_schema = 'crm' and ccu.table_name = 'customer'`;
    const registered = new Set(CUSTOMER_REFS.map((r) => `${r.table}:${r.column}`));
    for (const fk of fks) expect(registered.has(fk.ref), `${fk.ref} must be in CUSTOMER_REFS`).toBe(true);
  });

  it('moves history and points to the kept profile and anonymises the duplicate', async () => {
    const a = (await h.call('POST', '/api/v1/customers', { cookie: cashier, body: { name: 'Trần Thị B', phone: '0912345678' } })).body.id;
    const b = (await h.call('POST', '/api/v1/customers', { cookie: cashier, body: { name: 'Tran Thi B', phone: '0987654321', email: 'b@example.com' } })).body.id;
    await sell(a);
    const saleB = await sell(b, 2);
    expect((await h.call('POST', `/api/v1/customers/${a}/merge`, { cookie: cashier, body: { sourceId: a } })).body.error.code).toBe('same_customer');
    const r = await h.call('POST', `/api/v1/customers/${a}/merge`, { cookie: cashier, body: { sourceId: b } });
    expect(r.body).toMatchObject({ pointsMoved: 19 });

    const kept = (await h.call('GET', `/api/v1/customers/${a}`, { cookie: cashier })).body;
    expect(kept).toMatchObject({ pointsBalance: 9 + 19, email: 'b@example.com' });
    const [s] = await h.t.sql`select customer_id from sales.sale where id = ${saleB.id}`;
    expect(s!.customer_id).toBe(a);
    const [gone] = await h.t.sql`select phone_e164, merged_into, anonymised_at from crm.customer where id = ${b}`;
    expect(gone).toMatchObject({ phone_e164: null, merged_into: a });
    const [contact] = await h.t.sql`select value from crm.customer_contact where customer_id = ${a} and kind = 'phone'`;
    expect(contact!.value).toBe('+84987654321');
    expect((await h.call('POST', `/api/v1/customers/${a}/merge`, { cookie: cashier, body: { sourceId: b } })).body.error.code).toBe('customer_erased');
    expect(await jobs.integrityCheck(h.ctx())).toEqual([]);

    const history = (await h.call('GET', `/api/v1/customers/${a}/purchases`, { cookie: cashier })).body;
    expect(history.totals).toEqual({ orders: 2, grossVnd: 3 * 98000, returnsVnd: 0, netVnd: 3 * 98000 });
  });

  it('exports personal data only with permission, and audits it (FR-CRM-08)', async () => {
    const a = (await h.call('GET', '/api/v1/customers?phone=0912345678', { cookie: cashier })).body.items[0].id;
    expect((await h.call('GET', `/api/v1/customers/${a}/export`, { cookie: cashier })).status).toBe(403);
    const res = await h.app.request(`/api/v1/customers/${a}/export`, { headers: { cookie: manager } });
    const data = (await res.json()) as { profile: { phone: string }; pointsLedger: unknown[]; purchases: { totals: { orders: number } } };
    expect(data.profile.phone).toBe('+84912345678');
    expect(data.pointsLedger.length).toBeGreaterThan(0);
    expect(data.purchases.totals.orders).toBe(2);
    const audit = (await h.call('GET', `/api/v1/admin/audit?action=customer.export`, { cookie: manager })).body.items;
    expect(audit[0]).toMatchObject({ entityId: a });
  });
});

describe('labels (FR-CAT-13, Design §16.4)', () => {
  it('renders an A4 sheet with blank leading cells, prices and barcodes', async () => {
    const res = await h.app.request('/api/v1/catalog/labels', {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-bms-request': '1', cookie: cashier, 'content-type': 'application/json' },
      body: JSON.stringify({ template: 'shelf', items: [{ variantId: book, copies: 3 }], startPosition: 3 }),
    });
    const html = await res.text();
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(html).toContain('@page { size: 210mm 297mm');
    expect(html.match(/<div class="cell"><\/div>/g)).toHaveLength(2);
    expect(html.match(/class="shelf"/g)).toHaveLength(3);
    expect(html).toContain('98.000 ₫');
    expect(html).toContain('Cho tôi xin một vé đi tuổi thơ');
    expect(html).toContain('>9786041234567</text>'); // ISBN as EAN-13
  });

  it('sale-price overlay strikes the list price', async () => {
    const res = await h.app.request('/api/v1/catalog/labels', {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-bms-request': '1', cookie: cashier, 'content-type': 'application/json' },
      body: JSON.stringify({ template: 'sale_price', sheet: 'roll', items: [{ variantId: book }] }),
    });
    const html = await res.text();
    expect(html).toContain('<s>120.000 ₫</s><b>98.000 ₫</b>');
    expect(html).toContain('size: 30mm 20mm');
  });
});

describe('catalogue export (FR-CAT-11)', () => {
  it('exports in the import layout; cost only with permission; re-import detects duplicates', async () => {
    expect((await h.app.request('/api/v1/catalog/export', { headers: { cookie: cashier } })).status).toBe(403);
    const res = await h.app.request('/api/v1/catalog/export', { headers: { cookie: warehouse } });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const table = await readTable(bytes, XLSX);
    expect(table[0]).toContain('Giá nhập');
    expect(table[1]!.slice(0, 4)).toEqual(['SACH-NNA-0012', '9786041234567', 'Sách', 'Ticket to Childhood']);
    const role = await h.call('POST', '/api/v1/admin/roles', { cookie: owner, body: { name: 'Nhập liệu', permissions: ['catalog.import', 'catalog.view'] } });
    const clerk = await h.staff(owner, 'nhaplieu', role.body.id);
    const noCost = await readTable(new Uint8Array(await (await h.app.request('/api/v1/catalog/export', { headers: { cookie: clerk } })).arrayBuffer()), XLSX);
    expect(noCost[0]).not.toContain('Giá nhập');
    const preview = await h.app.request('/api/v1/admin/import/products/preview', {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-bms-request': '1', cookie: warehouse, 'content-type': XLSX },
      body: bytes as never,
    });
    const p = (await preview.json()) as { summary: { rows: number; errorRows: number }; rows: { errors: { message: string }[] }[] };
    expect(p.summary).toMatchObject({ rows: 1, errorRows: 1 });
    expect(p.rows[0]!.errors[0]!.message).toMatch(/SKU đã có/);
  });
});

describe('offline returns of device sales (TDD §7.1)', () => {
  it('accepts a return of a sale made on this device and rejects others', async () => {
    const keys = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
    const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', keys.publicKey)).toString('base64');
    await h.call('POST', `/api/v1/pos/shifts/close`, { cookie: cashier, body: { shiftId, countedVnd: 0, varianceReason: 'Chuyển sang thiết bị' } });
    expect((await h.call('POST', '/api/v1/pos/devices', { cookie: manager, body: { registerId, deviceCode: 'T1', publicKey: spki } })).status).toBe(201);
    const users = (await h.call('GET', '/api/v1/admin/users', { cookie: owner })).body.items;
    const cashierId = users.find((u: { username: string }) => u.username === 'thu').id;
    const sync = async (events: unknown[]) => {
      const raw = new TextEncoder().encode(JSON.stringify({ cursor: 0, events }));
      const ts = h.clock.now().toISOString();
      const msg = `POST\n/pos/v1/sync\n${ts}\n${createHash('sha256').update(raw).digest('hex')}`;
      const sig = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(msg))).toString('base64');
      const res = await h.app.request('/pos/v1/sync', {
        method: 'POST',
        headers: { origin: ORIGIN, cookie: cashier, 'content-type': 'application/json', 'x-device-code': 'T1', 'x-device-timestamp': ts, 'x-device-signature': sig },
        body: raw as never,
      });
      return ((await res.json()) as { results: { status: string; code?: string; exceptions?: string[] }[] }).results;
    };
    const clientShiftId = randomUUID();
    const now = h.clock.now().toISOString();
    const base = { createdAt: now };
    const line = { variantId: book, description: 'Book', qty: 2, unitPriceVnd: 98000, discountVnd: 0, totalVnd: 196000, vatBp: 0, vatVnd: 0 };
    const results = await sync([
      { ...base, clientEventId: randomUUID(), seq: 1, type: 'shift.opened', payload: { clientShiftId, floatVnd: 0, openedBy: cashierId, openedAt: now } },
      {
        ...base,
        clientEventId: randomUUID(),
        seq: 2,
        type: 'sale.completed',
        payload: { docNo: 'T1-000001', clientShiftId, cashierId, soldAt: now, lines: [line], payments: [{ method: 'cash', amountVnd: 196000 }], subtotalVnd: 196000, discountVnd: 0, totalVnd: 196000, vatVnd: 0 },
      },
      { ...base, clientEventId: randomUUID(), seq: 3, type: 'sale.returned', payload: { saleDocNo: 'T1-000001', clientShiftId, lines: [{ lineNo: 1, qty: 1, restock: true }], refundMethod: 'cash', by: cashierId, at: now } },
      { ...base, clientEventId: randomUUID(), seq: 4, type: 'sale.returned', payload: { saleDocNo: 'HD-2026-00001', clientShiftId, lines: [{ lineNo: 1, qty: 1, restock: true }], refundMethod: 'cash', by: cashierId, at: now } },
      { ...base, clientEventId: randomUUID(), seq: 5, type: 'sale.returned', payload: { saleDocNo: 'T1-000001', clientShiftId, lines: [{ lineNo: 1, qty: 5, restock: true }], refundMethod: 'cash', by: cashierId, at: now } },
    ]);
    expect(results.map((r) => r.code ?? r.status)).toEqual(['accepted', 'accepted', 'accepted', 'sale_not_on_device', 'return_exceeds_sold']);
    const [ret] = await h.t.sql`select r.refund_vnd from sales.sale_return r join sales.sale s on s.id = r.sale_id where s.doc_no = 'T1-000001'`;
    expect(Number(ret!.refund_vnd)).toBe(98000);
    expect(await jobs.integrityCheck(h.ctx())).toEqual([]);
  });
});
