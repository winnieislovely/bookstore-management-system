import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileInput, Lightbulb, PackageCheck, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog, DataTable, Facts, FilterMenu, SelectField, TextArea, toast, useListParam, type Column } from '../components/data';
import { hitTitle, ProductSearch } from '../components/product-search';
import { Button, Card, ErrorState, Field, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { get, post } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, formatVnd } from '../lib/format';
import { Dialog } from '../pos/widgets';
import { useSuppliers } from './stockin';

/** Supplier orders and reorder suggestions (FR-PUR-07, FR-PUR-08, Design §11.2 Supplier order). */

const STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Nháp' },
  sent: { tone: 'info', label: 'Đã gửi' },
  partially_received: { tone: 'warning', label: 'Nhận một phần' },
  received: { tone: 'success', label: 'Đã nhận đủ' },
  closed: { tone: 'success', label: 'Đã đóng' },
  cancelled: { tone: 'neutral', label: 'Đã hủy' },
};
const Chip = ({ status }: { status: string }) => <StatusChip tone={STATUS[status]?.tone ?? 'neutral'}>{STATUS[status]?.label ?? status}</StatusChip>;

interface OrderRow {
  id: string;
  docNo: string;
  supplierName: string;
  status: string;
  expectedAt: string | null;
  createdAt: string;
  lines: number;
  outstanding: number;
}

interface Draft {
  supplierId: string;
  lines: { variantId: string; title: string; sku: string; qty: number; unitCostVnd?: number }[];
}

export function SupplierOrdersPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useListParam('status');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [suggest, setSuggest] = useState(false);
  const list = useQuery({ queryKey: ['supplier-orders', status], queryFn: () => get<{ items: OrderRow[] }>('/api/v1/purchasing/orders', { status: status.join(',') || undefined }) });
  const columns: Column<OrderRow>[] = [
    { header: 'Số đơn', cell: (r) => <span className="code">{r.docNo}</span> },
    { header: 'Nhà cung cấp', cell: (r) => r.supplierName },
    { header: 'Ngày tạo', className: 'whitespace-nowrap', cell: (r) => formatDate(r.createdAt) },
    { header: 'Dự kiến về', cell: (r) => (r.expectedAt ? formatDate(r.expectedAt) : '—') },
    { header: 'Dòng', align: 'right', cell: (r) => formatNumber(r.lines) },
    { header: 'Còn chờ', align: 'right', cell: (r) => formatNumber(r.outstanding) },
    { header: 'Trạng thái', cell: (r) => <Chip status={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Đặt hàng NCC"
        actions={
          <>
            <Button variant="secondary" icon={Lightbulb} onClick={() => setSuggest(true)}>
              Gợi ý đặt hàng
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setDraft({ supplierId: '', lines: [] })}>
              Tạo đơn đặt
            </Button>
          </>
        }
      />
      <div className="mb-4">
        <FilterMenu groups={[{ label: 'Trạng thái', options: Object.entries(STATUS).map(([key, v]) => ({ key, label: v.label })), values: status, onChange: setStatus }]} />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        onRow={(r) => navigate(`/supplier-orders/${r.id}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={{ icon: FileInput, title: 'Chưa có đơn đặt hàng', help: 'Đơn đặt NCC là tùy chọn; có thể nhập hàng trực tiếp mà không cần đơn.' }}
      />
      {suggest && (
        <Suggestions
          onClose={() => setSuggest(false)}
          onUse={(d) => {
            setSuggest(false);
            setDraft(d);
          }}
        />
      )}
      {draft && <OrderForm initial={draft} onClose={() => setDraft(null)} onCreated={(id) => navigate(`/supplier-orders/${id}`)} />}
    </>
  );
}

interface SuggestionGroup {
  supplierId: string | null;
  supplierName: string | null;
  lines: { variantId: string; sku: string; title: string; soldInPeriod: number; dailyVelocity: number; available: number; onOrder: number; minStock: number | null; suggestedQty: number; lastCostVnd?: number | null }[];
}

function Suggestions({ onClose, onUse }: { onClose: () => void; onUse: (d: Draft) => void }) {
  const s = useQuery({ queryKey: ['suggestions'], queryFn: () => get<{ velocityDays: number; coverDays: number; suppliers: SuggestionGroup[] }>('/api/v1/purchasing/suggestions') });
  return (
    <Dialog title="Gợi ý đặt hàng" size="lg" onClose={onClose}>
      {!s.data ? (
        <Skeleton className="h-40" />
      ) : s.data.suppliers.length === 0 ? (
        <p className="text-ink-500">Không có sản phẩm nào cần đặt thêm.</p>
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-ink-500">
            Theo tốc độ bán {s.data.velocityDays} ngày qua, đủ hàng cho {s.data.coverDays} ngày tới, trừ tồn và hàng đang đặt.
          </p>
          {s.data.suppliers.map((g) => (
            <Card
              key={g.supplierId ?? 'none'}
              title={g.supplierName ?? 'Chưa rõ nhà cung cấp'}
              action={
                g.supplierId && (
                  <Button size="sm" variant="tonal" onClick={() => onUse({ supplierId: g.supplierId!, lines: g.lines.map((l) => ({ variantId: l.variantId, title: l.title, sku: l.sku, qty: l.suggestedQty, ...(l.lastCostVnd && { unitCostVnd: l.lastCostVnd }) })) })}>
                    Tạo đơn từ gợi ý
                  </Button>
                )
              }
            >
              <table className="w-full text-sm">
                <thead className="text-[13px] text-ink-500">
                  <tr>
                    <th className="text-left font-semibold">Sản phẩm</th>
                    <th className="text-right font-semibold">Bán/ngày</th>
                    <th className="text-right font-semibold">Tồn</th>
                    <th className="text-right font-semibold">Đang đặt</th>
                    <th className="text-right font-semibold">Gợi ý</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-300">
                  {g.lines.map((l) => (
                    <tr key={l.variantId}>
                      <td className="py-2">
                        {l.title} <span className="code text-[13px] text-ink-500">{l.sku}</span>
                      </td>
                      <td className="text-right num">{l.dailyVelocity}</td>
                      <td className="text-right num">{formatNumber(l.available)}</td>
                      <td className="text-right num">{formatNumber(l.onOrder)}</td>
                      <td className="text-right font-semibold num">{formatNumber(l.suggestedQty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function OrderForm({ initial, onClose, onCreated }: { initial: Draft; onClose: () => void; onCreated: (id: string) => void }) {
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState(initial.supplierId);
  const [lines, setLines] = useState(initial.lines);
  const [expectedAt, setExpectedAt] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ id: string }>('/api/v1/purchasing/orders', {
        supplierId,
        ...(expectedAt && { expectedAt: new Date(expectedAt).toISOString() }),
        ...(note.trim() && { note: note.trim() }),
        lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, ...(l.unitCostVnd && { unitCostVnd: l.unitCostVnd }) })),
      });
      toast.success('Đã tạo đơn đặt nháp.');
      onCreated(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Đơn đặt hàng NCC"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!supplierId || !lines.length} onClick={save}>
            Lưu nháp
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Nhà cung cấp" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— Chọn —</option>
            {suppliers.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <Field label="Dự kiến về" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
        </div>
        <ProductSearch onPick={(h) => setLines((ls) => (ls.some((l) => l.variantId === h.variantId) ? ls : [...ls, { variantId: h.variantId, title: hitTitle(h), sku: h.sku, qty: 1 }]))} />
        <ul className="divide-y divide-paper-300">
          {lines.map((l, i) => (
            <li key={l.variantId} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                {l.title} <span className="code text-[13px] text-ink-500">{l.sku}</span>
              </span>
              <Field label="SL" className="w-24" inputMode="numeric" value={String(l.qty)} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value.replace(/\D/g, '')) || 1 } : x)))} />
              <Field label="Giá nhập dự kiến" className="w-40" suffix="₫" inputMode="numeric" value={l.unitCostVnd ? formatNumber(l.unitCostVnd) : ''} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCostVnd: Number(e.target.value.replace(/\D/g, '')) || undefined } : x)) as Draft['lines'])} />
              <button type="button" className="mt-5 inline-flex size-10 items-center justify-center rounded-full hover:bg-danger-50" aria-label="Bỏ dòng" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                <Trash2 size={18} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <TextArea label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

interface Order {
  id: string;
  docNo: string;
  supplierId: string;
  supplierName: string;
  status: string;
  expectedAt: string | null;
  note: string | null;
  createdAt: string;
  lines: { id: string; variantId: string; sku: string; title: string; qty: number; receivedQty: number; unitCostVnd: number | null }[];
}

export function SupplierOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const o = useQuery({ queryKey: ['supplier-order', id], queryFn: () => get<Order>(`/api/v1/purchasing/orders/${id}`) });
  const [action, setAction] = useState<null | 'send' | 'cancel' | 'close'>(null);
  if (o.isError) return <ErrorState error={o.error} onRetry={() => o.refetch()} />;
  if (!o.data) return <Skeleton className="h-64" />;
  const x = o.data;
  const receivable = x.status === 'sent' || x.status === 'partially_received';
  const total = x.lines.reduce((a, l) => a + (l.unitCostVnd ?? 0) * l.qty, 0);
  const texts = {
    send: { title: `Gửi đơn ${x.docNo}?`, body: 'Đánh dấu đơn đã gửi cho nhà cung cấp. Sau đó có thể nhận hàng theo đơn.', confirm: 'Gửi đơn' },
    cancel: { title: `Hủy đơn ${x.docNo}?`, body: 'Đơn sẽ không được nhận hàng nữa.', confirm: 'Hủy đơn' },
    close: { title: `Đóng đơn ${x.docNo}?`, body: 'Phần chưa về sẽ không chờ nữa.', confirm: 'Đóng đơn' },
  };
  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/supplier-orders" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Đặt hàng NCC
          </Link>
        }
        title={x.docNo}
        actions={
          <>
            {x.status === 'draft' && (
              <Button variant="primary" icon={Send} onClick={() => setAction('send')}>
                Gửi đơn
              </Button>
            )}
            {receivable && (
              <Button variant="primary" icon={PackageCheck} onClick={() => navigate(`/stock-in?order=${x.id}`)}>
                Nhận hàng
              </Button>
            )}
            {x.status === 'partially_received' && (
              <Button variant="secondary" onClick={() => setAction('close')}>
                Đóng đơn
              </Button>
            )}
            {(x.status === 'draft' || x.status === 'sent') && (
              <Button variant="destructive-outline" icon={XCircle} onClick={() => setAction('cancel')}>
                Hủy đơn
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Chip status={x.status} />
        <span className="text-sm text-ink-500">{formatDateTime(x.createdAt)}</span>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="Sản phẩm">
          <table className="w-full text-sm">
            <thead className="text-[13px] text-ink-500">
              <tr className="h-9 border-b border-paper-300">
                <th className="text-left font-semibold">Sản phẩm</th>
                <th className="text-right font-semibold">Đặt</th>
                <th className="text-right font-semibold">Đã về</th>
                <th className="text-right font-semibold">Giá nhập</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-300">
              {x.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-2">
                    {l.title} <span className="code block text-[13px] text-ink-500">{l.sku}</span>
                  </td>
                  <td className="text-right num">{formatNumber(l.qty)}</td>
                  <td className={l.receivedQty >= l.qty ? 'text-right text-success-700 num' : 'text-right num'}>{formatNumber(l.receivedQty)}</td>
                  <td className="text-right num">{l.unitCostVnd ? formatVnd(l.unitCostVnd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Thông tin">
          <Facts items={[['Nhà cung cấp', x.supplierName], ['Dự kiến về', x.expectedAt ? formatDate(x.expectedAt) : '—'], ['Giá trị dự kiến', total ? <span className="num">{formatVnd(total)}</span> : '—'], ['Ghi chú', x.note]]} />
        </Card>
      </div>
      {action && (
        <ConfirmDialog
          {...texts[action]}
          destructive={action === 'cancel'}
          onClose={() => setAction(null)}
          onConfirm={async () => {
            await post(`/api/v1/purchasing/orders/${x.id}/${action}`);
            toast.success('Đã cập nhật đơn đặt.');
            await o.refetch();
          }}
        />
      )}
    </>
  );
}
