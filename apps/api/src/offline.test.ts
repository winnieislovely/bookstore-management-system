import * as jobs from '@bookstore/modules/jobs';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORIGIN, startHarness, type Harness } from './testing.js';

/** Offline POS sync (FR-POS-23..26, NFR-OFF-01..03, TDD §7, §13.2). */
let h: Harness;
let owner: string;
let manager: string;
let cashier: string;
let roles: Record<string, string>;
let registerId: string;
let deviceId: string;
let cashierId: string;
let managerId: string;
let customerId: string;
let book: string;
let pen: string;
let keys: webcrypto.CryptoKeyPair;
const clientShiftId = randomUUID();

beforeAll(async () => {
  h = await startHarness();
  ({ owner, roles } = await h.setupOwner());
  manager = await h.staff(owner, 'quanly', roles.manager!, '112233');
  cashier = await h.staff(owner, 'thu', roles.cashier!);
  const users = (await h.call('GET', '/api/v1/admin/users', { cookie: owner })).body.items;
  cashierId = users.find((u: { username: string }) => u.username === 'thu').id;
  managerId = users.find((u: { username: string }) => u.username === 'quanly').id;
  const cat = (await h.call('POST', '/api/v1/catalog/categories', { cookie: owner, body: { i18n: { en: { name: 'Books' } } } })).body.id;
  const supplier = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Fahasa', phone: '0900000000' } })).body.id;
  const mk = async (sku: string, price: number, qty: number) => {
    const r = await h.call('POST', '/api/v1/purchasing/stock-in/new-product', {
      cookie: owner,
      body: {
        supplierId: supplier,
        line: {
          item: { kind: 'book', i18n: { en: { title: sku, description: sku } }, categoryIds: [cat] },
          variant: { sku, weightG: 100, vatBp: 0 },
          imageFileIds: ['00000000-0000-7000-8000-00000000000a'],
          costVnd: price / 2,
          sellingPriceVnd: price,
          qty,
        },
      },
    });
    return r.body.lines[0].variantId as string;
  };
  book = await mk('BOOK', 100000, 2);
  pen = await mk('PEN', 6000, 50);
  customerId = (await h.call('POST', '/api/v1/customers', { cookie: cashier, body: { name: 'Khách A', phone: '0901234567' } })).body.id;
  registerId = (await h.call('GET', '/api/v1/pos/registers', { cookie: cashier })).body.items[0].id;
  keys = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

async function deviceCall(method: string, path: string, cookie: string, body?: unknown, opts: { code?: string; skewMs?: number; tamper?: boolean } = {}) {
  const raw = body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body));
  const timestamp = new Date(h.clock.now().getTime() + (opts.skewMs ?? 0)).toISOString();
  const message = `${method}\n${path}\n${timestamp}\n${createHash('sha256').update(raw).digest('hex')}`;
  const sig = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(opts.tamper ? `${message}x` : message))).toString('base64');
  const res = await h.app.request(path, {
    method,
    headers: { origin: ORIGIN, cookie, 'x-device-code': opts.code ?? 'Q1', 'x-device-timestamp': timestamp, 'x-device-signature': sig, ...(body !== undefined && { 'content-type': 'application/json' }) },
    ...(body !== undefined && { body: raw as never }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const at = (minutes: number) => new Date(h.clock.now().getTime() + minutes * 60_000).toISOString();
let seq = 0;
const ev = (type: string, payload: Record<string, unknown>) => ({ clientEventId: randomUUID(), seq: seq++, createdAt: at(0), type, payload });
const line = (variantId: string, qty: number, unit: number, extra: Record<string, unknown> = {}) => ({
  variantId,
  description: variantId === book ? 'BOOK' : 'PEN',
  qty,
  unitPriceVnd: unit,
  discountVnd: 0,
  totalVnd: unit * qty,
  vatBp: 0,
  vatVnd: 0,
  ...extra,
});
const sale = (docNo: string, lines: ReturnType<typeof line>[], payments: unknown[], extra: Record<string, unknown> = {}) => {
  const total = lines.reduce((a, l) => a + l.totalVnd, 0);
  return ev('sale.completed', { docNo, clientShiftId, cashierId, soldAt: at(0), lines, payments, subtotalVnd: total, discountVnd: 0, totalVnd: total, vatVnd: 0, ...extra });
};

describe('device registration and authentication (TDD §7.2)', () => {
  it('only managers register devices; requests must be signed', async () => {
    const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', keys.publicKey)).toString('base64');
    expect((await h.call('POST', '/api/v1/pos/devices', { cookie: cashier, body: { registerId, publicKey: spki } })).status).toBe(403);
    const r = await h.call('POST', '/api/v1/pos/devices', { cookie: manager, body: { registerId, publicKey: spki } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // The code comes from the register code (TDD §7.2).
    expect(r.body.deviceCode).toBe('Q1');
    deviceId = r.body.id;
    // A second device on the same register gets the next free code.
    const other = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as webcrypto.CryptoKeyPair;
    const otherSpki = Buffer.from(await webcrypto.subtle.exportKey('spki', other.publicKey)).toString('base64');
    expect((await h.call('POST', '/api/v1/pos/devices', { cookie: manager, body: { registerId, publicKey: otherSpki } })).body.deviceCode).toBe('Q1B');
    expect((await h.app.request('/pos/v1/bootstrap', { headers: { cookie: cashier } })).status).toBe(401);
    expect((await deviceCall('GET', '/pos/v1/bootstrap', cashier, undefined, { tamper: true })).body.error.code).toBe('device_signature_invalid');
    expect((await deviceCall('GET', '/pos/v1/bootstrap', cashier, undefined, { code: 'ZZ' })).body.error.code).toBe('device_unknown');
  });

  it('bootstrap caches what selling needs, approvers’ PIN verifiers, and no cost data', async () => {
    const b = await deviceCall('GET', '/pos/v1/bootstrap', cashier);
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(b.body.items.map((i: { sku: string }) => i.sku)).toEqual(['BOOK', 'PEN']);
    expect(b.body.items[0]).not.toHaveProperty('avgCostVnd');
    expect(b.body.cursor).toBeGreaterThan(0);
    expect(b.body.customers[0]).toMatchObject({ id: customerId, pointsBalance: 0 });
    const approver = b.body.approvers.find((a: { username: string }) => a.username === 'quanly');
    expect(approver.pinVerifier).toMatch(/^\$argon2id\$/);
    expect(approver.actions).toContain('void_sale');
    expect(b.body.approvers.map((a: { username: string }) => a.username)).not.toContain('thu');
    expect(new Date(b.body.device.leaseExpiresAt).getTime() - h.clock.now().getTime()).toBe(72 * 3600_000);
  });
});

describe('synchronisation (TDD §7.5, §7.6)', () => {
  let batch: ReturnType<typeof ev>[];

  it('accepts offline sales as facts and raises exceptions for a manager', async () => {
    seq = 0;
    batch = [
      ev('shift.opened', { clientShiftId, floatVnd: 500000, openedBy: cashierId, openedAt: at(0) }),
      // 1. plain cash sale with a customer: points recomputed on the server
      sale('Q1-000001', [line(pen, 5, 6000)], [{ method: 'cash', amountVnd: 30000, tenderedVnd: 50000 }], { customerId }),
      // 2. bank transfer taken offline: unverified
      sale('Q1-000002', [line(pen, 1, 6000)], [{ method: 'transfer', amountVnd: 6000, ref: 'K7M2X9PQ' }]),
      // 3. sells 3 books while only 2 are in stock: negative stock
      sale('Q1-000003', [line(book, 3, 100000)], [{ method: 'card', amountVnd: 300000, ref: 'APPR' }]),
      // 4. device price differs from the server price: price drift
      sale('Q1-000004', [line(pen, 1, 5000)], [{ method: 'cash', amountVnd: 5000 }]),
      // 5. redeems more points than the customer really has: floored at zero
      sale('Q1-000005', [line(pen, 2, 6000, { discountVnd: 0 })], [{ method: 'cash', amountVnd: 12000 }], { customerId, redeemPoints: 50 }),
      // 6. an offline supervisor approval
      sale('Q1-000006', [line(pen, 1, 6000)], [{ method: 'cash', amountVnd: 6000 }], { approvals: [{ approverId: managerId, action: 'discount_over_limit' }] }),
      ev('cash.movement', { clientShiftId, direction: 'out', amountVnd: 20000, reason: 'Mua nước', by: cashierId, at: at(0) }),
      ev('shift.closed', { clientShiftId, countedVnd: 400000, varianceReason: 'Đếm thiếu', closedBy: cashierId, closedAt: at(1) }),
    ];
    // Arrives shuffled: the server processes in seq order.
    const shuffled = [...batch].reverse();
    const r = await deviceCall('POST', '/pos/v1/sync', cashier, { cursor: 0, events: shuffled });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const byDoc = (i: number) => r.body.results.find((x: { clientEventId: string }) => x.clientEventId === batch[i]!.clientEventId);
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(Array(9).fill('accepted'));
    expect(byDoc(1).exceptions).toEqual([]);
    expect(byDoc(2).exceptions).toEqual(['unverified_transfer']);
    expect(byDoc(3).exceptions).toEqual(['negative_stock']);
    expect(byDoc(4).exceptions).toEqual(['price_drift']);
    expect(byDoc(5).exceptions).toEqual(['points_overdrawn']);
    expect(byDoc(6).exceptions).toEqual(['offline_approval']);

    const [lvl] = await h.t.sql`select on_hand from inventory.stock_level where variant_id = ${book}`;
    expect(lvl!.on_hand).toBe(-1);
    const [c] = await h.t.sql`select points_balance from crm.customer where id = ${customerId}`;
    // Sale 1 earns 3 points (30.000 ₫); sale 5 redeems what is left (floor 0), then earns 1.
    expect(c!.points_balance).toBe(1);
    const [s] = await h.t.sql`select offline, device_id, doc_no from sales.sale where doc_no = 'Q1-000001'`;
    expect(s).toMatchObject({ offline: true, device_id: deviceId });
    const [jobsN] = await h.t.sql`select count(*)::int as n from sales.einvoice_job`;
    expect(jobsN!.n).toBe(6); // e-invoices for offline sales are issued after reconnection
    const [shift] = await h.t.sql`select closed_at, expected_vnd, counted_vnd, variance_vnd from sales.shift where client_id = ${clientShiftId}`;
    // Float 500.000 + cash 30.000 + 5.000 + 12.000 + 6.000 − 20.000 out = 533.000
    expect(shift).toMatchObject({ expected_vnd: '533000', counted_vnd: '400000', variance_vnd: '-133000' });
    expect((await h.call('GET', '/api/v1/notifications', { cookie: manager })).body.items[0]).toMatchObject({ template: 'shift.variance_exceeded' });
  });

  it('replaying the same batch is harmless (NFR-OFF-03)', async () => {
    const counts = async () => (await h.t.sql`select (select count(*) from sales.sale)::int as s, (select count(*) from inventory.stock_movement)::int as m, (select count(*) from crm.points_ledger)::int as p`)[0];
    const before = await counts();
    const r = await deviceCall('POST', '/pos/v1/sync', cashier, { cursor: 0, events: batch });
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual(Array(9).fill('duplicate'));
    expect(await counts()).toEqual(before);
  });

  it('a bad event is rejected with its payload kept; later events still run', async () => {
    seq = 100;
    const unknown = sale('Q1-000007', [line(randomUUID(), 1, 1000)], [{ method: 'cash', amountVnd: 1000 }]);
    const wrongPrefix = sale('X9-000001', [line(pen, 1, 6000)], [{ method: 'cash', amountVnd: 6000 }]);
    // A server shift for the register is needed for sales after the offline shift closed.
    const open = await h.call('POST', '/api/v1/pos/shifts/open', { cookie: cashier, body: { registerId, floatVnd: 0 } });
    const good = { ...sale('Q1-000008', [line(pen, 1, 6000)], [{ method: 'cash', amountVnd: 6000 }]), payload: { ...sale('x', [line(pen, 1, 6000)], []).payload } };
    good.payload = { ...good.payload, docNo: 'Q1-000008', clientShiftId: undefined, shiftId: open.body.id, payments: [{ method: 'cash', amountVnd: 6000 }] };
    const r = await deviceCall('POST', '/pos/v1/sync', cashier, { cursor: 0, events: [unknown, wrongPrefix, good] });
    expect(r.body.results.map((x: { status: string; code?: string }) => x.code ?? x.status)).toEqual(['rejected_unknown_variant', 'invalid_doc_no', 'accepted']);
    const ex = (await h.call('GET', '/api/v1/pos/sync/exceptions', { cookie: manager })).body.items;
    expect(ex.map((e: { exceptions: string[] }) => e.exceptions[0])).toEqual(
      expect.arrayContaining(['rejected_unknown_variant', 'rejected_invalid_doc_no', 'unverified_transfer', 'negative_stock']),
    );
  });

  it('flags a device clock that is off by more than 5 minutes', async () => {
    seq = 200;
    const shiftId = (await h.call('GET', `/api/v1/pos/shifts/current?register=${registerId}`, { cookie: cashier })).body.shift.id;
    const e = sale('Q1-000009', [line(pen, 1, 6000)], [{ method: 'cash', amountVnd: 6000 }]);
    e.payload = { ...e.payload, clientShiftId: undefined, shiftId };
    const r = await deviceCall('POST', '/pos/v1/sync', cashier, { cursor: 0, events: [e] }, { skewMs: 10 * 60_000 });
    expect(r.body.results[0]).toMatchObject({ status: 'accepted', exceptions: ['clock_skew'] });
  });

  it('returns the catalogue delta: price changes and hidden items (TDD §7.3)', async () => {
    const boot = await deviceCall('GET', '/pos/v1/bootstrap', cashier);
    await h.call('PUT', `/api/v1/catalog/variants/${pen}/price`, { cookie: owner, body: { priceVnd: 7000 } });
    const v = (await h.t.sql`select version from catalog.item_variant where id = ${book}`)[0]!.version;
    await h.call('PATCH', `/api/v1/catalog/variants/${book}`, { cookie: owner, body: { version: v, publishedPos: false } });
    const d = await deviceCall('GET', `/pos/v1/delta?cursor=${boot.body.cursor}`, cashier);
    expect(d.body.upserts).toEqual([expect.objectContaining({ sku: 'PEN', priceVnd: 7000 })]);
    expect(d.body.deletes).toEqual([book]);
    expect(d.body.cursor).toBeGreaterThan(boot.body.cursor);
    expect((await deviceCall('GET', `/pos/v1/delta?cursor=${d.body.cursor}`, cashier)).body.upserts).toEqual([]);
  });
});

describe('manager review (FR-POS-26)', () => {
  it('resolving an unverified transfer confirms the payment', async () => {
    const ex = (await h.call('GET', '/api/v1/pos/sync/exceptions', { cookie: manager })).body.items;
    const transfer = ex.find((e: { exceptions: string[] }) => e.exceptions.includes('unverified_transfer'));
    expect((await h.call('POST', `/api/v1/pos/sync/exceptions/${transfer.id}/resolve`, { cookie: manager, body: { note: '' } })).status).toBe(400);
    const r = await h.call('POST', `/api/v1/pos/sync/exceptions/${transfer.id}/resolve`, { cookie: manager, body: { note: 'Đã thấy tiền vào tài khoản' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [p] = await h.t.sql`select p.verified, p.confirmed_by from sales.sale_payment p join sales.sale s on s.id = p.sale_id where s.doc_no = 'Q1-000002'`;
    expect(p).toMatchObject({ verified: true, confirmed_by: managerId });
    expect((await h.call('GET', '/api/v1/pos/sync/exceptions', { cookie: manager })).body.items.some((e: { id: string }) => e.id === transfer.id)).toBe(false);
    expect((await h.call('GET', '/api/v1/pos/sync/exceptions', { cookie: cashier })).status).toBe(403);
  });

  it('ledgers stay consistent after sync (TDD §5.4)', async () => {
    expect(await jobs.integrityCheck(h.ctx())).toEqual([]);
  });

  it('a revoked device is told to wipe its data (NFR-OFF-02)', async () => {
    expect((await h.call('POST', `/api/v1/pos/devices/${deviceId}/revoke`, { cookie: manager })).status).toBe(204);
    const r = await deviceCall('GET', '/pos/v1/bootstrap', cashier);
    expect(r.status).toBe(401);
    expect(r.body.error).toMatchObject({ code: 'device_revoked', details: { wipe: true } });
  });
});
