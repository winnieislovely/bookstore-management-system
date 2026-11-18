import { LocalDiskStorage } from '@bookstore/modules/files';
import { MockCarrierAdapter } from '@bookstore/modules/integrations/ghn';
import { MockBookLookup } from '@bookstore/modules/integrations/openlibrary';
import { createFieldCrypto, type Ctx } from '@bookstore/modules/platform';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  /** GHN stand-in: tests move shipments along through its status map. */
  carrier: MockCarrierAdapter;
  /** Open Library stand-in (never calls the network). */
  bookLookup: MockBookLookup;
  /** A service context for calling modules directly (no actor). */
  ctx: () => Ctx;
  call: (method: string, path: string, opts?: { body?: unknown; cookie?: string | null; csrf?: boolean }) => Promise<Res>;
  login: (username: string, password: string) => Promise<string>;
  /** Run the wizard (owner `lan`), returning the owner cookie and role ids by code. */
  setupOwner: () => Promise<{ owner: string; roles: Record<string, string> }>;
  /** Create a user with a role, change the temporary password and set a PIN; returns the cookie. */
  staff: (owner: string, username: string, roleId: string, pin?: string) => Promise<string>;
  /**
   * Test setup: a product with its first stock-in, the way Thêm sản phẩm mới makes it (`POST /catalog/items`
   * with `opening`, FR-PUR-02). The body is `{ supplierId, consignment?, line: { item, variant, costVnd, sellingPriceVnd, qty } }`;
   * the reply adds `lines[i].variantId` like a stock-in reply.
   */
  newProduct: (opts: { body: NewProductBody; cookie?: string | null }) => Promise<Res>;
  /** One existing product stocked through `POST /purchasing/stock-in`: the header plus `line`. */
  stockInOne: (opts: { body: Record<string, unknown> & { line: Record<string, unknown> }; cookie?: string | null }) => Promise<Res>;
}

export interface NewProductBody {
  supplierId?: string;
  consignment?: boolean;
  consignmentDiscountBp?: number;
  consignmentDeadline?: string;
  line: { item: Record<string, unknown>; variant: Record<string, unknown>; imageFileIds?: string[]; costVnd: number; sellingPriceVnd: number; qty: number };
}

// Bodies are arbitrary JSON in tests.
export type Res = { status: number; body: any; cookie: string | null };

export const OWNER_PW = 'chu-cua-hang-2026';
export const WEBHOOK_SECRET = 'ghn-webhook-secret-for-tests';

export async function startHarness(): Promise<Harness> {
  const t = await startTestDb();
  const clock = new FakeClock();
  const config = loadConfig({ FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), APP_ORIGIN: ORIGIN, NODE_ENV: 'test', GHN_WEBHOOK_SECRET: WEBHOOK_SECRET });
  const crypto = createFieldCrypto(config.FIELD_ENCRYPTION_KEY);
  const storage = new LocalDiskStorage(mkdtempSync(join(tmpdir(), 'bms-files-')));
  const carrier = new MockCarrierAdapter();
  const bookLookup = new MockBookLookup();
  const app = createApp({ db: t.db, clock, crypto, storage, config, log: pino({ level: 'silent' }), carrier, bookLookup });

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

  const newProduct: Harness['newProduct'] = async ({ body, cookie }) => {
    const { line, supplierId, consignment, consignmentDiscountBp, consignmentDeadline } = body;
    const r = await call('POST', '/api/v1/catalog/items', {
      cookie: cookie ?? null,
      body: {
        ...line.item,
        variants: [{ ...line.variant, priceVnd: line.sellingPriceVnd }],
        opening: { costVnd: line.costVnd, qty: line.qty, ...(supplierId && { supplierId }), ...(consignment && { consignment, consignmentDiscountBp, consignmentDeadline }) },
      },
    });
    if (r.status !== 201) return r;
    // Photos are attached as the page does after saving; tests use placeholder file ids.
    for (const [sort, fileId] of (line.imageFileIds ?? []).entries()) await t.sql`insert into catalog.item_image (item_id, file_id, sort) values (${r.body.itemId}, ${fileId}, ${sort})`;
    return { ...r, body: { ...r.body, lines: (r.body.variantIds as string[]).map((variantId) => ({ variantId })) } };
  };

  const stockInOne: Harness['stockInOne'] = async ({ body, cookie }) => {
    const { line, ...header } = body;
    return call('POST', '/api/v1/purchasing/stock-in', { cookie: cookie ?? null, body: { ...header, lines: [{ kind: 'existing', ...line }] } });
  };

  return {
    t,
    app,
    clock,
    carrier,
    bookLookup,
    ctx: () => ({ db: t.db, clock, crypto, actor: null, requestId: randomUUID(), ip: null }),
    call,
    login,
    newProduct,
    stockInOne,
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
