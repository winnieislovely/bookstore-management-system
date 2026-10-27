import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './testing.js';

/** Customer and promotion edits (TDD §6.2 PATCH /customers, PATCH /promotions). */
let h: Harness;
let owner: string;
let cashier: string;

beforeAll(async () => {
  h = await startHarness();
  const s = await h.setupOwner();
  owner = s.owner;
  cashier = await h.staff(owner, 'thu', s.roles.cashier!);
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

describe('PATCH /customers/:id (FR-CRM-01)', () => {
  it('edits a profile, keeps the phone unique and checks the version', async () => {
    const a = (await h.call('POST', '/api/v1/customers', { cookie: cashier, body: { name: 'Nguyễn Văn A', phone: '0912345678' } })).body.id;
    await h.call('POST', '/api/v1/customers', { cookie: cashier, body: { name: 'Trần Thị B', phone: '0987654321' } });
    const before = (await h.call('GET', `/api/v1/customers/${a}`, { cookie: cashier })).body;
    const ok = await h.call('PATCH', `/api/v1/customers/${a}`, { cookie: cashier, body: { name: 'Nguyễn Văn An', email: 'an@example.com', version: before.version } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = (await h.call('GET', `/api/v1/customers/${a}`, { cookie: cashier })).body;
    expect(after).toMatchObject({ name: 'Nguyễn Văn An', email: 'an@example.com', version: before.version + 1 });
    expect((await h.call('GET', '/api/v1/customers?q=nguyen van an', { cookie: cashier })).body.items).toHaveLength(1);
    const stale = await h.call('PATCH', `/api/v1/customers/${a}`, { cookie: cashier, body: { name: 'X', version: before.version } });
    expect(stale.status).toBe(412);
    const dup = await h.call('PATCH', `/api/v1/customers/${a}`, { cookie: cashier, body: { phone: '0987 654 321', version: after.version } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_phone');
  });
});

describe('PATCH /promotions/:id (FR-PRM-02)', () => {
  it('creates a new version and updates the coupon', async () => {
    const rule = { type: 'percent', percentBp: 1000, scope: { kind: 'order' }, conditions: { couponCode: 'SALE10' } };
    const p = await h.call('POST', '/api/v1/promotions', { cookie: owner, body: { name: 'Giảm 10%', rule, startsAt: '2026-01-01T00:00:00.000Z' } });
    expect(p.status).toBe(201);
    const listed = (await h.call('GET', '/api/v1/promotions', { cookie: owner })).body.items[0];
    const r = await h.call('PATCH', `/api/v1/promotions/${p.body.id}`, {
      cookie: owner,
      body: { name: 'Giảm 15%', rule: { ...rule, percentBp: 1500, conditions: { couponCode: 'sale15' } }, startsAt: '2026-01-01T00:00:00.000Z', endsAt: null, version: listed.version },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.versionId).not.toBe(p.body.versionId);
    const now = (await h.call('GET', '/api/v1/promotions', { cookie: owner })).body.items[0];
    expect(now).toMatchObject({ name: 'Giảm 15%', rule: { percentBp: 1500 }, version: listed.version + 1 });
    const [c] = await h.t.sql`select code from crm.coupon where promotion_id = ${p.body.id}`;
    expect(c!.code).toBe('SALE15');
    expect((await h.call('PATCH', `/api/v1/promotions/${p.body.id}`, { cookie: owner, body: { name: 'x', rule, startsAt: '2026-01-01T00:00:00.000Z', version: listed.version } })).status).toBe(412);
  });
});

describe('PATCH /purchasing/suppliers/:id', () => {
  it('edits a supplier with a version check and keeps the tax code unique', async () => {
    const a = (await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'NXB Trẻ', phone: '0900000000', taxCode: '0301' } })).body.id;
    await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'Fahasa', phone: '0900000000', taxCode: '0302' } });
    const s = (await h.call('GET', '/api/v1/purchasing/suppliers', { cookie: owner })).body.items.find((x: { id: string }) => x.id === a);
    const ok = await h.call('PATCH', `/api/v1/purchasing/suppliers/${a}`, { cookie: owner, body: { phone: '028 3930 5243', email: 'nxbtre@example.vn', version: s.version } });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = (await h.call('GET', '/api/v1/purchasing/suppliers', { cookie: owner })).body.items.find((x: { id: string }) => x.id === a);
    expect(after).toMatchObject({ phone: '028 3930 5243', email: 'nxbtre@example.vn', version: s.version + 1 });
    // Search by name (accent-insensitive) or phone digits (Design §13.8).
    const names = async (q: string) => ((await h.call('GET', `/api/v1/purchasing/suppliers?q=${encodeURIComponent(q)}`, { cookie: owner })).body.items as { name: string }[]).map((x) => x.name);
    expect(await names('nxb tre')).toEqual(['NXB Trẻ']);
    expect(await names('39305243')).toEqual(['NXB Trẻ']);
    expect(await names('fahasa')).toEqual(['Fahasa']);
    // Phone is required on create (FR-PUR-01).
    expect((await h.call('POST', '/api/v1/purchasing/suppliers', { cookie: owner, body: { name: 'No phone' } })).status).toBe(400);
    expect((await h.call('PATCH', `/api/v1/purchasing/suppliers/${a}`, { cookie: owner, body: { name: 'x', version: s.version } })).status).toBe(412);
    const dup = await h.call('PATCH', `/api/v1/purchasing/suppliers/${a}`, { cookie: owner, body: { taxCode: '0302', version: after.version } });
    expect(dup.body.error.code).toBe('duplicate_tax_code');
  });
});
