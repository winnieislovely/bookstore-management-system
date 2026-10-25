import { createFieldCrypto, type Ctx } from '@bookstore/modules/platform';
import { FakeClock, startTestDb, type TestDb } from '@bookstore/testkit';
import { randomBytes, randomUUID } from 'node:crypto';
import pino from 'pino';
import { expect } from 'vitest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

/** Test harness: the real app on a throw-away database, plus HTTP helpers. */
export const ORIGIN = 'http://localhost:5173';

export interface Harness {
  t: TestDb;
  app: ReturnType<typeof createApp>;
  clock: FakeClock;
  /** A service context for calling modules directly (no actor). */
  ctx: () => Ctx;
  call: (method: string, path: string, opts?: { body?: unknown; cookie?: string | null; csrf?: boolean }) => Promise<Res>;
  login: (username: string, password: string) => Promise<string>;
  /** Run the wizard (owner `lan`), returning the owner cookie and role ids by code. */
  setupOwner: () => Promise<{ owner: string; roles: Record<string, string> }>;
  /** Create a user with a role, change the temporary password and set a PIN; returns the cookie. */
  staff: (owner: string, username: string, roleId: string, pin?: string) => Promise<string>;
}

// Bodies are arbitrary JSON in tests.
export type Res = { status: number; body: any; cookie: string | null };

export const OWNER_PW = 'chu-cua-hang-2026';

export async function startHarness(): Promise<Harness> {
  const t = await startTestDb();
  const clock = new FakeClock();
  const config = loadConfig({ FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), APP_ORIGIN: ORIGIN, NODE_ENV: 'test' });
  const crypto = createFieldCrypto(config.FIELD_ENCRYPTION_KEY);
  const app = createApp({ db: t.db, clock, crypto, config, log: pino({ level: 'silent' }) });

  const call: Harness['call'] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (opts.csrf !== false) headers['x-bms-request'] = '1';
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    const res = await app.request(path, { method, headers, ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }) });
    const text = await res.text();
    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, body: text ? JSON.parse(text) : null, cookie: setCookie ? setCookie.split(';')[0]! : null };
  };

  const login: Harness['login'] = async (username, password) => {
    const r = await call('POST', '/api/v1/auth/login', { body: { username, password } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.cookie!;
  };

  return {
    t,
    app,
    clock,
    ctx: () => ({ db: t.db, clock, crypto, actor: null, requestId: randomUUID(), ip: null }),
    call,
    login,
    async setupOwner() {
      const r = await call('POST', '/api/v1/setup', {
        body: { owner: { username: 'lan', displayName: 'Lan', password: OWNER_PW }, store: { name: 'The Bookshelf Hanoi' } },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const owner = await login('lan', OWNER_PW);
      await call('PUT', '/api/v1/me/pin', { cookie: owner, body: { pin: '246810' } });
      const roles = (await call('GET', '/api/v1/admin/roles', { cookie: owner })).body.items;
      return { owner, roles: Object.fromEntries(roles.map((x: { code: string; id: string }) => [x.code, x.id])) };
    },
    async staff(owner, username, roleId, pin = '135790') {
      const r = await call('POST', '/api/v1/admin/users', { cookie: owner, body: { username, displayName: username, roleId, password: 'tam-thoi-123' } });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const cookie = await login(username, 'tam-thoi-123');
      expect((await call('PATCH', '/api/v1/me/password', { cookie, body: { currentPassword: 'tam-thoi-123', newPassword: 'mat-khau-moi-456' } })).status).toBe(204);
      expect((await call('PUT', '/api/v1/me/pin', { cookie, body: { pin } })).status).toBe(204);
      return cookie;
    },
  };
}
