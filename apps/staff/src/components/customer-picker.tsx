import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Search, User, X } from 'lucide-react';
import { useState } from 'react';
import { get } from '../lib/api';
import { formatPhone } from '../lib/format';
import { useDebounced } from './data';
import { Button, Field } from './ui';

/** A customer as the customer search returns it. */
export interface PickedCustomer {
  id: string;
  name: string;
  phoneE164: string | null;
  tierCode: string | null;
  tierName?: string | null;
  pointsBalance: number;
}

export type CustomerChoice = { kind: 'existing'; customer: PickedCustomer } | { kind: 'new'; phone: string; name: string } | null;

const digitsOf = (s: string) => s.replace(/\D/g, '');
/** Same number whatever the prefix: compares the last 9 digits (0912… and +84912…). */
const samePhone = (e164: string | null, typed: string) => !!e164 && digitsOf(typed).length >= 9 && digitsOf(e164).endsWith(digitsOf(typed).slice(-9));

/** Name and phone only – no tier, no points (Design §12.8). */
const facts = (c: PickedCustomer) => (c.phoneE164 ? formatPhone(c.phoneE164) : '');

/**
 * Customer of an order or pre-order (Design §12.9, §13.1): search an existing customer by phone or
 * name, or take a new one with phone and name. A new customer whose phone is already known is
 * offered the existing profile instead (BR-16).
 */
export function CustomerPicker({ value, onChange, newNameLabel = 'Tên khách' }: { value: CustomerChoice; onChange: (v: CustomerChoice) => void; newNameLabel?: string }) {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 300);
  const found = useQuery({
    queryKey: ['customer-picker', term],
    enabled: term.length >= 2 && !value,
    queryFn: () => get<{ items: PickedCustomer[] }>('/api/v1/customers', { q: term, limit: 3 }),
  });
  // For a new customer, look the typed phone up so an existing profile is not duplicated.
  const newPhone = useDebounced(value?.kind === 'new' ? digitsOf(value.phone) : '', 400);
  const known = useQuery({
    queryKey: ['customer-picker-phone', newPhone],
    enabled: newPhone.length >= 9,
    queryFn: async () => (await get<{ items: PickedCustomer[] }>('/api/v1/customers', { q: newPhone, limit: 5 })).items.find((c) => samePhone(c.phoneE164, newPhone)) ?? null,
  });

  if (value?.kind === 'existing') {
    const c = value.customer;
    return (
      <div className="flex items-center gap-3 rounded-md border border-paper-300 p-3 text-sm">
        <User size={20} className="shrink-0 text-ink-500" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{c.name}</span>
          <span className="text-ink-500 num">{facts(c)}</span>
        </span>
        <Button variant="ghost" icon={X} aria-label="Đổi khách" title="Đổi khách" onClick={() => onChange(null)} />
      </div>
    );
  }

  if (value?.kind === 'new') {
    const dupe = known.data && samePhone(known.data.phoneE164, value.phone) ? known.data : null;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-ink-700">Khách mới</p>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Tìm khách cũ
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Số điện thoại" required inputMode="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
          <Field label={newNameLabel} required value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </div>
        {dupe && (
          <p className="text-sm text-ink-700">
            SĐT này thuộc khách <span className="font-semibold">{dupe.name}</span> –{' '}
            <button type="button" className="font-medium text-navy-700 underline" onClick={() => onChange({ kind: 'existing', customer: dupe })}>
              Chọn khách này
            </button>
          </p>
        )}
      </div>
    );
  }

  // Leaving the search clears it, so coming back starts from an empty field.
  const pick = (v: CustomerChoice) => {
    setQ('');
    onChange(v);
  };
  const items = found.data?.items ?? [];
  const isPhone = digitsOf(q).length >= 6 && /^[\d\s+.-]+$/.test(q.trim());
  const startNew = () => pick({ kind: 'new', phone: isPhone ? q.trim() : '', name: isPhone ? '' : q.trim() });
  const open = term.length >= 2 && !!found.data;
  return (
    // Matches drop down attached to the field; with none, “Khách mới” takes the typed phone (Design §12.8).
    <div className="relative">
      <Search size={20} className="pointer-events-none absolute top-[22px] left-3 -translate-y-1/2 text-ink-500" aria-hidden />
      <input
        className={clsx('h-11 w-full border border-paper-500 bg-white pr-3 pl-10 text-sm focus:border-navy-700', open ? 'rounded-t-md' : 'rounded-md')}
        placeholder="Tìm theo SĐT hoặc tên khách"
        aria-label="Tìm khách theo số điện thoại hoặc tên"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {open && (
        <ul className="absolute inset-x-0 top-full z-20 divide-y divide-paper-300 overflow-hidden rounded-b-md border border-t-0 border-paper-500 bg-white shadow-md">
          {items.slice(0, 3).map((c) => (
            <li key={c.id}>
              <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-navy-50" onClick={() => pick({ kind: 'existing', customer: c })}>
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="whitespace-nowrap text-ink-500 num">{facts(c)}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-navy-700 hover:bg-navy-50" onClick={startNew}>
                <Plus size={16} aria-hidden /> {isPhone ? `Khách mới với SĐT ${q.trim()}` : 'Khách mới'}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
