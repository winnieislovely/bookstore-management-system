import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertOctagon, AlertTriangle, BookOpen, CalendarClock, EyeOff, ImageOff, Package, Plus, Printer, Search, Upload } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { DataTable, FilterMenu, Pager, SearchBox, SelectField, toast, useListParam, useParam, type Column } from '../components/data';
import { Button, Field, PageHeader, StatusChip } from '../components/ui';
import { get } from '../lib/api';
import { formatDate, formatNumber, formatVnd } from '../lib/format';
import { t } from '../lib/i18n';
import { printHtml } from '../lib/print';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';
import { ImportWizard } from './import';

/** Product list (FR-CAT-01, FR-CAT-11, FR-CAT-13, Design §12.1): SKU first; create on the page; bulk barcode printing. */

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
  onHand: number;
  avgCostVnd?: number | null;
  updatedAt: string;
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
export interface Category {
  id: string;
  parentId: string | null;
  i18n: { vi?: { name?: string }; en?: { name?: string } };
  kinds: string[];
}
export interface Named {
  id: string;
  i18n: { vi?: { name?: string }; en?: { name?: string } };
}
export const nameOf = (n: Named) => n.i18n.vi?.name || n.i18n.en?.name || '';

const KINDS = [
  { key: 'book', label: 'Sách' },
  { key: 'stationery', label: 'Văn phòng phẩm' },
  { key: 'other', label: 'Sản phẩm khác' },
  { key: 'bundle', label: 'Combo' },
];

/** Category tree in display order with depth; with kinds set, only branches holding items of those kinds (Design §12.1). */
export function categoryOptions(all: Category[], kinds: string[]): { key: string; label: string }[] {
  const children = new Map<string | null, Category[]>();
  for (const c of all) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c]);
  const holds = (c: Category): boolean => c.kinds.some((k) => kinds.includes(k)) || (children.get(c.id) ?? []).some(holds);
  const out: { key: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      if (kinds.length && !holds(c)) continue;
      out.push({ key: c.id, label: `${' '.repeat(depth)}${nameOf(c)}` });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
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
  const [q, setQ] = useParam('q');
  const [stock, setStock] = useListParam('stock');
  const [kind, setKind] = useListParam('kind');
  const [category, setCategory] = useListParam('category');
  const [status, setStatus] = useListParam('status');
  const [image, setImage] = useListParam('image');
  const [page, setPage] = useParam('page', '1');
  const [selected, setSelected] = useState<Map<string, ProductRow>>(new Map());
  const [dialog, setDialog] = useState<null | 'labels' | 'import'>(null);
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => get<{ items: Category[] }>('/api/v1/catalog/categories') });

  const csv = (v: string[]) => v.join(',') || undefined;
  const query = { q: q || undefined, stock: csv(stock), kind: csv(kind), category: csv(category), status: csv(status), image: csv(image), page: Number(page), limit: 40 };
  const filtered = !!(q || stock.length || kind.length || category.length || status.length || image.length);
  const list = useQuery({ queryKey: ['products', query], queryFn: () => get<ProductPage>('/api/v1/catalog/items', query) });
  const showCost = list.data?.items.some((r) => 'avgCostVnd' in r) ?? false;

  const columns: Column<ProductRow>[] = [
    { header: t('products.col.sku'), cell: (r) => <span className="code">{r.sku}</span> },
    { header: t('products.col.image'), className: 'w-16', cell: (r) => <Thumb row={r} /> },
    {
      header: t('products.col.name'),
      className: 'min-w-[200px]',
      cell: (r) => (
        <>
          <span className="font-medium text-ink-900">{r.titleVi || r.title}</span>
          {r.authors.length > 0 && <span className="block text-[13px] text-ink-500">{r.authors.join(', ')}</span>}
        </>
      ),
    },
    { header: t('products.col.stock'), align: 'right', cell: (r) => <span className={clsx(r.onHand <= 0 && 'text-danger-700')}>{formatNumber(r.onHand)}</span> },
    { header: t('products.col.price'), align: 'right', cell: (r) => formatVnd(r.priceVnd) },
    // Cost only with `catalog.view_cost` (FR-CAT-07); the API omits it otherwise.
    ...(showCost ? [{ header: t('products.col.cost'), align: 'right' as const, cell: (r: ProductRow) => (r.avgCostVnd ? formatVnd(r.avgCostVnd) : '—') }] : []),
    { header: t('products.col.status'), cell: (r) => <StockStatus row={r} /> },
    { header: t('products.col.updated'), className: 'whitespace-nowrap', cell: (r) => formatDate(r.updatedAt) },
  ];

  // Selection survives paging; the bar acts on everything ticked (Design §10.6).
  const selection = {
    selected: new Set(selected.keys()),
    onChange: (keys: Set<string>) => {
      const next = new Map<string, ProductRow>();
      for (const k of keys) {
        const row = selected.get(k) ?? list.data?.items.find((r) => r.variantId === k);
        if (row) next.set(k, row);
      }
      setSelected(next);
    },
  };

  return (
    <>
      <PageHeader
        title={t('products.title')}
        actions={
          <>
            {can(me, 'catalog.import') && (
              <Button variant="secondary" icon={Upload} onClick={() => setDialog('import')}>
                {t('products.import')}
              </Button>
            )}
            {can(me, 'catalog.edit') && (
              <Button variant="primary" icon={Plus} onClick={() => navigate('/products/new')}>
                {t('products.add')}
              </Button>
            )}
          </>
        }
      />
      {selected.size > 0 ? (
        <div className="mb-4 flex min-h-12 flex-wrap items-center gap-3 rounded-lg bg-navy-50 px-4 py-2 text-sm" role="region" aria-label="Thao tác hàng loạt">
          <span className="font-medium text-navy-700 num">Đã chọn {formatNumber(selected.size)} sản phẩm</span>
          <Button size="sm" variant="primary" icon={Printer} onClick={() => setDialog('labels')}>
            In mã vạch
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>
            Bỏ chọn
          </Button>
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder={t('products.search')} />
          <FilterMenu
            groups={[
              {
                label: 'Tồn kho',
                options: [
                  { key: 'in_stock', label: t('stock.inStock') },
                  { key: 'low', label: t('stock.low') },
                  { key: 'out', label: t('stock.out') },
                ],
                values: stock,
                onChange: setStock,
              },
              { label: 'Loại', options: KINDS, values: kind, onChange: setKind },
              { label: 'Phân loại', options: categoryOptions(categories.data?.items ?? [], kind), values: category, onChange: setCategory },
              {
                label: 'Trạng thái',
                options: [
                  { key: 'active', label: 'Đang bán' },
                  { key: 'hidden', label: 'Ẩn' },
                  { key: 'discontinued', label: 'Ngừng bán' },
                ],
                values: status,
                onChange: setStatus,
              },
              { label: 'Ảnh', options: [{ key: 'missing', label: t('item.missingImage') }], values: image, onChange: setImage },
            ]}
          />
        </div>
      )}
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.variantId}
        onRow={(r) => navigate(`/products/${r.itemId}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        minWidth={showCost ? 920 : 820}
        {...(can(me, 'catalog.view') && { selection })}
        empty={filtered ? { icon: Search, title: q ? t('products.noResults', { q }) : 'Không có sản phẩm phù hợp', help: t('products.noResultsHelp') } : { icon: BookOpen, title: t('products.empty'), help: t('products.emptyHelp') }}
      />
      <Pager page={Number(page)} hasMore={Number(page) * 40 < (list.data?.total ?? 0)} total={list.data?.total ?? 0} onPage={(p) => setPage(String(p))} />
      {dialog === 'labels' && <BulkLabelDialog rows={[...selected.values()]} onClose={() => setDialog(null)} />}
      {/* Excel import without leaving the Products page (Design §12.10). */}
      {dialog === 'import' && (
        <Dialog title="Nhập sản phẩm từ Excel" size="lg" onClose={() => setDialog(null)}>
          <ImportWizard kind="products" onImported={() => void list.refetch()} />
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Bulk barcode labels for the selected products (FR-CAT-13)

function BulkLabelDialog({ rows, onClose }: { rows: ProductRow[]; onClose: () => void }) {
  const [template, setTemplate] = useState<'barcode' | 'shelf' | 'sale_price'>('barcode');
  const [sheet, setSheet] = useState<'a4' | 'roll'>('a4');
  const [start, setStart] = useState('1');
  const [copies, setCopies] = useState<Record<string, number>>(() => Object.fromEntries(rows.map((r) => [r.variantId, 1])));
  const total = Object.values(copies).reduce((a, n) => a + n, 0);
  return (
    <Dialog
      title="In mã vạch"
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button
            variant="primary"
            icon={Printer}
            disabled={total === 0}
            onClick={async () => {
              const res = await fetch('/api/v1/catalog/labels', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json', 'x-bms-request': '1' },
                body: JSON.stringify({ template, sheet, startPosition: Number(start) || 1, items: rows.filter((r) => (copies[r.variantId] ?? 0) > 0).map((r) => ({ variantId: r.variantId, copies: copies[r.variantId] })) }),
              });
              if (!res.ok) {
                const e = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
                toast.error(e?.error?.message ?? 'Không tạo được nhãn.');
                return;
              }
              printHtml(await res.text());
              onClose();
            }}
          >
            In {formatNumber(total)} nhãn
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectField label="Mẫu nhãn" value={template} onChange={(e) => setTemplate(e.target.value as typeof template)}>
            <option value="barcode">Nhãn mã vạch</option>
            <option value="shelf">Nhãn kệ</option>
            <option value="sale_price">Nhãn giá khuyến mãi</option>
          </SelectField>
          <SelectField label="Khổ giấy" value={sheet} onChange={(e) => setSheet(e.target.value as typeof sheet)}>
            <option value="a4">Giấy A4 (tờ nhãn)</option>
            <option value="roll">Cuộn nhãn</option>
          </SelectField>
          {sheet === 'a4' && <Field label="Bắt đầu từ ô số" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} />}
        </div>
        <ul className="max-h-80 divide-y divide-paper-300 overflow-y-auto rounded-lg border border-paper-300">
          {rows.map((r) => (
            <li key={r.variantId} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.titleVi || r.title}</span>
                <span className="code text-[13px] text-ink-500">{r.sku}</span>
              </span>
              <input
                className="h-9 w-16 rounded-md border border-paper-500 text-center text-sm num"
                inputMode="numeric"
                aria-label={`Số nhãn ${r.sku}`}
                value={String(copies[r.variantId] ?? 0)}
                onChange={(e) => setCopies({ ...copies, [r.variantId]: Math.min(500, Number(e.target.value.replace(/\D/g, '')) || 0) })}
              />
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
