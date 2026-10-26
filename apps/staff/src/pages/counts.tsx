import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, CheckCircle2, ClipboardList, Plus, Send } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog, DataTable, SelectField, toast, type Column } from '../components/data';
import { hitTitle, ProductSearch } from '../components/product-search';
import { Button, Card, ErrorState, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { get, post } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';

/** Stock counts (FR-INV-06, Design §13.8): scan-first; blind mode hides expected quantities. */

const STATUS: Record<string, { tone: Tone; label: string }> = {
  open: { tone: 'info', label: 'Đang đếm' },
  submitted: { tone: 'warning', label: 'Chờ duyệt' },
  approved: { tone: 'success', label: 'Đã duyệt' },
  cancelled: { tone: 'neutral', label: 'Đã hủy' },
};
const Chip = ({ status }: { status: string }) => <StatusChip tone={STATUS[status]?.tone ?? 'neutral'}>{STATUS[status]?.label ?? status}</StatusChip>;

interface CountRow {
  id: string;
  docNo: string;
  scope: { kind: string };
  location: string;
  blind: boolean;
  status: string;
  createdAt: string;
  createdBy: string | null;
  lines: number;
  counted: number;
}
const SCOPE: Record<string, string> = { full: 'Toàn bộ', category: 'Theo danh mục', variants: 'Sản phẩm chọn' };

export function CountsPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['counts'], queryFn: () => get<{ items: CountRow[] }>('/api/v1/inventory/counts') });
  const columns: Column<CountRow>[] = [
    { header: 'Số phiếu', cell: (r) => <span className="code">{r.docNo}</span> },
    { header: 'Ngày', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.createdAt) },
    { header: 'Phạm vi', cell: (r) => `${SCOPE[r.scope.kind] ?? r.scope.kind} · ${r.location === 'back' ? 'Kho sau' : 'Quầy'}${r.blind ? ' · đếm mù' : ''}` },
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

function CreateCount({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [kind, setKind] = useState<'full' | 'category'>('full');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [location, setLocation] = useState('floor');
  const [blind, setBlind] = useState(true);
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => get<{ items: { id: string; i18n: { vi?: { name?: string }; en?: { name?: string } } }[] }>('/api/v1/catalog/categories'), enabled: kind === 'category' });
  return (
    <ConfirmDialog
      title="Tạo phiếu kiểm kho"
      confirm="Bắt đầu đếm"
      onClose={onClose}
      onConfirm={async () => {
        const r = await post<{ id: string }>('/api/v1/inventory/counts', { scope: kind === 'full' ? { kind } : { kind, categoryIds }, location, blind });
        onCreated(r.id);
      }}
    >
      <SelectField label="Phạm vi" value={kind} onChange={(e) => setKind(e.target.value as 'full')}>
        <option value="full">Toàn bộ sản phẩm</option>
        <option value="category">Theo danh mục</option>
      </SelectField>
      {kind === 'category' && (
        <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
          {categories.data?.items.map((c) => {
            const on = categoryIds.includes(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={on} onClick={() => setCategoryIds(on ? categoryIds.filter((x) => x !== c.id) : [...categoryIds, c.id])} className={clsx('h-8 rounded-full border px-3 text-sm', on ? 'border-navy-700 bg-navy-100 text-navy-700' : 'border-paper-500')}>
                {c.i18n.vi?.name || c.i18n.en?.name}
              </button>
            );
          })}
        </div>
      )}
      <SelectField label="Vị trí" value={location} onChange={(e) => setLocation(e.target.value)}>
        <option value="floor">Quầy</option>
        <option value="back">Kho sau</option>
      </SelectField>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
        Đếm mù (người đếm không thấy số tồn trên hệ thống)
      </label>
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

export function CountDetailPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const c = useQuery({ queryKey: ['count', id], queryFn: () => get<Omit<CountDetail, 'lines'> & { lines: CountLine[] }>(`/api/v1/inventory/counts/${id}`) });
  const [last, setLast] = useState<{ title: string; counted: number } | null>(null);
  const [setQty, setSetQty] = useState<CountLine | null>(null);
  const [confirm, setConfirm] = useState<null | 'submit' | 'approve'>(null);
  const [filter, setFilter] = useState<'all' | 'uncounted' | 'variance'>('all');

  if (c.isError) return <ErrorState error={c.error} onRetry={() => c.refetch()} />;
  if (!c.data) return <Skeleton className="h-64" />;
  const x = c.data;
  const open = x.status === 'open';
  const showExpected = x.lines.some((l) => l.expected !== undefined);
  const counted = x.lines.filter((l) => l.counted !== null).length;
  const rows = x.lines.filter((l) => (filter === 'uncounted' ? l.counted === null : filter === 'variance' ? !!l.variance : true));

  const record = async (variantId: string, qty: number, mode: 'add' | 'set', title?: string) => {
    try {
      const r = await post<{ counted: number }>(`/api/v1/inventory/counts/${x.id}/lines`, { variantId, qty, mode });
      const line = x.lines.find((l) => l.variantId === variantId);
      setLast({ title: title ?? line?.title ?? '', counted: r?.counted ?? qty });
      await c.refetch();
    } catch (e) {
      toast.error((e as Error).message);
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
        <Card className="mb-6">
          <div className="flex flex-col gap-4">
            <ProductSearch autoFocus onPick={(h) => void record(h.variantId, 1, 'add', hitTitle(h))} placeholder="Quét mã từng sản phẩm – mỗi lần quét +1" />
            {last && (
              <div className="flex items-center justify-between rounded-lg bg-sand-50 px-4 py-3" role="status">
                <span className="font-medium">{last.title}</span>
                <span className="text-[28px] leading-9 font-bold num whitespace-nowrap">{formatNumber(last.counted)}</span>
              </div>
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
          { header: 'Đếm được', align: 'right', cell: (l) => (l.counted === null ? <span className="text-ink-500">—</span> : formatNumber(l.counted)) },
          ...(showExpected
            ? [{ header: 'Chênh lệch', align: 'right' as const, cell: (l: CountLine) => (l.variance == null ? '' : <span className={l.variance < 0 ? 'text-danger-700' : l.variance > 0 ? 'text-warning-700' : 'text-success-700'}>{l.variance > 0 ? '+' : ''}{formatNumber(l.variance)}</span>) }]
            : []),
        ]}
        rows={rows}
        rowKey={(l) => l.variantId}
        onRow={open ? (l) => setSetQty(l) : undefined}
        minWidth={560}
        empty={{ icon: ClipboardList, title: 'Không có dòng phù hợp' }}
      />
      {setQty && <SetQtyDialog line={setQty} onClose={() => setSetQty(null)} onSave={(q) => record(setQty.variantId, q, 'set').then(() => setSetQty(null))} />}
      {confirm === 'submit' && (
        <ConfirmDialog
          title="Gửi phiếu kiểm để duyệt?"
          body={counted < x.lines.length ? `Còn ${x.lines.length - counted} sản phẩm chưa đếm; chúng sẽ được tính là 0 khi duyệt.` : 'Sau khi gửi, không quét thêm được.'}
          confirm="Gửi duyệt"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await post(`/api/v1/inventory/counts/${x.id}/submit`);
            toast.success('Đã gửi phiếu kiểm để duyệt.');
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

function SetQtyDialog({ line, onSave, onClose }: { line: CountLine; onSave: (q: number) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState(line.counted ?? 0);
  return (
    <Dialog
      title={hitTitle({ title: line.title, titleVi: null })}
      size="sm"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={() => void onSave(v)}>
          Lưu số đếm
        </Button>
      }
    >
      <div className="flex items-center justify-center gap-4">
        <button type="button" className="size-12 rounded-full border border-paper-500 text-xl" aria-label="Giảm" onClick={() => setV(Math.max(0, v - 1))}>
          –
        </button>
        <input className="h-14 w-28 rounded-md border border-paper-500 text-center text-[28px] font-bold num" inputMode="numeric" value={v} onChange={(e) => setV(Number(e.target.value.replace(/\D/g, '')) || 0)} aria-label="Số đếm được" />
        <button type="button" className="size-12 rounded-full border border-paper-500 text-xl" aria-label="Tăng" onClick={() => setV(v + 1)}>
          +
        </button>
      </div>
      <div className="mt-3">
        <InlineAlert tone="info">Nhập số đếm thực tế; giá trị này thay cho các lần quét trước.</InlineAlert>
      </div>
    </Dialog>
  );
}
