import { normalizeIsbn } from '@bookstore/domain';
import { schema } from '@bookstore/db';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as files from '../files/index.js';
import type { StorageAdapter } from '../files/index.js';
import { BookLookupError, type BookHit, type BookLookupAdapter } from '../integrations/openlibrary.js';
import { AppError, requirePermission, tsParam, type Ctx } from '../platform/index.js';

/**
 * Book lookup for the new-product form (FR-CAT-16, TDD §8.8): Open Library results, cached for
 * 7 days, with publishers matched against our own list. Nothing is written to the catalogue here.
 */

const CACHE_DAYS = 7;
const PER_MINUTE = 30;

export const BookLookupQuery = z
  .object({ q: z.string().trim().min(3).max(200).optional(), isbn: z.string().trim().max(20).optional() })
  .refine((v) => !!v.q !== !!v.isbn, { message: 'Nhập tên sách (ít nhất 3 ký tự) hoặc ISBN.' });
export const BookDescriptionQuery = z.object({ work: z.string().regex(/^OL\d+W$/, 'Mã tác phẩm không hợp lệ.') });
export const BookCoverSchema = z.object({ coverId: z.number().int().positive() });

export interface BookLookupResult extends BookHit {
  /** Our publisher with the same name (case and accents ignored), else null: the form offers it as new. */
  publisherId: string | null;
}

/** Lookups per user in the last minute, kept in this process (TDD §8.8 fair use). */
const recent = new Map<string, number[]>();
function throttle(ctx: Ctx) {
  const userId = ctx.actor?.userId ?? 'anonymous';
  const now = ctx.clock.now().getTime();
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= PER_MINUTE) throw new AppError(429, 'rate_limited', 'Tra cứu quá nhanh. Hãy đợi một phút rồi thử lại.');
  list.push(now);
  recent.set(userId, list);
}

function unavailable(): never {
  throw new AppError(503, 'lookup_unavailable', 'Không tra cứu được lúc này. Nhập thông tin bên dưới.');
}

/** A cached answer, or the adapter's (then cached). Adapter failures become 503 `lookup_unavailable`. */
async function cached<T>(ctx: Ctx, key: string, load: () => Promise<T>): Promise<T> {
  const now = ctx.clock.now();
  const [row] = await ctx.db
    .select({ payload: schema.bookLookupCache.payload, fetchedAt: schema.bookLookupCache.fetchedAt })
    .from(schema.bookLookupCache)
    .where(eq(schema.bookLookupCache.key, key));
  if (row && now.getTime() - row.fetchedAt.getTime() < CACHE_DAYS * 86_400_000) return row.payload as T;
  throttle(ctx);
  let value: T;
  try {
    value = await load();
  } catch (e) {
    if (e instanceof BookLookupError) unavailable();
    throw e;
  }
  await ctx.db
    .insert(schema.bookLookupCache)
    .values({ key, payload: value as never, fetchedAt: now })
    .onConflictDoUpdate({ target: schema.bookLookupCache.key, set: { payload: value as never, fetchedAt: now } });
  return value;
}

/** Our publishers by name, case and accents ignored – the same key as the unique index. */
async function matchPublishers(ctx: Ctx, names: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(names.filter(Boolean))];
  if (!wanted.length) return new Map();
  const rows = await ctx.db.execute<{ id: string; k: string }>(sql`
    select p.id, lower(public.f_unaccent(p.i18n -> 'en' ->> 'name')) as k
    from catalog.publisher p
    where lower(public.f_unaccent(p.i18n -> 'en' ->> 'name')) in (
      select lower(public.f_unaccent(n)) from unnest(${sql`array[${sql.join(wanted.map((n) => sql`${n}`), sql`, `)}]::text[]`}) as n)`);
  const keyOf = await ctx.db.execute<{ n: string; k: string }>(sql`
    select n, lower(public.f_unaccent(n)) as k from unnest(${sql`array[${sql.join(wanted.map((n) => sql`${n}`), sql`, `)}]::text[]`}) as n`);
  const byKey = new Map(rows.map((r) => [r.k, r.id]));
  return new Map(keyOf.flatMap((r) => (byKey.has(r.k) ? [[r.n, byKey.get(r.k)!] as [string, string]] : [])));
}

export async function lookupBooks(ctx: Ctx, adapter: BookLookupAdapter, input: z.input<typeof BookLookupQuery>): Promise<{ items: BookLookupResult[] }> {
  requirePermission(ctx, 'catalog.edit');
  const q = BookLookupQuery.parse(input);
  let hits: BookHit[];
  if (q.isbn) {
    const isbn13 = normalizeIsbn(q.isbn);
    if (!isbn13) throw new AppError(400, 'invalid_isbn', 'ISBN không hợp lệ.');
    hits = await cached(ctx, `isbn:${isbn13}`, () => adapter.byIsbn(isbn13));
  } else {
    const title = q.q!.normalize('NFC').replace(/\s+/g, ' ').toLowerCase();
    hits = await cached(ctx, `q:${title}`, () => adapter.search(title));
  }
  const publishers = await matchPublishers(ctx, hits.map((h) => h.publisher ?? ''));
  return { items: hits.slice(0, 8).map((h) => ({ ...h, publisherId: h.publisher ? (publishers.get(h.publisher) ?? null) : null })) };
}

export async function bookDescription(ctx: Ctx, adapter: BookLookupAdapter, input: z.input<typeof BookDescriptionQuery>): Promise<{ description: string | null }> {
  requirePermission(ctx, 'catalog.edit');
  const { work } = BookDescriptionQuery.parse(input);
  return { description: await cached(ctx, `work:${work}`, () => adapter.description(work)) };
}

/** Download an Open Library cover and store it as an image file, like an upload (FR-CAT-16). */
export async function importCover(ctx: Ctx, adapter: BookLookupAdapter, storage: StorageAdapter, input: z.input<typeof BookCoverSchema>) {
  requirePermission(ctx, 'catalog.edit');
  const { coverId } = BookCoverSchema.parse(input);
  throttle(ctx);
  let bytes: Uint8Array | null;
  try {
    bytes = await adapter.cover(coverId);
  } catch (e) {
    if (e instanceof BookLookupError) unavailable();
    throw e;
  }
  if (!bytes) throw new AppError(404, 'cover_not_found', 'Sách này không có ảnh bìa. Hãy tải ảnh lên.');
  const { id } = await files.upload(ctx, storage, { bytes, mime: 'image/jpeg', purpose: 'image' });
  return { id };
}

/** Clear expired cache rows (kept tidy by the nightly job when wired; harmless to call any time). */
export async function pruneBookLookupCache(ctx: Ctx) {
  const cutoff = new Date(ctx.clock.now().getTime() - CACHE_DAYS * 86_400_000);
  await ctx.db.delete(schema.bookLookupCache).where(sql`${schema.bookLookupCache.fetchedAt} < ${tsParam(cutoff)}`);
}
