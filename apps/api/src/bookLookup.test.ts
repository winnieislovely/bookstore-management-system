import { fixVietnamese, plainDescription } from '@bookstore/modules/integrations/openlibrary';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './testing.js';

/** Book lookup in Open Library for the new-product form (FR-CAT-16, TDD §8.8) – mock adapter, no network. */
let h: Harness;
let owner: string;
let manager: string;
let cashier: string;

beforeAll(async () => {
  h = await startHarness();
  let roles: Record<string, string>;
  ({ owner, roles } = await h.setupOwner());
  manager = await h.staff(owner, 'quanly', roles.manager!, '112233');
  cashier = await h.staff(owner, 'thu', roles.cashier!);
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

const get = (path: string, cookie: string) => h.call('GET', path, { cookie });

describe('normalising Open Library text (TDD §8.8)', () => {
  it('puts Vietnamese marks back in order and composes them', () => {
    // Tone before vowel shape, as library records store it.
    expect(fixVietnamese('Má̆t bié̂c')).toBe('Mắt biếc');
    expect(fixVietnamese('  Nhà   xuất bản Trẻ ')).toBe('Nhà xuất bản Trẻ');
  });

  it('turns Markdown descriptions into plain text', () => {
    expect(plainDescription({ type: '/type/text', value: 'From [wikipedia](https://x):\r\n\r\n**Bold** text' })).toBe('From wikipedia:\n\nBold text');
    expect(plainDescription('')).toBeNull();
    expect(plainDescription('x'.repeat(5000))!.length).toBe(4000);
  });
});

describe('book lookup (FR-CAT-16)', () => {
  it('finds books by title and matches publishers on file, case and accents ignored', async () => {
    expect((await h.call('POST', '/api/v1/catalog/publishers', { cookie: owner, body: { i18n: { en: { name: 'nha xuat ban tre' } } } })).status).toBe(201);
    const r = await get('/api/v1/catalog/book-lookup?q=mắt', manager);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items).toHaveLength(1);
    expect(r.body.items[0]).toMatchObject({ title: 'Mắt biếc', authors: ['Nguyễn Nhật Ánh'], publisher: 'Nhà xuất bản Trẻ', isbn13: '9786041005143', coverId: 101 });
    expect(r.body.items[0].publisherId).toEqual(expect.any(String));
    // A publisher not on file comes back without an id: the form offers it as new.
    expect((await get('/api/v1/catalog/book-lookup?q=crime', manager)).body.items[0]).toMatchObject({ publisher: 'Penguin', publisherId: null });
  });

  it('looks up an ISBN-10 or -13 with its description, and rejects bad ISBNs', async () => {
    const r = await get('/api/v1/catalog/book-lookup?isbn=0-14-044913-2', manager);
    expect(r.body.items[0]).toMatchObject({ title: 'Crime and Punishment', isbn13: '9780140449136', description: 'A young man in St Petersburg commits a murder.' });
    expect((await get('/api/v1/catalog/book-lookup?isbn=9780140449137', manager)).body.error.code).toBe('invalid_isbn');
    expect((await get('/api/v1/catalog/book-lookup?isbn=9786041005143', manager)).body.items[0].description).toBeNull();
    expect((await get('/api/v1/catalog/book-lookup/description?work=OL2W', manager)).body).toEqual({ description: 'A young man in St Petersburg commits a murder.' });
  });

  it('needs 3 characters and catalog.edit', async () => {
    expect((await get('/api/v1/catalog/book-lookup?q=ab', manager)).status).toBe(400);
    expect((await get('/api/v1/catalog/book-lookup?q=crime', cashier)).status).toBe(403);
  });

  it('caches answers for 7 days, and reports an unavailable service as 503', async () => {
    const before = h.bookLookup.calls;
    await get('/api/v1/catalog/book-lookup?q=Crime', manager); // same key as "crime" above
    expect(h.bookLookup.calls).toBe(before);
    h.bookLookup.down = true;
    try {
      // Cached answers still work while Open Library is down; new ones fail softly.
      expect((await get('/api/v1/catalog/book-lookup?q=crime', manager)).status).toBe(200);
      const r = await get('/api/v1/catalog/book-lookup?q=dune', manager);
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('lookup_unavailable');
    } finally {
      h.bookLookup.down = false;
    }
    // An answer older than 7 days is fetched again.
    await h.t.sql`update catalog.book_lookup_cache set fetched_at = fetched_at - interval '8 days' where key = 'v2:q:crime'`;
    await get('/api/v1/catalog/book-lookup?q=crime', manager);
    expect(h.bookLookup.calls).toBeGreaterThan(before);
  });

  it('stores a cover as an image file that a new product can use', async () => {
    const r = await h.call('POST', '/api/v1/catalog/book-lookup/cover', { cookie: manager, body: { coverId: 102 } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.id).toEqual(expect.any(String));
    expect((await h.call('POST', '/api/v1/catalog/book-lookup/cover', { cookie: manager, body: { coverId: 999 } })).body.error.code).toBe('cover_not_found');
  });
});
