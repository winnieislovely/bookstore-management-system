import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ScanBarcode } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, get } from '../lib/api';
import { formatNumber, formatVnd } from '../lib/format';
import { useDebounced } from './data';
import { InlineAlert } from './ui';

/** Scan-or-search field for back-office forms: Enter on an exact code adds it; typing lists matches. */

export interface ProductHit {
  variantId: string;
  itemId: string;
  kind: string;
  title: string;
  titleVi: string | null;
  sku: string;
  priceVnd: number;
  available: number;
  imageFileId: string | null;
}

export const hitTitle = (h: Pick<ProductHit, 'title' | 'titleVi'>) => h.titleVi || h.title;

export function ProductSearch({ onPick, onUnknownCode, placeholder = 'Quét mã vạch hoặc nhập SKU / tên sản phẩm', autoFocus, scanIcon = true }: { onPick: (h: ProductHit) => void; onUnknownCode?: (code: string) => void; placeholder?: string; autoFocus?: boolean; scanIcon?: boolean }) {
  const [q, setQ] = useState('');
  const [miss, setMiss] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const term = useDebounced(q.trim(), 200);
  const found = useQuery({ queryKey: ['product-search', term], enabled: term.length >= 2, queryFn: () => get<{ items: ProductHit[] }>('/api/v1/catalog/items', { q: term, limit: 8 }) });

  const pick = (h: ProductHit) => {
    onPick(h);
    setQ('');
    setMiss(null);
    input.current?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const code = q.trim();
    if (!code) return;
    try {
      const { variantId } = await get<{ variantId: string }>('/api/v1/catalog/lookup', { code });
      const r = await get<{ items: ProductHit[] }>('/api/v1/catalog/items', { q: code, limit: 20 });
      const hit = r.items.find((x) => x.variantId === variantId);
      if (hit) return pick(hit);
    } catch (err) {
      if (!(err instanceof ApiError && err.code === 'code_not_found')) throw err;
    }
    if (found.data?.items.length === 1) return pick(found.data.items[0]!);
    if (onUnknownCode && /^[\w-]{4,}$/.test(code)) {
      onUnknownCode(code);
      setQ('');
      return;
    }
    setMiss(code);
  };

  return (
    <div className="relative">
      <form onSubmit={(e) => void submit(e)}>
        {scanIcon && <ScanBarcode size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />}
        <input
          ref={input}
          autoFocus={autoFocus}
          className={clsx('h-12 w-full rounded-md border border-paper-500 bg-white pr-3 text-base code focus:border-navy-700', scanIcon ? 'pl-10' : 'pl-3')}
          placeholder={placeholder}
          aria-label={placeholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setMiss(null);
          }}
        />
      </form>
      {miss && (
        <div className="mt-2">
          <InlineAlert tone="danger">Không tìm thấy mã {miss}. Thử tìm theo tên sản phẩm.</InlineAlert>
        </div>
      )}
      {found.data && term.length >= 2 && q.trim() && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full divide-y divide-paper-300 overflow-y-auto rounded-md border border-paper-300 bg-white shadow-md">
          {found.data.items.length === 0 && <li className="px-4 py-3 text-sm text-ink-500">Không có sản phẩm phù hợp.</li>}
          {found.data.items.map((h) => (
            <li key={h.variantId}>
              <button type="button" className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-navy-50" onClick={() => pick(h)}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{hitTitle(h)}</span>
                  <span className="code text-ink-500">{h.sku}</span>
                </span>
                <span className="text-right num">
                  {formatVnd(h.priceVnd)}
                  <span className="block text-[13px] text-ink-500">Tồn {formatNumber(h.available)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
