import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertOctagon, AlertTriangle, ArrowLeft, BookOpen, Boxes, Package, PackagePlus, Search, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApprovalPrompt, DataTable, Facts, FilterMenu, Pager, SearchBox, SelectionBar, SelectField, TextArea, TimeFilter, timeLabel, timeRange, toast, useListParam, useParam, type Column } from '../components/data';
import { Button, Card, ErrorState, InlineAlert, PageHeader, Skeleton, StatusChip } from '../components/ui';
import { ApiError, get, post } from '../lib/api';
import { formatDateTime, formatNumber, formatVnd } from '../lib/format';
import { t } from '../lib/i18n';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';
import { StockInForm } from './stockin';

/**
 * Stock (FR-INV-01..11, FR-PUR-01..07, Design §12.1): one page for stock and stock-in – a product-style
 * table with stock state and latest change, bulk “Nhập thêm hàng” / “Điều chỉnh tồn”, and a stock page per product.
 */

export const MOVEMENT_LABEL: Record<string, string> = {
  stock_in: 'Nhập hàng',
  sale: 'Bán hàng',
  customer_return: 'Khách trả',
  consignment_receipt: 'Nhận ký gửi',
  consignment_return: 'Trả ký gửi',
  adjustment: 'Điều chỉnh',
  count: 'Kiểm kho',
  write_off: 'Hủy hàng',
  bundle_use: 'Xuất cho combo',
  library_transfer: 'Chuyển thư viện',
};

interface StockRow {
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
  minStock: number | null;
  avgCostVnd?: number | null;
  lastMovementAt: string | null;
  imageFileId: string | null;
}
const nameOfRow = (r: { titleVi: string | null; title: string }) => r.titleVi || r.title;

/** Stock state of a row: out, low (at or under the minimum) or in stock. */
function StockState({ available, minStock }: { available: number; minStock: number | null }) {
  if (available <= 0) return <StatusChip tone="danger" icon={AlertOctagon}>{t('stock.out')}</StatusChip>;
  if (minStock != null && available <= minStock) return <StatusChip tone="warning" icon={AlertTriangle}>{t('stock.low')}</StatusChip>;
  return <StatusChip tone="success">{t('stock.inStock')}</StatusChip>;
}

function Thumb({ row }: { row: StockRow }) {
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

interface AdjustPick {
  variantId: string;
  title: string;
  sku: string;
}

export function StockPage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [q, setQ] = useParam('q');
  const [state, setState] = useListParam('stock');
  const [changed, setChanged] = useParam('changed');
  const [unsold, setUnsold] = useParam('unsold');
  const changedRange = timeRange(changed);
  const [page, setPage] = useParam('page', '1');
  const [selected, setSelected] = useState<Map<string, StockRow>>(new Map());
  // 'in': ticked products; 'search': empty form from the header button, products added one at a time.
  const [dialog, setDialog] = useState<null | 'in' | 'search' | 'adjust'>(null);
  const query = { q: q || undefined, stock: state.join(',') || undefined, changedFrom: changedRange.from, changedTo: changedRange.to, unsoldDays: unsold || undefined, page: Number(page), limit: 40 };
  const list = useQuery({ queryKey: ['stock-list', query], queryFn: () => get<{ items: StockRow[]; total: number }>('/api/v1/catalog/items', query) });
  const value = useQuery({ queryKey: ['valuation'], queryFn: () => get<{ totalVnd: number }>('/api/v1/inventory/valuation'), enabled: can(me, 'catalog.view_cost') });
  const showCost = list.data?.items.some((r) => 'avgCostVnd' in r) ?? false;
  const filtered = !!(q || state.length || changed || unsold);
  const refresh = () => {
    void list.refetch();
    void value.refetch();
  };

  const columns: Column<StockRow>[] = [
    { header: 'SKU', cell: (r) => <span className="code">{r.sku}</span> },
    { header: 'Ảnh', className: 'w-16', cell: (r) => <Thumb row={r} /> },
    {
      header: 'Tên sản phẩm',
      className: 'min-w-[200px]',
      cell: (r) => (
        <>
          <span className="font-medium text-ink-900">{nameOfRow(r)}</span>
          {r.authors.length > 0 && <span className="block text-[13px] text-ink-500">{r.authors.join(', ')}</span>}
        </>
      ),
    },
    { header: 'Tồn', align: 'right', cell: (r) => <span className={clsx('font-semibold', r.onHand <= 0 && 'text-danger-700')}>{formatNumber(r.onHand)}</span> },
    { header: 'Tối thiểu', align: 'right', cell: (r) => (r.minStock == null ? '—' : formatNumber(r.minStock)) },
    ...(showCost ? [{ header: 'Giá nhập', align: 'right' as const, cell: (r: StockRow) => (r.avgCostVnd ? formatVnd(r.avgCostVnd) : '—') }] : []),
    { header: 'Tình trạng', cell: (r) => <StockState available={r.available} minStock={r.minStock} /> },
    { header: 'Thay đổi gần nhất', className: 'whitespace-nowrap', cell: (r) => (r.lastMovementAt ? formatDateTime(r.lastMovementAt) : '—') },
  ];

  const selection = {
    selected: new Set(selected.keys()),
    onChange: (keys: Set<string>) => {
      const next = new Map<string, StockRow>();
      for (const k of keys) {
        const row = selected.get(k) ?? list.data?.items.find((r) => r.variantId === k);
        if (row) next.set(k, row);
      }
      setSelected(next);
    },
  };
  const picks = [...selected.values()];

  return (
    <>
      <PageHeader
        title="Tồn kho"
        subtitle={value.data ? <span className="num">Giá trị tồn kho: <span className="font-semibold text-ink-900">{formatVnd(value.data.totalVnd)}</span></span> : undefined}
        actions={
          can(me, 'purchasing.manage') && (
            <Button variant="primary" icon={PackagePlus} onClick={() => setDialog('search')}>
              Nhập thêm hàng
            </Button>
          )
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder={t('products.search')} />
        <FilterMenu
          groups={[
            {
              label: 'Tình trạng',
              options: [
                { key: 'in_stock', label: t('stock.inStock') },
                { key: 'low', label: t('stock.low') },
                { key: 'out', label: t('stock.out') },
              ],
              values: state,
              onChange: setState,
            },
            // Time of the latest stock change (Design §12.1).
            { kind: 'custom', label: 'Thay đổi gần nhất', summary: timeLabel(changed), active: !!changed, onClear: () => setChanged(''), content: <TimeFilter value={changed} onChange={setChanged} /> },
            // Slow movers: in stock, no sale in that time (FR-INV-10, Design §12.1).
            {
              kind: 'single',
              label: 'Chưa bán trong',
              options: [
                { key: '30', label: '30 ngày' },
                { key: '60', label: '60 ngày' },
                { key: '90', label: '90 ngày' },
              ],
              value: unsold,
              onChange: setUnsold,
            },
          ]}
        />
      </div>
      {/* Bulk bar under the search row; search and filters stay usable (Design §10.6). */}
      {selected.size > 0 && (
        <SelectionBar
          items={[...selected.values()].map((r) => ({ key: r.variantId, label: nameOfRow(r), code: r.sku }))}
          onRemove={(key) => {
            const next = new Map(selected);
            next.delete(key);
            setSelected(next);
          }}
          onClear={() => setSelected(new Map())}
          actions={
            <>
              {can(me, 'purchasing.manage') && (
                <Button size="sm" variant="primary" icon={PackagePlus} onClick={() => setDialog('in')}>
                  Nhập thêm hàng
                </Button>
              )}
              {can(me, 'inventory.adjust') && (
                <Button size="sm" variant="secondary" icon={SlidersHorizontal} onClick={() => setDialog('adjust')}>
                  Điều chỉnh tồn
                </Button>
              )}
            </>
          }
        />
      )}
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.variantId}
        onRow={(r) => navigate(`/stock/${r.itemId}?v=${r.variantId}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        minWidth={showCost ? 940 : 840}
        selection={selection}
        empty={filtered ? { icon: Search, title: 'Không có sản phẩm phù hợp', help: t('products.noResultsHelp') } : { icon: Boxes, title: 'Chưa có sản phẩm', help: 'Thêm sản phẩm ở trang Sản phẩm.' }}
      />
      <Pager page={Number(page)} hasMore={Number(page) * 40 < (list.data?.total ?? 0)} total={list.data?.total ?? 0} onPage={(p) => setPage(String(p))} />
      {dialog === 'in' && (
        <StockInForm
          initial={picks.map((r) => ({ variantId: r.variantId, title: nameOfRow(r), sku: r.sku, priceVnd: r.priceVnd }))}
          onClose={() => setDialog(null)}
          onPosted={() => {
            setSelected(new Map());
            refresh();
          }}
        />
      )}
      {dialog === 'search' && <StockInForm onClose={() => setDialog(null)} onPosted={refresh} />}
      {dialog === 'adjust' && (
        <BulkAdjustDialog
          picks={picks.map((r) => ({ variantId: r.variantId, title: nameOfRow(r), sku: r.sku }))}
          onClose={() => setDialog(null)}
          onDone={() => {
            setSelected(new Map());
            refresh();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Stock page of one product (Design §12.1)

interface Movement {
  id: string;
  location: string;
  type: string;
  qtyDelta: number;
  unitCostVnd?: number | null;
  refType: string;
  refDocNo: string | null;
  supplierName: string | null;
  at: string;
  note: string | null;
}
interface ItemStock {
  id: string;
  i18n: { en: { title: string }; vi?: { title?: string } };
  authors: string[];
  variants: { id: string; sku: string; priceVnd: number; minStock: number | null; avgCostVnd?: number; stock: { onHand: number; reserved: number; available: number; byLocation: { location: string; onHand: number; reserved: number }[] } }[];
}

export function StockItemPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data: me } = useMe();
  const item = useQuery({ queryKey: ['item', id], queryFn: () => get<ItemStock>(`/api/v1/catalog/items/${id}`) });
  const [type, setType] = useState('');
  const [pages, setPages] = useState<string[]>(['']);
  const [dialog, setDialog] = useState<null | 'in' | 'adjust'>(null);
  const v = item.data?.variants.find((x) => x.id === params.get('v')) ?? item.data?.variants[0];
  const cursor = pages[pages.length - 1];
  const moves = useQuery({
    queryKey: ['movements', v?.id, type, cursor],
    enabled: !!v,
    queryFn: () => get<{ items: Movement[]; nextCursor: string | null }>('/api/v1/inventory/movements', { variant: v!.id, type: type || undefined, cursor: cursor || undefined }),
  });
  if (item.isError) return <ErrorState error={item.error} onRetry={() => item.refetch()} />;
  if (!item.data || !v) return <Skeleton className="h-64" />;
  const title = item.data.i18n.vi?.title || item.data.i18n.en.title;
  const refresh = () => {
    void item.refetch();
    setPages(['']);
    void moves.refetch();
  };

  const columns: Column<Movement>[] = [
    { header: 'Thời gian', className: 'whitespace-nowrap', cell: (m) => formatDateTime(m.at) },
    { header: 'Loại', cell: (m) => MOVEMENT_LABEL[m.type] ?? m.type },
    { header: 'Chứng từ', cell: (m) => (m.refDocNo ? <span className="code">{m.refDocNo}</span> : '—') },
    { header: 'Nhà cung cấp', cell: (m) => m.supplierName ?? '—' },
    { header: 'Số lượng', align: 'right', cell: (m) => <span className={m.qtyDelta < 0 ? 'text-danger-700' : 'text-success-700'}>{m.qtyDelta > 0 ? '+' : ''}{formatNumber(m.qtyDelta)}</span> },
    { header: 'Ghi chú', cell: (m) => m.note ?? '' },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/stock" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Tồn kho
          </Link>
        }
        title={title}
        actions={
          <>
            {can(me, 'inventory.adjust') && (
              <Button variant="secondary" icon={SlidersHorizontal} onClick={() => setDialog('adjust')}>
                Điều chỉnh tồn
              </Button>
            )}
            {can(me, 'purchasing.manage') && (
              <Button variant="primary" icon={PackagePlus} onClick={() => setDialog('in')}>
                Nhập thêm hàng
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-3">
          <SelectField label="Loại giao dịch" className="max-w-xs" value={type} onChange={(e) => (setType(e.target.value), setPages(['']))}>
            <option value="">Tất cả</option>
            {Object.entries(MOVEMENT_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </SelectField>
          <DataTable columns={columns} rows={moves.data?.items} rowKey={(m) => m.id} error={moves.error} minWidth={720} empty={{ icon: Boxes, title: 'Chưa có giao dịch' }} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={pages.length <= 1} onClick={() => setPages(pages.slice(0, -1))}>
              ‹ Mới hơn
            </Button>
            <Button size="sm" variant="ghost" disabled={!moves.data?.nextCursor} onClick={() => setPages([...pages, moves.data!.nextCursor!])}>
              Cũ hơn ›
            </Button>
          </div>
        </div>
        <Card title="Tồn kho">
          <p className="mb-3 code text-[13px] text-ink-500">{v.sku}</p>
          <Facts
            items={[
              ['Tồn', <span className="font-semibold num">{formatNumber(v.stock.onHand)}</span>],
              ['Đang giữ', <span className="num">{formatNumber(v.stock.reserved)}</span>],
              ['Có thể bán', <span className={clsx('font-semibold num', v.stock.available <= 0 && 'text-danger-700')}>{formatNumber(v.stock.available)}</span>],
              ['Tối thiểu', v.minStock == null ? '—' : formatNumber(v.minStock)],
              ...(v.avgCostVnd !== undefined ? ([['Giá vốn bình quân', <span className="num">{formatVnd(v.avgCostVnd)}</span>]] as [string, React.ReactNode][]) : []),
              ['Tình trạng', <StockState available={v.stock.available} minStock={v.minStock} />],
            ]}
          />
          <Link to={`/products/${item.data.id}`} className="mt-4 inline-block text-sm text-navy-700 underline-offset-2 hover:underline">
            Xem trang sản phẩm
          </Link>
        </Card>
      </div>
      {dialog === 'in' && <StockInForm initial={[{ variantId: v.id, title, sku: v.sku, priceVnd: v.priceVnd }]} onClose={() => setDialog(null)} onPosted={refresh} />}
      {dialog === 'adjust' && <BulkAdjustDialog picks={[{ variantId: v.id, title, sku: v.sku }]} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Adjust one or several products (FR-INV-07): quantity and reason per product, one stock location;
// supervisor PIN per line over the threshold.

function BulkAdjustDialog({ picks, onClose, onDone }: { picks: AdjustPick[]; onClose: () => void; onDone: () => void }) {
  const [lines, setLines] = useState<Record<string, { delta: string; reason: string }>>({});
  const [note, setNote] = useState('');
  const [writeOff, setWriteOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  // The line waiting for a supervisor PIN, and the lines still to post after it.
  const [approval, setApproval] = useState<{ pick: AdjustPick; rest: AdjustPick[] } | null>(null);
  const reasons = useQuery({ queryKey: ['master', 'reason_code'], queryFn: () => get<{ items: { code: string; i18n: unknown }[] }>('/api/v1/admin/master-data/reason_code') });
  const label = (i18n: unknown, code: string) => {
    const x = i18n as { vi?: { name?: string } | string; en?: { name?: string } | string };
    const vi = typeof x.vi === 'string' ? x.vi : x.vi?.name;
    const en = typeof x.en === 'string' ? x.en : x.en?.name;
    return vi || en || code;
  };
  const line = (id: string) => lines[id] ?? { delta: '', reason: '' };
  const set = (id: string, patch: Partial<{ delta: string; reason: string }>) => setLines({ ...lines, [id]: { ...line(id), ...patch } });
  const qty = (id: string) => Number(line(id).delta.replace(/[^\d-]/g, '')) || 0;
  const todo = picks.filter((p) => qty(p.variantId) !== 0 && !done.has(p.variantId));
  const missingReason = todo.some((p) => !line(p.variantId).reason);

  const runFrom = async (queue: AdjustPick[], token?: string) => {
    setBusy(true);
    setError(null);
    const ok = new Set(done);
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i]!;
      try {
        await post('/api/v1/inventory/adjustments', { variantId: p.variantId, qtyDelta: qty(p.variantId), reasonCode: line(p.variantId).reason, ...(note.trim() && { note: note.trim() }), writeOff, ...(i === 0 && token && { approvalToken: token }) });
        ok.add(p.variantId);
        setDone(new Set(ok));
      } catch (e) {
        setBusy(false);
        if (e instanceof ApiError && e.code === 'approval_required') return setApproval({ pick: p, rest: queue.slice(i + 1) });
        return setError(`${p.sku}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    toast.success(`Đã ghi điều chỉnh cho ${formatNumber(ok.size)} sản phẩm.`);
    onDone();
    onClose();
  };

  if (approval) {
    const n = qty(approval.pick.variantId);
    return (
      <ApprovalPrompt
        action="stock_adjustment"
        subject={approval.pick.variantId}
        reason={`Điều chỉnh ${n > 0 ? '+' : ''}${n} ${approval.pick.title} vượt hạn mức, cần quản lý duyệt.`}
        onClose={() => setApproval(null)}
        onToken={(tk) => {
          const queue = [approval.pick, ...approval.rest];
          setApproval(null);
          void runFrom(queue, tk);
        }}
      />
    );
  }

  return (
    <Dialog
      title="Điều chỉnh tồn"
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!todo.length || missingReason} onClick={() => void runFrom(todo)}>
            Lưu điều chỉnh
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="max-h-80 divide-y divide-paper-300 overflow-y-auto rounded-lg border border-paper-300">
          {picks.map((p) => (
            <li key={p.variantId} className="flex flex-col gap-2 px-3 py-3">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.title}</span>
                  <span className="code text-[13px] text-ink-500">{p.sku}</span>
                </span>
                {done.has(p.variantId) && <StatusChip tone="success">Đã ghi</StatusChip>}
              </div>
              {!done.has(p.variantId) && (
                <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2">
                  <input
                    className="h-10 rounded-md border border-paper-500 text-center text-sm num"
                    inputMode="numeric"
                    placeholder="+/−"
                    aria-label={`Số lượng điều chỉnh ${p.sku}`}
                    value={line(p.variantId).delta}
                    onChange={(e) => set(p.variantId, { delta: e.target.value.replace(/[^\d-]/g, '') })}
                  />
                  <select
                    className={clsx('h-10 rounded-md border bg-white px-3 text-sm', qty(p.variantId) !== 0 && !line(p.variantId).reason ? 'border-danger-700' : 'border-paper-500')}
                    aria-label={`Lý do ${p.sku}`}
                    value={line(p.variantId).reason}
                    onChange={(e) => set(p.variantId, { reason: e.target.value })}
                  >
                    <option value="">— Lý do —</option>
                    {(reasons.data?.items ?? []).map((r) => (
                      <option key={r.code} value={r.code}>
                        {label(r.i18n, r.code)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </li>
          ))}
        </ul>
        <TextArea label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-[18px] accent-navy-700" checked={writeOff} onChange={(e) => setWriteOff(e.target.checked)} /> Ghi nhận hủy hàng (hàng hỏng, mất)
        </label>
        <p className="text-[13px] text-ink-500">Nhập số dương để cộng, số âm để trừ, và chọn lý do cho từng sản phẩm. Dòng vượt hạn mức sẽ cần quản lý duyệt.</p>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}
