import type { ManualDiscount } from '@bookstore/domain';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';

/** The typed text as a percentage discount (bp, at most 100 %); empty or zero = none. */
function parse(text: string): ManualDiscount | null {
  const bp = Math.min(10000, Math.round(Number(text.replace(',', '.') || 0) * 100));
  return Number.isFinite(bp) && bp > 0 ? { kind: 'percent', bp } : null;
}

/**
 * The manual order discount typed in place (FR-POS-02, FR-ORD-02; Design §12.9, §13.1): one field,
 * a percentage only, “%” after the number. Each change applies at once; clearing the field removes it.
 */
export function DiscountInput({
  value,
  onChange,
  disabled,
  size = 'sm',
  fill,
  className,
}: {
  value: ManualDiscount | null;
  onChange: (d: ManualDiscount | null) => void;
  disabled?: boolean;
  /** sm: compact (36 px); md: a form field (40 px). */
  size?: 'sm' | 'md';
  /** Take the full width. */
  fill?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value?.kind === 'percent' ? String(value.bp / 100) : '');
  // Cleared from outside (new sale, discount removed): empty the field too.
  useEffect(() => {
    if (!value && parse(text)) setText('');
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const h = size === 'sm' ? 'h-9' : 'h-10 pointer-coarse:h-11';
  return (
    <span
      className={clsx(
        h,
        fill ? 'flex w-full' : 'inline-flex w-32',
        'items-center gap-2 rounded-md border border-paper-500 bg-white px-3 focus-within:border-navy-700',
        disabled && 'opacity-40',
        className,
      )}
    >
      <input
        aria-label="Giảm giá đơn (%)"
        inputMode="decimal"
        className="h-full min-w-0 flex-1 bg-transparent text-right text-sm num outline-none"
        placeholder="0"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '');
          setText(t);
          onChange(parse(t));
        }}
      />
      <span className="shrink-0 text-sm text-ink-500" aria-hidden>
        %
      </span>
    </span>
  );
}
