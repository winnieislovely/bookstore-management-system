import { LocalDiskStorage } from '@bookstore/modules/files';
import { createFieldCrypto } from '@bookstore/modules/platform';
import { FakeClock, startTestDb, type TestDb } from '@bookstore/testkit';
import { randomBytes } from 'node:crypto';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { routesOf } from './http/route.js';

/** Platform behaviour end to end through HTTP (FR-ADM-01..05, FR-ADM-09, TDD §10). */
let t: TestDb;
let app: ReturnType<typeof createApp>;
const clock = new FakeClock();
const ORIGIN = 'http://localhost:5173';

beforeAll(async () => {
  t = await startTestDb();
  const config = loadConfig({ FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), APP_ORIGIN: ORIGIN, NODE_ENV: 'test' });
  app = createApp({ db: t.db, clock, crypto: createFieldCrypto(config.FIELD_ENCRYPTION_KEY), storage: new LocalDiskStorage('./.test-files'), config, log: pino({ level: 'silent' }) });
}, 180_000);

afterAll(async () => {
  await t?.stop();
});

type Res = { status: number; body: any; cookie: string | null };

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string | null; csrf?: boolean } = {}): Promise<Res> {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (opts.csrf !== false) headers['x-bms-request'] = '1';
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await app.request(path, { method, headers, ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }) });
  const text = await res.text();
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: setCookie ? setCookie.split(';')[0]! : null };
}

async function login(username: string, password: string): Promise<string> {
  const r = await call('POST', '/api/v1/auth/login', { body: { username, password } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.cookie!;
}

const OWNER_PW = 'chu-cua-hang-2026';
let owner: string;
let roles: Record<string, { id: string; version: number }>;

describe('first-run wizard (FR-ADM-02)', () => {
  it('creates the owner and store profile once', async () => {
    expect((await call('GET', '/api/v1/setup')).body).toEqual({ needsSetup: true });
    const r = await call('POST', '/api/v1/setup', {
      body: { owner: { username: 'lan', displayName: 'Lan', password: OWNER_PW }, store: { name: 'The Bookshelf Hanoi', taxCode: '0123456789' } },
    });
    expect(r.status).toBe(201);
    const again = await call('POST', '/api/v1/setup', {
      body: { owner: { username: 'khac', displayName: 'Khác', password: 'mat-khau-khac-1' }, store: { name: 'Khác' } },
    });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('already_set_up');

    owner = await login('lan', OWNER_PW);
    const me = await call('GET', '/api/v1/me', { cookie: owner });
    expect(me.body.isOwner).toBe(true);
    const list = await call('GET', '/api/v1/admin/roles', { cookie: owner });
    roles = Object.fromEntries(list.body.items.map((r: any) => [r.code, { id: r.id, version: r.version }]));
    expect(Object.keys(roles).sort()).toEqual(
      ['cashier', 'event_coordinator', 'librarian', 'manager', 'online_staff', 'owner', 'warehouse', 'website_editor'].sort(),
    );
  });
});

describe('every non-public route requires a session (NFR-SEC-02)', () => {
  it('returns 401 without a cookie', async () => {
    const routes = routesOf(app).filter((r) => r.access !== 'public');
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) {
      const path = r.path.replace(':id', '00000000-0000-7000-8000-000000000000');
      const res = await call(r.method, path, { body: r.method === 'GET' ? undefined : {} });
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });
});

describe('CSRF controls (TDD §10.1)', () => {
  it('rejects state-changing requests without the custom header', async () => {
    const r = await call('POST', '/api/v1/auth/login', { body: { username: 'lan', password: OWNER_PW }, csrf: false });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf_header_missing');
  });
});

describe('users, forced password change and RBAC (FR-ADM-01, FR-ADM-03)', () => {
  let cashier: string;

  it('a new user must change the temporary password first', async () => {
    const created = await call('POST', '/api/v1/admin/users', {
      cookie: owner,
      body: { username: 'thu', displayName: 'Thu', roleId: roles.cashier!.id, password: 'tam-thoi-123' },
    });
    expect(created.status).toBe(201);
    // Search by display name or username, accent-insensitive (Design §13.8).
    const names = async (q: string) => ((await call('GET', `/api/v1/admin/users?q=${encodeURIComponent(q)}`, { cookie: owner })).body.items as { username: string }[]).map((u) => u.username);
    expect(await names('THU')).toContain('thu');
    expect(await names('khong-co-ai')).toEqual([]);
    cashier = await login('thu', 'tam-thoi-123');
    const blocked = await call('GET', '/api/v1/admin/users', { cookie: cashier });
    expect(blocked.body.error.code).toBe('password_change_required');
    const changed = await call('PATCH', '/api/v1/me/password', {
      cookie: cashier,
      body: { currentPassword: 'tam-thoi-123', newPassword: 'mat-khau-moi-456' },
    });
    expect(changed.status).toBe(204);
  });

  it('enforces permissions on the server', async () => {
    const r = await call('GET', '/api/v1/admin/users', { cookie: cashier });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toMatch(/không có quyền/);
    expect((await call('GET', '/api/v1/admin/users', { cookie: owner })).status).toBe(200);
  });

  it('re-reads permissions on every request', async () => {
    const custom = await call('POST', '/api/v1/admin/roles', { cookie: owner, body: { name: 'Thu ngân + nhật ký', permissions: ['sale.create', 'audit.view'] } });
    const users = (await call('GET', '/api/v1/admin/users', { cookie: owner })).body.items;
    const thu = users.find((u: any) => u.username === 'thu');
    await call('PATCH', `/api/v1/admin/users/${thu.id}`, { cookie: owner, body: { roleId: custom.body.id, version: thu.version } });
    expect((await call('GET', '/api/v1/admin/audit', { cookie: cashier })).status).toBe(200);
  });

  it('the owner role cannot be edited', async () => {
    const r = await call('PATCH', `/api/v1/admin/roles/${roles.owner!.id}`, {
      cookie: owner,
      body: { name: 'X', permissions: [], version: roles.owner!.version },
    });
    expect(r.body.error.code).toBe('owner_role_fixed');
  });
});

describe('lockout and manager unlock (FR-ADM-01)', () => {
  it('locks after 5 failures and needs a manager unlock', async () => {
    await call('POST', '/api/v1/admin/users', {
      cookie: owner,
      body: { username: 'kho', displayName: 'Kho', roleId: roles.warehouse!.id, password: 'kho-tam-thoi-1' },
    });
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/api/v1/auth/login', { body: { username: 'kho', password: 'wrong-password' } })).status).toBe(401);
    }
    expect((await call('POST', '/api/v1/auth/login', { body: { username: 'kho', password: 'kho-tam-thoi-1' } })).status).toBe(429);
    clock.advance(16 * 60_000);
    const locked = await call('POST', '/api/v1/auth/login', { body: { username: 'kho', password: 'kho-tam-thoi-1' } });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('account_locked');

    owner = await login('lan', OWNER_PW); // the owner session survived; refresh it after the clock jump anyway
    const kho = (await call('GET', '/api/v1/admin/users', { cookie: owner })).body.items.find((u: any) => u.username === 'kho');
    expect(kho.status).toBe('locked');
    expect((await call('POST', `/api/v1/admin/users/${kho.id}/unlock`, { cookie: owner })).status).toBe(204);
    await login('kho', 'kho-tam-thoi-1');
  });
});

describe('POS lock screen with PIN (NFR-SEC-07)', () => {
  it('blocks the session until the PIN is entered', async () => {
    expect((await call('PUT', '/api/v1/me/pin', { cookie: owner, body: { pin: '12345' } })).status).toBe(400);
    expect((await call('PUT', '/api/v1/me/pin', { cookie: owner, body: { pin: '246810' } })).status).toBe(204);
    expect((await call('POST', '/api/v1/auth/lock', { cookie: owner })).status).toBe(204);
    expect((await call('GET', '/api/v1/admin/users', { cookie: owner })).body.error.code).toBe('session_locked');
    const wrong = await call('POST', '/api/v1/auth/unlock', { cookie: owner, body: { pin: '000000' } });
    expect(wrong.body.error.message).toMatch(/còn 4 lần/);
    expect((await call('POST', '/api/v1/auth/unlock', { cookie: owner, body: { pin: '246810' } })).status).toBe(204);
    expect((await call('GET', '/api/v1/admin/users', { cookie: owner })).status).toBe(200);
  });
});

describe('supervisor approval (FR-ADM-09)', () => {
  it('issues a token only to an approver holding the permission', async () => {
    await call('POST', '/api/v1/admin/users', {
      cookie: owner,
      body: { username: 'hoa', displayName: 'Hoa', roleId: roles.cashier!.id, password: 'thu-ngan-ha-1' },
    });
    const ha = await login('hoa', 'thu-ngan-ha-1');
    await call('PATCH', '/api/v1/me/password', { cookie: ha, body: { currentPassword: 'thu-ngan-ha-1', newPassword: 'thu-ngan-ha-2' } });
    await call('PUT', '/api/v1/me/pin', { cookie: ha, body: { pin: '135790' } });

    const ok = await call('POST', '/api/v1/auth/approve', {
      cookie: ha,
      body: { approverUsername: 'lan', pin: '246810', action: 'discount_over_limit', subject: 'cart-1' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.approverName).toBe('Lan');
    expect(ok.body.approvalToken).toBeTruthy();

    const self = await call('POST', '/api/v1/auth/approve', {
      cookie: ha,
      body: { approverUsername: 'hoa', pin: '135790', action: 'void_sale' },
    });
    expect(self.body.error.code).toBe('approver_not_allowed');
  });
});

describe('settings and audit (FR-ADM-04, FR-ADM-05)', () => {
  it('validates values, masks secrets and audits changes', async () => {
    const bad = await call('PUT', '/api/v1/admin/settings', { cookie: owner, body: { 'sale.cashier_discount_max_bp': 20000 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].key).toBe('sale.cashier_discount_max_bp');

    expect(
      (await call('PUT', '/api/v1/admin/settings', { cookie: owner, body: { 'einvoice.misa_password': 'super-secret-3f9a', 'shift.variance_alert_vnd': 60000 } })).status,
    ).toBe(204);
    const list = (await call('GET', '/api/v1/admin/settings', { cookie: owner })).body.items;
    const pw = list.find((s: any) => s.key === 'einvoice.misa_password');
    expect(pw.value).toBe('••••••••3f9a');
    expect(list.find((s: any) => s.key === 'shift.variance_alert_vnd').value).toBe(60000);
    const [raw] = await t.sql`select value from platform.setting where key = 'einvoice.misa_password'`;
    expect(JSON.stringify(raw!.value)).not.toContain('super-secret');

    const log = (await call('GET', '/api/v1/admin/audit?entity=setting', { cookie: owner })).body.items;
    const entry = log.find((e: any) => e.entityId === 'einvoice.misa_password');
    expect(entry.after.value).toBe('••••••••3f9a');
    const actions = (await call('GET', '/api/v1/admin/audit?limit=200', { cookie: owner })).body.items.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['setup.completed', 'user.create', 'user.role_change', 'auth.lockout', 'user.unlock', 'auth.approval_granted']));
  });

  it('the audit log cannot be edited', async () => {
    await expect(t.sql`update platform.audit_entry set action = 'x'`).rejects.toThrow(/append-only/);
  });
});

describe('OpenAPI description (FR-WEB-16, NFR-MNT-01)', () => {
  it('is generated from the route schemas', async () => {
    const r = await app.request('/api/v1/openapi.json');
    const doc = (await r.json()) as { paths: Record<string, Record<string, unknown>> };
    expect(doc.paths['/api/v1/admin/users/{id}']?.patch).toBeDefined();
  });
});
