import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';
import { get } from '../lib/api';
import { formatNumber } from '../lib/format';

/** As the server stores it: capitals, single spaces (FR-LIB-02). */
export const normalizeShelf = (v: string) => v.trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Kệ of library copies (FR-LIB-02, Design §13.8): pick a shelf in use (with its copy count) or type a
 * new one (“+ Kệ mới: B3”). With `suggest`, an empty field takes the shelf suggested for the title's
 * Dewey class until staff change it.
 */
export function ShelfPicker({ value, onChange, required, dewey, titleId, suggest = false }: { value: string; onChange: (v: string) => void; required?: boolean | undefined; dewey?: string | null | undefined; titleId?: string | undefined; suggest?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const touched = useRef(false);
  const q = useQuery({
    queryKey: ['library-shelves', dewey ?? null, titleId ?? null],
    queryFn: () => get<{ items: { shelf: string; copies: number }[]; suggested: string | null }>('/api/v1/library/shelves', { dewey: dewey || undefined, title: titleId }),
  });
  // Pre-fill the suggestion while staff have not typed a shelf themselves.
  const suggested = q.data?.suggested ?? null;
  useEffect(() => {
    if (suggest && !touched.current && suggested && suggested !== value) onChange(suggested);
  }, [suggest, suggested]); // eslint-disable-line react-hooks/exhaustive-deps
  const typed = normalizeShelf(value);
  const items = (q.data?.items ?? []).filter((s) => !typed || s.shelf.includes(typed));
  const isNew = !!typed && !(q.data?.items ?? []).some((s) => s.shelf === typed);
  const choose = (v: string) => {
    touched.current = true;
    onChange(v);
    setOpen(false);
  };
  const listed = open && (items.length > 0 || isNew);
  // In the form flow (a dialog would clip a floating list): bring it into view when it opens.
  useEffect(() => {
    if (listed) listRef.current?.scrollIntoView({ block: 'nearest' });
  }, [listed]);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-700">
        Kệ
        {required && <span className="text-danger-700"> *</span>}
      </label>
      {/* The list drops down attached to the field, like the customer search (Design §12.8, §13.8). */}
      <div className="relative">
        <input
          id={id}
          required={required}
          value={value}
          autoComplete="off"
          role="combobox"
          aria-expanded={listed}
          aria-controls={`${id}-list`}
          className={clsx(
            'h-10 w-full border bg-white px-3 text-sm text-ink-900 placeholder:text-ink-500 max-sm:text-base pointer-coarse:h-11 hover:border-ink-500 focus:border-navy-700',
            listed ? 'rounded-t-md border-navy-700' : 'rounded-md border-paper-500',
          )}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Let a click on an option land first.
            setTimeout(() => setOpen(false), 150);
            if (value !== typed) onChange(typed);
          }}
          onChange={(e) => {
            touched.current = true;
            onChange(e.target.value.toUpperCase());
            setOpen(true);
          }}
        />
      {listed && (
        <ul ref={listRef} id={`${id}-list`} className="max-h-56 divide-y divide-paper-300 overflow-y-auto rounded-b-md border border-t-0 border-navy-700 bg-white shadow-md" role="listbox">
          {isNew && (
            <li>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-navy-700 hover:bg-navy-50" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(typed)}>
                <Plus size={16} aria-hidden /> Kệ mới: {typed}
              </button>
            </li>
          )}
          {items.map((s) => (
            <li key={s.shelf}>
              <button type="button" role="option" aria-selected={s.shelf === typed} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-navy-50" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(s.shelf)}>
                <span className="font-medium">{s.shelf}</span>
                <span className="text-[13px] text-ink-500 num">{formatNumber(s.copies)} cuốn</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}
