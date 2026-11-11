import type { Db, Tx } from '@bookstore/db';
import { schema } from '@bookstore/db';
import { formatDocNo, storeYear, type DocSeries, type Permission } from '@bookstore/domain';
import { sql } from 'drizzle-orm';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type { Db, Tx };

/** Injectable clock (TDD §3.6). */
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

/** The signed-in staff member, permissions re-read from the database on every request (FR-ADM-03). */
export interface Actor {
  userId: string;
  sessionId: string;
  username: string;
  displayName: string;
  roleId: string;
  isOwner: boolean;
  permissions: ReadonlySet<Permission>;
}

export interface Ctx {
  db: Db;
  clock: Clock;
  actor: Actor | null;
  requestId: string;
  ip: string | null;
  crypto: FieldCrypto;
}

export function can(actor: Actor | null, permission: Permission): boolean {
  return actor !== null && (actor.isOwner || actor.permissions.has(permission));
}

/**
 * Typed business error mapped to `{ error: { code, message, details, requestId } }` (TDD §3.5).
 * `message` is plain Vietnamese for staff: what happened, why, what to do (NFR-USE-05).
 */
export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 412 | 415 | 422 | 423 | 429 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  unauthenticated: () => new AppError(401, 'unauthenticated', 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.'),
  forbidden: (permission?: string) =>
    new AppError(403, 'forbidden', 'Bạn không có quyền thực hiện thao tác này. Hãy nhờ quản lý hỗ trợ.', permission ? { permission } : undefined),
  notFound: (what = 'Bản ghi') => new AppError(404, 'not_found', `${what} không tồn tại hoặc đã bị xóa.`),
  conflict: (code: string, message: string, details?: unknown) => new AppError(409, code, message, details),
  stale: () =>
    new AppError(412, 'stale_version', 'Bản ghi đã được người khác cập nhật. Hãy tải lại rồi chỉnh sửa tiếp.'),
};

export function requirePermission(ctx: Ctx, permission: Permission): Actor {
  if (!ctx.actor) throw errors.unauthenticated();
  if (!can(ctx.actor, permission)) throw errors.forbidden(permission);
  return ctx.actor;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Column/field encryption, AES-256-GCM with a key held outside the database (TDD §10.4).
 * Output: `v1.<iv>.<tag>.<ciphertext>` in base64url.
 */
export interface FieldCrypto {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

export function createFieldCrypto(keyBase64: string): FieldCrypto {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
    },
    decrypt(value) {
      const [v, iv, tag, data] = value.split('.');
      if (v !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unrecognised ciphertext');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    },
  };
}

/**
 * Next gap-free document number for a series in the store year (TDD §3.6, NFR-REL-02). Must run
 * inside the transaction that creates the document: the counter row stays locked until commit, so
 * a rollback leaves no gap.
 */
export async function nextDocNo(tx: Tx, series: DocSeries, at: Date): Promise<string> {
  const year = storeYear(at);
  const [row] = await tx
    .insert(schema.docCounter)
    .values({ series, year, lastNo: 1 })
    .onConflictDoUpdate({
      target: [schema.docCounter.series, schema.docCounter.year],
      set: { lastNo: sql`${schema.docCounter.lastNo} + 1` },
    })
    .returning({ lastNo: schema.docCounter.lastNo });
  return formatDocNo(series, year, row!.lastNo);
}

/** Write a domain event to the outbox in the caller's transaction (TDD §9.2). */
export async function emit(tx: Tx, type: string, payload: Record<string, unknown>): Promise<void> {
  await tx.insert(schema.outboxEvent).values({ type, payload });
}

/** Database round trip for the health check (TDD §11.5). */
export async function ping(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}

/** Bind a Date inside raw `sql` fragments (the driver does not serialise Date objects there). */
export function tsParam(d: Date) {
  return sql`${d.toISOString()}::timestamptz`;
}
