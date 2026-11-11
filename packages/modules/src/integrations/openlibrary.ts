import { normalizeDewey, normalizeIsbn } from '@bookstore/domain';

/**
 * Book lookup boundary (FR-CAT-16, TDD §8.8): Open Library behind `BookLookupAdapter`, with an HTTP
 * implementation for the live service and a mock for tests. Called synchronously from the API
 * because a person waits at the form; any failure leaves the form for manual entry.
 */

/** One edition, as the product form needs it. */
export interface BookHit {
  /** Open Library work id, e.g. `OL166894W`, used to fetch the description on pick. */
  workId: string | null;
  title: string;
  authors: string[];
  publisher: string | null;
  year: number | null;
  isbn13: string | null;
  description: string | null;
  coverId: number | null;
  /** Dewey number, normalised (`891.733`), when Open Library has one (FR-LIB-02a). */
  dewey: string | null;
  /** Language of the edition, when it is Vietnamese or English. */
  language: 'vi' | 'en' | null;
}

export interface BookLookupAdapter {
  readonly name: 'mock' | 'openlibrary';
  search(title: string): Promise<BookHit[]>;
  byIsbn(isbn13: string): Promise<BookHit[]>;
  description(workId: string): Promise<string | null>;
  /** JPEG bytes of a cover in the large size, or null when there is none. */
  cover(coverId: number): Promise<Uint8Array | null>;
}

export class BookLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookLookupError';
  }
}

// ---------------------------------------------------------------------------------------------
// Normalising (TDD §8.8)

/** Vowel-shape marks (breve, circumflex, horn) that must precede the tone mark in Vietnamese. */
const SHAPE_MARKS = new Set(['̆', '̂', '̛']);

/**
 * NFC text with Vietnamese marks put back in order: library records often store the tone before the
 * vowel shape (`a + ́ + ̆`), which NFC cannot compose, so `Má̆t bié̂c` becomes `Mắt biếc`.
 */
export function fixVietnamese(text: string): string {
  return text
    .normalize('NFD')
    .replace(/([^̀-ͯ])([̀-ͯ]{2,})/g, (_m, base: string, marks: string) => {
      const list = [...marks];
      return base + [...list.filter((c) => SHAPE_MARKS.has(c)), ...list.filter((c) => !SHAPE_MARKS.has(c))].join('');
    })
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain text from Open Library Markdown: links keep their label, emphasis and rules go, 4 000 characters at most. */
export function plainDescription(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw : raw && typeof raw === 'object' && typeof (raw as { value?: unknown }).value === 'string' ? (raw as { value: string }).value : null;
  if (!text) return null;
  const out = text
    .replace(/\r\n/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/[*_`#>]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .normalize('NFC')
    .trim();
  if (!out) return null;
  return out.length > 4000 ? `${out.slice(0, 3999).trimEnd()}…` : out;
}

const firstIsbn = (list: unknown): string | null => {
  if (!Array.isArray(list)) return null;
  for (const v of list) {
    const n = typeof v === 'string' ? normalizeIsbn(v) : null;
    if (n) return n;
  }
  return null;
};
const yearOf = (v: unknown): number | null => {
  const m = typeof v === 'string' ? /(\d{4})/.exec(v) : typeof v === 'number' ? [String(v), String(v)] : null;
  const y = m ? Number(m[1]) : NaN;
  return y >= 1400 && y <= 2100 ? y : null;
};
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? fixVietnamese(v) : null);
const workIdOf = (key: unknown): string | null => (typeof key === 'string' ? (/OL\d+W/.exec(key)?.[0] ?? null) : null);
const firstDewey = (list: unknown): string | null => (Array.isArray(list) ? (list.map((v) => (typeof v === 'string' ? normalizeDewey(v) : null)).find(Boolean) ?? null) : null);
/** `eng`, `/languages/vie` → `en`, `vi`; anything else null. */
const languageOf = (list: unknown): 'vi' | 'en' | null => {
  const codes = (Array.isArray(list) ? list : []).map((v) => (typeof v === 'string' ? v : typeof v === 'object' && v && 'key' in v ? String((v as { key: unknown }).key) : '')).map((v) => v.replace('/languages/', ''));
  return codes.includes('vie') ? 'vi' : codes.includes('eng') ? 'en' : null;
};

// ---------------------------------------------------------------------------------------------
// Live Open Library

export interface OpenLibraryConfig {
  /** Contact (email) in the User-Agent, which raises the allowance to 3 requests per second. */
  contact?: string | undefined;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class OpenLibraryAdapter implements BookLookupAdapter {
  readonly name = 'openlibrary' as const;
  private readonly http: typeof fetch;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(cfg: OpenLibraryConfig = {}) {
    this.http = cfg.fetch ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 5000;
    this.headers = { 'user-agent': `TheBookshelfBMS/1.0${cfg.contact ? ` (${cfg.contact})` : ''}`, accept: 'application/json' };
  }

  private async get(url: string): Promise<Response> {
    let res: Response;
    try {
      res = await this.http(url, { headers: this.headers, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      throw new BookLookupError(`Open Library không phản hồi: ${(e as Error).message}`);
    }
    if (res.status >= 500 || res.status === 429) throw new BookLookupError(`Open Library trả lỗi ${res.status}.`);
    return res;
  }

  private async json(url: string): Promise<Record<string, unknown> | null> {
    const res = await this.get(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new BookLookupError(`Open Library trả lỗi ${res.status}.`);
    return (await res.json()) as Record<string, unknown>;
  }

  async search(title: string): Promise<BookHit[]> {
    const fields = 'key,title,subtitle,author_name,first_publish_year,cover_i,ddc,language,editions,editions.title,editions.subtitle,editions.isbn,editions.publisher,editions.publish_date,editions.cover_i,editions.language';
    const body = await this.json(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=8&fields=${fields}`);
    const docs = (body?.docs ?? []) as Record<string, unknown>[];
    return docs.map((d) => {
      // The best-matching edition gives one coherent set of ISBN, publisher, year and cover.
      const ed = ((d.editions as { docs?: Record<string, unknown>[] } | undefined)?.docs ?? [])[0] ?? {};
      const t = text(ed.title) ?? text(d.title) ?? '';
      const sub = text(ed.subtitle) ?? (ed.title ? null : text(d.subtitle));
      return {
        workId: workIdOf(d.key),
        title: sub ? `${t}: ${sub}` : t,
        authors: ((d.author_name as string[] | undefined) ?? []).map(fixVietnamese).filter(Boolean).slice(0, 5),
        publisher: text(((ed.publisher as string[] | undefined) ?? [])[0]),
        year: yearOf(((ed.publish_date as string[] | undefined) ?? [])[0]) ?? yearOf(d.first_publish_year),
        isbn13: firstIsbn(ed.isbn),
        description: null,
        coverId: typeof ed.cover_i === 'number' ? ed.cover_i : typeof d.cover_i === 'number' ? d.cover_i : null,
        // Work-level list: every edition's Dewey number (TDD §8.8).
        dewey: firstDewey(d.ddc),
        language: languageOf(ed.language) ?? languageOf(d.language),
      } satisfies BookHit;
    }).filter((h) => h.title);
  }

  async byIsbn(isbn13: string): Promise<BookHit[]> {
    const ed = await this.json(`https://openlibrary.org/isbn/${isbn13}.json`);
    if (!ed) return [];
    const workId = workIdOf(((ed.works as { key?: string }[] | undefined) ?? [])[0]?.key);
    const work = workId ? await this.json(`https://openlibrary.org/works/${workId}.json`) : null;
    const authorKeys = [
      ...((ed.authors as { key?: string }[] | undefined) ?? []).map((a) => a.key),
      ...((work?.authors as { author?: { key?: string } }[] | undefined) ?? []).map((a) => a.author?.key),
    ].filter((k): k is string => typeof k === 'string' && /^\/authors\/OL\d+A$/.test(k));
    const authors: string[] = [];
    for (const key of [...new Set(authorKeys)].slice(0, 3)) {
      const a = await this.json(`https://openlibrary.org${key}.json`);
      const name = text(a?.name) ?? text(a?.personal_name);
      if (name) authors.push(name);
    }
    const t = text(ed.title) ?? '';
    const sub = text(ed.subtitle);
    return [
      {
        workId,
        title: sub ? `${t}: ${sub}` : t,
        authors,
        publisher: text(((ed.publishers as string[] | undefined) ?? [])[0]),
        year: yearOf(ed.publish_date),
        isbn13,
        description: plainDescription(ed.description) ?? plainDescription(work?.description),
        coverId: ((ed.covers as number[] | undefined) ?? []).find((c) => c > 0) ?? null,
        dewey: firstDewey(ed.dewey_decimal_class),
        language: languageOf(ed.languages),
      },
    ].filter((h) => h.title);
  }

  async description(workId: string): Promise<string | null> {
    const work = await this.json(`https://openlibrary.org/works/${workId}.json`);
    return plainDescription(work?.description);
  }

  async cover(coverId: number): Promise<Uint8Array | null> {
    const res = await this.get(`https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false`);
    if (res.status === 404) return null;
    if (!res.ok) throw new BookLookupError(`Không tải được ảnh bìa (${res.status}).`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 5 * 1024 * 1024) throw new BookLookupError('Ảnh bìa lớn hơn 5 MB.');
    return bytes;
  }
}

// ---------------------------------------------------------------------------------------------
// Mock (tests)

/** A 1 × 1 JPEG, enough for the upload checks. */
const TINY_JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  ),
  (c) => c.charCodeAt(0),
);

export class MockBookLookup implements BookLookupAdapter {
  readonly name = 'mock' as const;
  /** Set to make every call fail, as if Open Library were down. */
  down = false;
  calls = 0;
  readonly books: BookHit[] = [
    { workId: 'OL1W', title: 'Mắt biếc', authors: ['Nhật Ánh Nguyễn'], publisher: 'Nhà xuất bản Trẻ', year: 2013, isbn13: '9786041005143', description: null, coverId: 101, dewey: null, language: 'vi' },
    { workId: 'OL2W', title: 'Crime and Punishment', authors: ['Fyodor Dostoevsky'], publisher: 'Penguin', year: 2003, isbn13: '9780140449136', description: null, coverId: 102, dewey: '891.733', language: 'en' },
  ];
  readonly descriptions: Record<string, string> = { OL2W: 'A young man in St Petersburg commits a murder.' };

  private check() {
    this.calls++;
    if (this.down) throw new BookLookupError('Open Library không phản hồi.');
  }
  async search(title: string) {
    this.check();
    const q = title.toLowerCase();
    return this.books.filter((b) => b.title.toLowerCase().includes(q));
  }
  async byIsbn(isbn13: string) {
    this.check();
    return this.books.filter((b) => b.isbn13 === isbn13).map((b) => ({ ...b, description: b.workId ? (this.descriptions[b.workId] ?? null) : null }));
  }
  async description(workId: string) {
    this.check();
    return this.descriptions[workId] ?? null;
  }
  async cover(coverId: number) {
    this.check();
    return this.books.some((b) => b.coverId === coverId) ? TINY_JPEG : null;
  }
}

export function createBookLookup(cfg: { OPEN_LIBRARY_CONTACT?: string | undefined }): BookLookupAdapter {
  return new OpenLibraryAdapter({ contact: cfg.OPEN_LIBRARY_CONTACT });
}
