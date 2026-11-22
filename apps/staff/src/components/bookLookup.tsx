import { isValidIsbn } from '@bookstore/domain';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { BookOpen, Loader2, ScanBarcode, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { get } from '../lib/api';
import { CameraScanner } from '../pos/widgets';

/** One Open Library result (FR-CAT-16, TDD §8.8). */
export interface BookResult {
  workId: string | null;
  title: string;
  authors: string[];
  publisher: string | null;
  publisherId: string | null;
  year: number | null;
  isbn13: string | null;
  description: string | null;
  coverId: number | null;
  /** Dewey number when Open Library has one (library titles, FR-LIB-02a). */
  dewey: string | null;
  language: 'vi' | 'en' | null;
}

const thumb = (coverId: number) => `https://covers.openlibrary.org/b/id/${coverId}-S.jpg`;

/**
 * “Tìm sách” on Thêm sản phẩm mới (Design §12.4): title search with a dropdown (the main path),
 * or an ISBN typed or scanned, which fills the form straight away when there is one result.
 */
export function BookLookup({ onPick, endpoint = '/api/v1/catalog/book-lookup' }: { onPick: (b: BookResult) => void; endpoint?: string }) {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [scanning, setScanning] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const inputId = useId();

  // Wait 400 ms after typing (TDD §8.8 fair use).
  useEffect(() => {
    const id = setTimeout(() => setTerm(text.trim()), 400);
    return () => clearTimeout(id);
  }, [text]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const isbn = isValidIsbn(term) ? term : null;
  const q = useQuery({
    queryKey: ['book-lookup', endpoint, isbn ? `isbn:${isbn}` : `q:${term.toLowerCase()}`],
    queryFn: () => get<{ items: BookResult[] }>(`${endpoint}?${isbn ? `isbn=${encodeURIComponent(isbn)}` : `q=${encodeURIComponent(term)}`}`),
    enabled: !!isbn || term.length >= 3,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const items = useMemo(() => q.data?.items ?? [], [q.data]);

  // An ISBN with exactly one result fills the form at once.
  const filledFor = useRef<string | null>(null);
  useEffect(() => {
    if (isbn && items.length === 1 && filledFor.current !== isbn) {
      filledFor.current = isbn;
      onPick(items[0]!);
      setOpen(false);
    }
  }, [isbn, items, onPick]);
  useEffect(() => {
    setActive(0);
    if (term.length >= 3 || isbn) setOpen(true);
  }, [term, isbn]);

  const pick = (b: BookResult) => {
    onPick(b);
    setOpen(false);
  };
  const unavailable = q.isError;

  return (
    <div ref={box} className="relative">
      <label htmlFor={inputId} className="text-[13px] font-medium text-ink-700">
        Tìm sách
      </label>
      <div className="mt-1 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />
          <input
            id={inputId}
            // Text, not search: no browser clear “×” inside the field (Design §12.4).
            type="text"
            enterKeyHint="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
            autoComplete="off"
            placeholder="Nhập tên sách hoặc ISBN"
            className="h-10 w-full rounded-md border border-paper-500 bg-white pr-10 pl-10 text-sm focus:border-navy-700 pointer-coarse:h-11 max-sm:text-base"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => (term.length >= 3 || isbn) && setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (!open || !items.length) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pick(items[active]!);
              }
            }}
          />
          {q.isFetching && <Loader2 size={18} className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-ink-500" aria-label="Đang tìm" />}
        </div>
        <button
          type="button"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-navy-700 hover:bg-navy-50"
          aria-label="Quét ISBN"
          title="Quét ISBN"
          onClick={() => setScanning(true)}
        >
          <ScanBarcode size={24} aria-hidden />
        </button>
      </div>

      {open && (term.length >= 3 || isbn) && !q.isFetching && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-[420px] overflow-y-auto rounded-lg border border-paper-300 bg-white p-1 shadow-md">
          {unavailable ? (
            <p className="px-3 py-3 text-sm text-warning-700">
              {(q.error as { code?: string })?.code === 'rate_limited' ? 'Tra cứu quá nhanh. Hãy đợi một phút rồi thử lại.' : 'Không tra cứu được lúc này. Nhập thông tin bên dưới.'}
            </p>
          ) : items.length ? (
            <ul id={listId} role="listbox" aria-label="Kết quả tìm sách">
              {items.map((b, i) => (
                <li
                  key={`${b.workId}-${b.isbn13}-${i}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={clsx('flex cursor-pointer items-start gap-3 rounded-md px-2 py-2', i === active ? 'bg-navy-50' : 'hover:bg-navy-50')}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(b);
                  }}
                >
                  {b.coverId ? (
                    <img src={thumb(b.coverId)} alt="" loading="lazy" className="h-12 w-8 shrink-0 rounded-sm bg-paper-200 object-cover" />
                  ) : (
                    <span className="flex h-12 w-8 shrink-0 items-center justify-center rounded-sm bg-paper-200 text-ink-500" aria-hidden>
                      <BookOpen size={14} />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-sm font-semibold text-ink-900">{b.title}</span>
                    <span className="block truncate text-[13px] text-ink-500">{[b.authors.join(', '), b.publisher, b.year].filter(Boolean).join(' · ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-sm text-ink-500">Không tìm thấy sách. Nhập thông tin bên dưới.</p>
          )}
        </div>
      )}

      {scanning && (
        <CameraScanner
          onCode={(code) => {
            setScanning(false);
            setText(code);
            setTerm(code);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
