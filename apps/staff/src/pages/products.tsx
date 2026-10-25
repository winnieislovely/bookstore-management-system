import { useQueries, useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertOctagon, AlertTriangle, BookOpen, CalendarClock, Check, Download, EyeOff, ImageOff, Package, Plus, Search, Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, EmptyState, ErrorState, PageHeader, Skeleton, StatusChip } from '../components/ui';
import { get } from '../lib/api';
import { formatNumber, formatVnd } from '../lib/format';
import { t } from '../lib/i18n';
import { can, useMe } from '../lib/session';

/** Product list (FR-CAT-11, Design §12.1): SKU is the only code column; no channel column. */

interface ProductRow {
  variantId: string;
  itemId: string;
  kind: string;
  title: string;
  titleVi: string | null;
  authors: string[];
  sku: string;
  priceVnd: number;
  available: number;
  minStock: number | null;
  status: string;
  releaseDate: string | null;
  imageFileId: string | null;
  missingImage: boolean;
}
interface ProductPage {
  items: ProductRow[];
  total: number;
  page: number;
  limit: number;
}

type Chip = { key: string; label: string; params: Record<string, string> };
const CHIPS: Chip[] = [
  { key: 'active', label: 'Đang bán', params: { status: 'active' } },
  { key: 'low', label: t('stock.low'), params: { stock: 'low' } },
  { key: 'out', label: t('stock.out'), params: { stock: 'out' } },
  { key: 'hidden', label: 'Ẩn', params: { status: 'hidden' } },
  { key: 'missing', label: t('item.missingImage'), params: { image: 'missing' } },
];

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Cover 40 × 60 for books, square for other goods; placeholder instead of a broken image (Design §8.2). */
function Thumb({ row }: { row: ProductRow }) {
  const book = row.kind === 'book';
  const box = book ? 'h-[60px] w-10' : 'size-10';
  if (!row.imageFileId) {
    const Icon = book ? BookOpen : Package;
    return (
      <div className={clsx(box, 'flex items-center justify-center rounded-sm border border-paper-300 bg-paper-200')}>
        <Icon size={16} className="text-ink-300" aria-hidden />
      </div>
    );
  }
  return <img src={`/api/v1/files/${row.imageFileId}`} alt="" loading="lazy" className={clsx(box, 'rounded-sm border border-paper-300 bg-white', book ? 'object-cover' : 'object-contain')} />;
}

function StockStatus({ row }: { row: ProductRow }) {
  const chips = [];
  if (row.status === 'hidden') chips.push(<StatusChip key="h" tone="neutral" icon={EyeOff}>{t('item.hidden')}</StatusChip>);
  if (row.status === 'discontinued') chips.push(<StatusChip key="d" tone="neutral">{t('item.discontinued')}</StatusChip>);
  if (row.releaseDate && new Date(row.releaseDate) > new Date()) chips.push(<StatusChip key="u" tone="accent" icon={CalendarClock}>{t('stock.upcoming')}</StatusChip>);
  else if (row.available < 0) chips.push(<StatusChip key="n" tone="danger" icon={AlertOctagon}>{t('stock.negative')}</StatusChip>);
  else if (row.available === 0) chips.push(<StatusChip key="o" tone="danger" icon={AlertOctagon}>{t('stock.out')}</StatusChip>);
  else if (row.minStock != null && row.available <= row.minStock) chips.push(<StatusChip key="l" tone="warning" icon={AlertTriangle}>{t('stock.low')}</StatusChip>);
  else chips.push(<StatusChip key="s" tone="success">{t('stock.inStock')}</StatusChip>);
  if (row.missingImage) chips.push(<StatusChip key="m" tone="neutral" icon={ImageOff}>{t('item.missingImage')}</StatusChip>);
  return <div className="flex flex-wrap gap-1">{chips}</div>;
}

export function ProductsPage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const debounced = useDebounced(q);
  const page = Number(params.get('page') ?? 1);
  const chip = CHIPS.find((c) => Object.entries(c.params).every(([k, v]) => params.get(k) === v));

  // Filters, search and page live in the URL (Design §12.1).
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set('q', debounced);
    else next.delete('q');
    if (debounced !== (params.get('q') ?? '')) next.delete('page');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = { q: params.get('q') ?? undefined, ...(chip?.params ?? {}), page, limit: 40 };
  const list = useQuery({ queryKey: ['products', query], queryFn: () => get<ProductPage>('/api/v1/catalog/items', query) });
  const counts = useQueries({
    queries: CHIPS.map((c) => ({
      queryKey: ['products-count', c.key, params.get('q') ?? ''],
      queryFn: () => get<ProductPage>('/api/v1/catalog/items', { q: params.get('q') ?? undefined, ...c.params, limit: 1 }),
    })),
  });

  const toggleChip = (c: Chip) => {
    const next = new URLSearchParams(params);
    for (const k of ['status', 'stock', 'image', 'page']) next.delete(k);
    if (chip?.key !== c.key) for (const [k, v] of Object.entries(c.params)) next.set(k, v);
    setParams(next);
  };
  const goPage = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };

  const total = list.data?.total ?? 0;
  const from = total ? (page - 1) * 40 + 1 : 0;
  const to = Math.min(page * 40, total);

  return (
    <>
      <PageHeader
        title={t('products.title')}
        actions={
          <>
            {can(me, 'catalog.import') && (
              <>
                <a className="inline-flex h-10 items-center gap-2 rounded-full px-[18px] text-sm font-medium text-navy-700 hover:bg-navy-50" href="/api/v1/admin/import/products/template">
                  <Download size={20} aria-hidden /> {t('products.template')}
                </a>
                <Button variant="secondary" icon={Upload} onClick={() => navigate('/import?kind=products')}>
                  {t('products.import')}
                </Button>
              </>
            )}
            {can(me, 'purchasing.manage') && (
              <Button variant="primary" icon={Plus} onClick={() => navigate('/stock-in')}>
                {t('products.add')}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3">
        <div className="relative max-w-xl">
          <Search size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />
          <input
            className="h-10 w-full rounded-md border border-paper-500 bg-white pr-10 pl-10 text-sm placeholder:text-ink-500 focus:border-navy-700 max-sm:text-base"
            placeholder={t('products.search')}
            aria-label={t('products.search')}
            aria-describedby="search-hint"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button type="button" className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-navy-50" aria-label={t('common.clearFilters')} onClick={() => setQ('')}>
              <X size={16} aria-hidden />
            </button>
          )}
          <p id="search-hint" className="mt-1 text-[13px] text-ink-500">
            {t('common.searchHint')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('common.filters')}>
          {CHIPS.map((c, i) => {
            const selected = chip?.key === c.key;
            const n = counts[i]?.data?.total;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleChip(c)}
                className={clsx('inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm', selected ? 'border-navy-700 bg-navy-100 text-navy-700' : 'border-paper-500 bg-white text-ink-700 hover:bg-navy-50')}
              >
                {selected && <Check size={16} aria-hidden />}
                {c.label}
                {n !== undefined && <span className="num">({formatNumber(n)})</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-paper-300 bg-white">
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : list.data && list.data.items.length === 0 ? (
          params.get('q') || chip ? (
            <EmptyState
              icon={Search}
              title={t('products.noResults', { q: params.get('q') ?? chip?.label ?? '' })}
              help={t('products.noResultsHelp')}
              actions={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQ('');
                    setParams(new URLSearchParams());
                  }}
                >
                  {t('common.clearFilters')}
                </Button>
              }
            />
          ) : (
            <EmptyState icon={BookOpen} title={t('products.empty')} help={t('products.emptyHelp')} />
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0 bg-paper-200 text-[13px] font-semibold text-ink-700">
                <tr className="h-11">
                  <th scope="col" className="w-16 px-4 text-left">{t('products.col.image')}</th>
                  <th scope="col" className="px-4 text-left">{t('products.col.name')}</th>
                  <th scope="col" className="px-4 text-left">{t('products.col.sku')}</th>
                  <th scope="col" className="px-4 text-right">{t('products.col.available')}</th>
                  <th scope="col" className="px-4 text-right">{t('products.col.price')}</th>
                  <th scope="col" className="px-4 text-left">{t('products.col.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-300">
                {list.data
                  ? list.data.items.map((r) => (
                      <tr key={r.variantId} className="h-[52px] cursor-pointer hover:bg-navy-50" onClick={() => navigate(`/products/${r.itemId}`)}>
                        <td className="px-4 py-2">
                          <Thumb row={r} />
                        </td>
                        <td className="px-4 py-2">
                          <a href={`/products/${r.itemId}`} onClick={(e) => e.preventDefault()} className="font-medium text-ink-900">
                            {r.titleVi || r.title}
                          </a>
                          {r.authors.length > 0 && <div className="text-[13px] text-ink-500">{r.authors.join(', ')}</div>}
                        </td>
                        <td className="px-4 py-2 code">{r.sku}</td>
                        <td className={clsx('px-4 py-2 text-right num', r.available <= 0 && 'text-danger-700')}>{formatNumber(r.available)}</td>
                        <td className="px-4 py-2 text-right num">{formatVnd(r.priceVnd)}</td>
                        <td className="px-4 py-2">
                          <StockStatus row={r} />
                        </td>
                      </tr>
                    ))
                  : Array.from({ length: 8 }, (_, i) => (
                      <tr key={i} className="h-[52px]">
                        <td colSpan={6} className="px-4">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {total > 0 && (
        <nav className="mt-4 flex items-center justify-end gap-2 text-sm" aria-label="Phân trang">
          <span className="text-ink-700 num">{t('common.pageOf', { from: formatNumber(from), to: formatNumber(to), total: formatNumber(total) })}</span>
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => goPage(page - 1)} aria-label={t('common.prev')}>
            ‹
          </Button>
          <Button size="sm" variant="ghost" disabled={to >= total} onClick={() => goPage(page + 1)} aria-label={t('common.next')}>
            ›
          </Button>
        </nav>
      )}
    </>
  );
}
