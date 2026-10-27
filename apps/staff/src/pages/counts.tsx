import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, CheckCircle2, ClipboardList, Download, Plus, Send, Upload, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog, DataTable, toast, type Column } from '../components/data';
import { Button, Card, ErrorState, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { ApiError, get, post } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { can, useMe } from '../lib/session';
import { categoryOptions, type Category } from './products';

/**
 * Stock counts (FR-INV-06, Design §13.8): scope by product type and category; counted quantities
 * typed on screen (up to 50 products) or via the Excel/CSV count sheet; no scanning; blind mode
 * hides expected quantities; cancellable until approved.
 */

const STATUS: Record<string, { tone: Tone; label: string }> = {
  open: { tone: 'info', label: 'Đang đếm' },
  submitted: { tone: 'warning', label: 'Chờ duyệt' },
  approved: { tone: 'success', label: 'Đã duyệt' },
  cancelled: { tone: 'neutral', label: 'Đã hủy' },
};
const Chip = ({ status }: { status: string }) => <StatusChip tone={STATUS[status]?.tone ?? 'neutral'}>{STATUS[status]?.label ?? status}</StatusChip>;

/** Counts above this many products are entered through the count sheet only (FR-INV-06). */
const SHEET_REQUIRED_ABOVE = 50;

const KINDS: [string, string][] = [
  ['book', 'Sách'],
  ['stationery', 'Văn phòng phẩm'],
  ['other', 'Sản phẩm khác'],
];
const KIND_LABEL = Object.fromEntries(KINDS) as Record<string, string>;

interface CountRow {
  id: string;
  docNo: string;
  scope: { kind: string; itemKinds?: string[]; categoryIds?: string[] };
  blind: boolean;
  status: string;
  createdAt: string;
  createdBy: string | null;
  lines: number;
  counted: number;
}
const SCOPE: Record<string, string> = { full: 'Toàn bộ', category: 'Theo danh mục', variants: 'Sản phẩm chọn' };
const scopeLabel = (s: CountRow['scope']) =>
  s.kind === 'types' ? `${(s.itemKinds ?? []).map((k) => KIND_LABEL[k] ?? k).join(', ')}${s.categoryIds?.length ? ' · theo danh mục' : ''}` : (SCOPE[s.kind] ?? s.kind);

export function CountsPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['counts'], queryFn: () => get<{ items: CountRow[] }>('/api/v1/inventory/counts') });
  const columns: Column<CountRow>[] = [
    { header: 'Số phiếu', cell: (r) => <span className="code">{r.docNo}</span> },
    { header: 'Ngày', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.createdAt) },
    { header: 'Phạm vi', cell: (r) => `${scopeLabel(r.scope)}${r.blind ? ' · đếm mù' : ''}` },
    { header: 'Người tạo', cell: (r) => r.createdBy ?? '—' },
    { header: 'Đã đếm', align: 'right', cell: (r) => `${formatNumber(r.counted)}/${formatNumber(r.lines)}` },
    { header: 'Trạng thái', cell: (r) => <Chip status={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Kiểm kho"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Tạo phiếu kiểm
          </Button>
        }
      />
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        onRow={(r) => navigate(`/counts/${r.id}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={{ icon: ClipboardList, title: 'Chưa có phiếu kiểm kho' }}
      />
      {creating && <CreateCount onClose={() => setCreating(false)} onCreated={(id) => navigate(`/counts/${id}`)} />}
    </>
  );
}

/** Scope = product types, optionally narrowed to categories holding those types (Design §13.8). */
function CreateCount({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [kinds, setKinds] = useState<string[]>(['book', 'stationery', 'other']);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [blind, setBlind] = useState(true);
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => get<{ items: Category[] }>('/api/v1/catalog/categories') });
  const options = categoryOptions(categories.data?.items ?? [], kinds);
  // Drop categories that no longer match the chosen types.
  useEffect(() => setCategoryIds((ids) => ids.filter((id) => options.some((o) => o.key === id))), [kinds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <ConfirmDialog
      title="Tạo phiếu kiểm kho"
      confirm="Bắt đầu đếm"
      onClose={onClose}
      onConfirm={async () => {
        if (!kinds.length) throw new Error('Chọn ít nhất một loại sản phẩm.');
        const r = await post<{ id: string }>('/api/v1/inventory/counts', { scope: { kind: 'types', itemKinds: kinds, ...(categoryIds.length && { categoryIds }) }, blind });
        onCreated(r.id);
      }}
    >
      <div className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-700">Loại sản phẩm</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {KINDS.map(([k, label]) => (
              <label key={k} className="inline-flex h-10 items-center gap-2 text-sm">
                <input type="checkbox" className="size-[18px] accent-navy-700" checked={kinds.includes(k)} onChange={() => setKinds(toggle(kinds, k))} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-700">Danh mục</legend>
          <p className="mb-2 text-[13px] text-ink-500">Để trống để kiểm mọi danh mục của các loại đã chọn.</p>
          {options.length ? (
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {options.map((c) => {
                const on = categoryIds.includes(c.key);
                return (
                  <button key={c.key} type="button" aria-pressed={on} onClick={() => setCategoryIds(toggle(categoryIds, c.key))} className={clsx('h-8 rounded-full border px-3 text-sm', on ? 'border-navy-700 bg-navy-100 text-navy-700' : 'border-paper-500')}>
                    {c.label.trim()}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-ink-500">Không có danh mục cho các loại đã chọn.</p>
          )}
        </fieldset>
        <label className="inline-flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-[18px] accent-navy-700" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
          <span>
            Đếm mù
            <span className="block text-[13px] text-ink-500">Người đếm không thấy số tồn trên hệ thống.</span>
          </span>
        </label>
      </div>
    </ConfirmDialog>
  );
}

interface CountDetail extends CountRow {
  lines: never;
  approvedAt: string | null;
}
interface CountLine {
  variantId: string;
  sku: string;
  title: string;
  counted: number | null;
  expected?: number;
  variance?: number | null;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function CountDetailPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const c = useQuery({ queryKey: ['count', id], queryFn: () => get<Omit<CountDetail, 'lines'> & { lines: CountLine[] }>(`/api/v1/inventory/counts/${id}`) });
  const [confirm, setConfirm] = useState<null | 'submit' | 'approve' | 'cancel'>(null);
  const [filter, setFilter] = useState<'all' | 'uncounted' | 'variance'>('all');
  const [uploading, setUploading] = useState(false);
  const [sheetResult, setSheetResult] = useState<{ tone: 'success' | 'danger'; text: string; rows?: { row: number; sku: string; message: string }[] } | null>(null);

  if (c.isError) return <ErrorState error={c.error} onRetry={() => c.refetch()} />;
  if (!c.data) return <Skeleton className="h-64" />;
  const x = c.data;
  const open = x.status === 'open';
  const sheetOnly = x.lines.length > SHEET_REQUIRED_ABOVE;
  const showExpected = x.lines.some((l) => l.expected !== undefined);
  const counted = x.lines.filter((l) => l.counted !== null).length;
  const rows = x.lines.filter((l) => (filter === 'uncounted' ? l.counted === null : filter === 'variance' ? !!l.variance : true));

  const setCount = async (line: CountLine, text: string) => {
    const qty = Number(text.replace(/\D/g, ''));
    if (text.trim() === '' || qty === line.counted) return;
    try {
      await post(`/api/v1/inventory/counts/${x.id}/lines`, { variantId: line.variantId, qty, mode: 'set' });
      await c.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const uploadSheet = async (file: File) => {
    setUploading(true);
    setSheetResult(null);
    const mime = file.name.toLowerCase().endsWith('.csv') ? 'text/csv' : XLSX;
    try {
      const res = await fetch(`/api/v1/inventory/counts/${x.id}/sheet`, { method: 'POST', credentials: 'same-origin', headers: { 'x-bms-request': '1', 'content-type': mime }, body: file });
      const body = (await res.json().catch(() => null)) as { updated?: number; counted?: number; error?: { code: string; message: string; details?: { rows?: { row: number; sku: string; message: string }[] } } } | null;
      if (!res.ok) {
        setSheetResult({ tone: 'danger', text: body?.error?.message ?? 'Không đọc được tệp.', ...(body?.error?.details?.rows && { rows: body.error.details.rows }) });
        return;
      }
      setSheetResult({ tone: 'success', text: `Đã cập nhật ${formatNumber(body?.updated ?? 0)} số đếm. Đã đếm ${formatNumber(body?.counted ?? 0)}/${formatNumber(x.lines.length)} sản phẩm.` });
      await c.refetch();
    } catch (e) {
      setSheetResult({ tone: 'danger', text: e instanceof ApiError ? e.message : 'Mất kết nối. Hãy thử lại.' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/counts" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Kiểm kho
          </Link>
        }
        title={x.docNo}
        actions={
          <>
            {(open || x.status === 'submitted') && (
              <Button variant="destructive-outline" icon={XCircle} onClick={() => setConfirm('cancel')}>
                Hủy phiếu
              </Button>
            )}
            {open && (
              <Button variant="primary" icon={Send} onClick={() => setConfirm('submit')}>
                Gửi duyệt
              </Button>
            )}
            {x.status === 'submitted' && can(me, 'inventory.count_approve') && (
              <Button variant="primary" icon={CheckCircle2} onClick={() => setConfirm('approve')}>
                Duyệt và ghi chênh lệch
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Chip status={x.status} />
        <span className="text-sm text-ink-700 num">
          Đã đếm {formatNumber(counted)}/{formatNumber(x.lines.length)}
        </span>
        <div className="h-2 w-48 overflow-hidden rounded-full bg-paper-200" aria-hidden>
          <div className="h-full bg-navy-700" style={{ width: `${x.lines.length ? (counted / x.lines.length) * 100 : 0}%` }} />
        </div>
        {x.blind && <StatusChip tone="neutral">Đếm mù</StatusChip>}
      </div>

      {open && (
        <Card title="Phiếu đếm" className="mb-6">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-700">
              {sheetOnly
                ? `Phiếu có ${formatNumber(x.lines.length)} sản phẩm (trên ${SHEET_REQUIRED_ABOVE}): tải phiếu đếm về, điền cột “Đếm được” rồi tải lên lại.`
                : 'Tải phiếu đếm về để đếm ngoài (in hoặc điền trên máy), rồi tải lên lại; hoặc nhập số đếm ngay trong bảng bên dưới.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex h-9 items-center gap-2 rounded-full border border-paper-500 px-4 text-sm font-medium hover:bg-navy-50" href={`/api/v1/inventory/counts/${x.id}/sheet?format=xlsx`}>
                <Download size={18} aria-hidden /> Tải phiếu đếm (Excel)
              </a>
              <a className="inline-flex h-9 items-center gap-2 rounded-full border border-paper-500 px-4 text-sm font-medium hover:bg-navy-50" href={`/api/v1/inventory/counts/${x.id}/sheet?format=csv`}>
                <Download size={18} aria-hidden /> CSV
              </a>
              <label className={clsx('inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-navy-700 px-4 text-sm font-medium text-white hover:bg-navy-800', uploading && 'opacity-60')}>
                <Upload size={18} aria-hidden /> {uploading ? 'Đang tải lên…' : 'Tải lên phiếu đã đếm'}
                <input
                  type="file"
                  accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void uploadSheet(f);
                  }}
                />
              </label>
            </div>
            {sheetResult && (
              <InlineAlert tone={sheetResult.tone}>
                {sheetResult.text}
                {sheetResult.rows && (
                  <ul className="mt-1 list-disc pl-5">
                    {sheetResult.rows.map((r) => (
                      <li key={r.row}>
                        Dòng {r.row} {r.sku && <span className="code">{r.sku}</span>}: {r.message}
                      </li>
                    ))}
                  </ul>
                )}
              </InlineAlert>
            )}
          </div>
        </Card>
      )}

      <div className="mb-3 flex gap-2">
        {(
          [
            ['all', 'Tất cả'],
            ['uncounted', 'Chưa đếm'],
            ...(showExpected ? [['variance', 'Có chênh lệch']] : []),
          ] as [typeof filter, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={clsx('h-8 rounded-full border px-3 text-sm', filter === k ? 'border-navy-700 bg-navy-100 text-navy-700' : 'border-paper-500 bg-white')}>
            {label}
          </button>
        ))}
      </div>
      <DataTable
        columns={[
          { header: 'SKU', cell: (l: CountLine) => <span className="code">{l.sku}</span> },
          { header: 'Sản phẩm', cell: (l) => l.title },
          ...(showExpected ? [{ header: 'Hệ thống', align: 'right' as const, cell: (l: CountLine) => formatNumber(l.expected ?? 0) }] : []),
          {
            header: 'Đếm được',
            align: 'right',
            cell: (l) =>
              // Typed on screen for counts of up to 50 products (FR-INV-06).
              open && !sheetOnly ? (
                <input
                  key={`${l.variantId}-${l.counted}`}
                  className="h-9 w-20 rounded-md border border-paper-500 text-right text-sm num px-2"
                  inputMode="numeric"
                  aria-label={`Số đếm ${l.sku}`}
                  defaultValue={l.counted ?? ''}
                  placeholder="—"
                  onBlur={(e) => void setCount(l, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : l.counted === null ? (
                <span className="text-ink-500">—</span>
              ) : (
                formatNumber(l.counted)
              ),
          },
          ...(showExpected
            ? [{ header: 'Chênh lệch', align: 'right' as const, cell: (l: CountLine) => (l.variance == null ? '' : <span className={l.variance < 0 ? 'text-danger-700' : l.variance > 0 ? 'text-warning-700' : 'text-success-700'}>{l.variance > 0 ? '+' : ''}{formatNumber(l.variance)}</span>) }]
            : []),
        ]}
        rows={rows}
        rowKey={(l) => l.variantId}
        minWidth={560}
        empty={{ icon: ClipboardList, title: 'Không có dòng phù hợp' }}
      />
      {confirm === 'submit' && (
        <ConfirmDialog
          title="Gửi phiếu kiểm để duyệt?"
          body={`Sau khi gửi, không thể thay đổi.${counted < x.lines.length ? ` Còn ${formatNumber(x.lines.length - counted)} sản phẩm chưa đếm; khi duyệt, các sản phẩm này giữ nguyên tồn.` : ''}`}
          confirm="Gửi duyệt"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await post(`/api/v1/inventory/counts/${x.id}/submit`);
            toast.success('Đã gửi phiếu kiểm để duyệt.');
            await c.refetch();
          }}
        />
      )}
      {confirm === 'cancel' && (
        <ConfirmDialog
          title={`Hủy phiếu ${x.docNo}?`}
          body="Số đếm trong phiếu sẽ không được ghi vào tồn kho. Không hoàn tác được."
          confirm="Hủy phiếu"
          destructive
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await post(`/api/v1/inventory/counts/${x.id}/cancel`);
            toast.success('Đã hủy phiếu kiểm.');
            await c.refetch();
          }}
        />
      )}
      {confirm === 'approve' && (
        <ConfirmDialog
          title="Duyệt phiếu kiểm?"
          body="Mọi chênh lệch sẽ được ghi vào tồn kho theo lý do Kiểm kho. Không hoàn tác được."
          confirm="Duyệt"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const r = await post<{ posted: number }>(`/api/v1/inventory/counts/${x.id}/approve`);
            toast.success(`Đã duyệt; ghi ${r.posted} dòng chênh lệch.`);
            await c.refetch();
          }}
        />
      )}
    </>
  );
}
