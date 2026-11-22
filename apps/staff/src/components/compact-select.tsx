import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';

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

