import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';

/**
 * A compact dropdown (Design §12.8, §12.9): a 36 px button opening a small menu. Not a native select, so it
 * stays at body size on phones without the iPhone zoom on focus.
 */
export function CompactSelect<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = options.find(([k]) => k === value)?.[1] ?? '';
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-9 min-w-36 items-center justify-between gap-2 rounded-md border border-paper-500 bg-white px-3 text-sm font-medium before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] disabled:bg-paper-100 disabled:text-ink-500"
      >
        {current}
        {!disabled && <ChevronDown size={16} className={clsx('text-ink-500 transition-transform', open && 'rotate-180')} aria-hidden />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <ul role="listbox" aria-label={label} className="absolute right-0 z-20 mt-1 min-w-full overflow-hidden rounded-md border border-paper-300 bg-white py-1 shadow-md">
            {options.map(([k, text]) => (
              <li key={k} role="option" aria-selected={k === value}>
                <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm whitespace-nowrap hover:bg-navy-50" onClick={() => { onChange(k); setOpen(false); }}>
                  {text}
                  {k === value && <Check size={16} className="text-navy-700" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}


/**
 * The same button opening a menu of square ticks, for several choices (Design §13.8). Reads “Tất cả” when every
 * option is ticked; the menu stays open while ticking.
 */
export function CompactMultiSelect<T extends string>({ label, values, options, onChange, className }: { label: string; values: T[]; options: [T, string][]; onChange: (v: T[]) => void; className?: string }) {
  // The menu is fixed to the button's place, so a scrolling dialog body never clips it; it opens upward
  // when there is no room below (a bottom sheet on phones).
  const [menu, setMenu] = useState<null | { top?: number; bottom?: number; right: number; minWidth: number }>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const open = !!menu;
  const setOpen = (o: boolean) => {
    const r = btn.current?.getBoundingClientRect();
    const below = !!r && window.innerHeight - r.bottom > options.length * 44 + 16;
    setMenu(o && r ? { ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }), right: window.innerWidth - r.right, minWidth: r.width } : null);
  };
  const current = values.length === options.length ? 'Tất cả' : values.length ? options.filter(([k]) => values.includes(k)).map(([, t]) => t).join(', ') : 'Chưa chọn';
  return (
    <div className={clsx('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        ref={btn}
        aria-label={`${label}: ${current}`}
        onClick={() => setOpen(!open)}
        className="relative inline-flex h-9 w-full min-w-36 items-center justify-between gap-2 rounded-md border border-paper-500 bg-white px-3 text-sm font-medium before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
      >
        <span className={clsx('truncate', !values.length && 'text-ink-500')}>{current}</span>
        <ChevronDown size={16} className={clsx('shrink-0 text-ink-500 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} aria-hidden />
          <ul role="listbox" aria-label={label} aria-multiselectable style={menu!} className="fixed z-[70] overflow-hidden rounded-md border border-paper-300 bg-white py-1 shadow-md">
            {options.map(([k, text]) => (
              <li key={k} role="option" aria-selected={values.includes(k)}>
                <label className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-3 text-sm whitespace-nowrap hover:bg-navy-50">
                  <input type="checkbox" className="size-[18px] accent-navy-700" checked={values.includes(k)} onChange={() => onChange(values.includes(k) ? values.filter((x) => x !== k) : options.map(([o]) => o).filter((o) => o === k || values.includes(o)))} />
                  {text}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
