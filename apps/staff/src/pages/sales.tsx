import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, ArrowLeft, Clock, FileCheck, FileText, MoreHorizontal, Printer, Receipt, RotateCcw, Send, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApprovalPrompt, DataTable, Facts, FilterMenu, Pager, SearchBox, SelectField, TextArea, TimeFilter, timeLabel, timeRange, toast, useListParam, useParam, type Column } from '../components/data';
import { Button, Card, ErrorState, Field, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { ApiError, get, post } from '../lib/api';
import { formatDateTime, formatNumber, formatPhone, formatVnd } from '../lib/format';
import { printSlip } from '../lib/print';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';

/** Sales list and record (FR-POS-12..17, Design §12.1, §12.3, §11.2 E-invoice). */

export const METHOD_LABEL: Record<string, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' };

const EINVOICE: Record<string, { tone: Tone; label: string; icon?: typeof Clock }> = {
  pending: { tone: 'neutral', label: 'Chờ xuất', icon: Clock },
  sent: { tone: 'info', label: 'Đã gửi', icon: Send },
  issued: { tone: 'success', label: 'Đã xuất', icon: FileCheck },
  failed: { tone: 'danger', label: 'Lỗi', icon: AlertOctagon },
  cancelled: { tone: 'neutral', label: 'Đã hủy' },
  adjusted: { tone: 'neutral', label: 'Điều chỉnh' },
};

export function EinvoiceChip({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const e = EINVOICE[status] ?? { tone: 'neutral' as Tone, label: status };
  return (
    <StatusChip tone={e.tone} icon={e.icon}>
      {e.label}
    </StatusChip>
  );
}

function SaleStatus({ status }: { status: string }) {
  return status === 'voided' ? <StatusChip tone="neutral" icon={XCircle}>Đã hủy</StatusChip> : <StatusChip tone="success">Hoàn tất</StatusChip>;
}

interface SaleRow {
  id: string;
  docNo: string;
  soldAt: string;
  totalVnd: number;
  status: string;
  cashier: string;
  customerName: string | null;
  customerPhone: string | null;
  methods: string[] | null;
  einvoiceStatus: string | null;
}

export function SalesPage() {
  const navigate = useNavigate();
  const [q, setQ] = useParam('q');
  const [status, setStatus] = useListParam('status');
  const [method, setMethod] = useListParam('method');
  const [time, setTime] = useParam('time');
  const [page, setPage] = useParam('page', '1');
  const range = timeRange(time);
  const query = { q: q || undefined, status: status.join(',') || undefined, method: method.join(',') || undefined, ...range, page: Number(page), limit: 40 };
  const list = useQuery({ queryKey: ['sales', query], queryFn: () => get<{ items: SaleRow[] }>('/api/v1/pos/sales', query) });

  const columns: Column<SaleRow>[] = [
    { header: 'Mã đơn', cell: (r) => <span className="code">{r.docNo}</span> },
    { header: 'Thời gian', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.soldAt) },
    { header: 'Khách hàng', cell: (r) => (r.customerName ? <span>{r.customerName}<span className="block text-[13px] text-ink-500">{r.customerPhone && formatPhone(r.customerPhone)}</span></span> : <span className="text-ink-500">Khách lẻ</span>) },
    { header: 'Thu ngân', cell: (r) => r.cashier },
    { header: 'Thanh toán', cell: (r) => (r.methods ?? []).map((m) => METHOD_LABEL[m] ?? m).join(', ') },
    { header: 'Tổng tiền', align: 'right', cell: (r) => formatVnd(r.totalVnd) },
    // Sale status only; the e-invoice state is on the sale record (Design §12.1).
    { header: 'Trạng thái', cell: (r) => <SaleStatus status={r.status} /> },
  ];

  return (
    <>
      <PageHeader title="Đơn bán" />
      <div className="mb-4 flex items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm mã đơn, khách hàng, SĐT, SKU…" />
        <FilterMenu
          groups={[
            { kind: 'custom', label: 'Thời gian', summary: timeLabel(time), active: !!time, onClear: () => setTime(''), content: <TimeFilter value={time} onChange={setTime} /> },
            { label: 'Trạng thái', options: [{ key: 'completed', label: 'Hoàn tất' }, { key: 'voided', label: 'Đã hủy' }], values: status, onChange: setStatus },
            { label: 'Thanh toán', options: [{ key: 'cash', label: 'Tiền mặt' }, { key: 'transfer', label: 'Chuyển khoản' }, { key: 'card', label: 'Thẻ' }], values: method, onChange: setMethod },
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        onRow={(r) => navigate(`/sales/${r.id}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={{ icon: Receipt, title: q || status.length || method.length || time ? 'Không có đơn phù hợp' : 'Chưa có đơn bán nào', help: 'Đơn bán tại quầy sẽ hiện ở đây.' }}
      />
      <Pager page={Number(page)} hasMore={(list.data?.items.length ?? 0) === 40} onPage={(p) => setPage(String(p))} />
    </>
  );
}

// =============================================================================================
// Sale record

interface SaleLine {
  id: string;
  lineNo: number;
  description: string;
  sku: string | null;
  qty: number;
  unitPriceVnd: number;
  discountVnd: number;
  totalVnd: number;
  vatBp: number;
  returnedQty: number;
  priceOverridden: boolean;
  costVnd?: number;
}
interface Sale {
  id: string;
  docNo: string;
  status: string;
  soldAt: string;
  offline: boolean;
  subtotalVnd: number;
  discountVnd: number;
  pointsRedeemed: number;
  pointsDiscountVnd: number;
  pointsEarned: number;
  totalVnd: number;
  vatVnd: number;
  customerId: string | null;
  couponCode: string | null;
  note: string | null;
  lines: SaleLine[];
  payments: { id: string; method: string; amountVnd: number; tenderedVnd: number | null; ref: string | null; verified: boolean }[];
  returns: { id: string; docNo: string; refundMethod: string; refundVnd: number; reason: string | null; createdAt: string }[];
  einvoice: { status: string; invoiceNo: string | null; emailRequested: boolean; emailStatus: string | null; error: string | null; buyerName: string | null } | null;
}

/** An open shift of the current user, needed to pay out a refund (FR-POS-13/14). */
function useOpenShift() {
  return useQuery({
    queryKey: ['open-shift'],
    queryFn: async () => {
      const regs = await get<{ items: { id: string; code: string }[] }>('/api/v1/pos/registers');
      for (const r of regs.items) {
        const s = await get<{ shift: { id: string; shiftNo: number } | null }>('/api/v1/pos/shifts/current', { register: r.id });
        if (s.shift) return { ...s.shift, registerCode: r.code };
      }
      return null;
    },
  });
}

export function SaleDetailPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const sale = useQuery({ queryKey: ['sale', id], queryFn: () => get<Sale>(`/api/v1/pos/sales/${id}`) });
  const shift = useOpenShift();
  const [dialog, setDialog] = useState<null | 'void' | 'return' | 'menu' | 'einvoice'>(null);
  const [retrying, setRetrying] = useState(false);

  if (sale.isError) return <ErrorState error={sale.error} onRetry={() => sale.refetch()} />;
  if (!sale.data) return <Skeleton className="h-64" />;
  const s = sale.data;
  const returnable = s.status === 'completed' && s.lines.some((l) => l.qty > l.returnedQty);
  const canPrint = can(me, 'sale.reprint');
  const canReturn = returnable && can(me, 'return.create');
  const canVoid = s.status === 'completed';
  const change = s.payments.reduce((a, p) => a + (p.method === 'cash' && p.tenderedVnd ? p.tenderedVnd - p.amountVnd : 0), 0);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/sales" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Đơn bán
          </Link>
        }
        title={s.docNo}
        // All sale actions live in the ⋯ menu on every screen size (Design §12.3).
        menu={(canPrint || canReturn || canVoid) && <Button variant="ghost" icon={MoreHorizontal} aria-label="Thao tác khác" onClick={() => setDialog('menu')} />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SaleStatus status={s.status} />
        <EinvoiceChip status={s.einvoice?.status} />
        {s.offline && <StatusChip tone="neutral">Bán ngoại tuyến</StatusChip>}
        {s.payments.some((p) => !p.verified) && <StatusChip tone="warning" icon={AlertOctagon}>Chưa xác minh chuyển khoản</StatusChip>}
        <span className="text-sm text-ink-500">{formatDateTime(s.soldAt)}</span>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <Card title="Sản phẩm">
            {/* Phones: stacked lines instead of the table (Design §12.3). */}
            <ul className="divide-y divide-paper-300 text-sm sm:hidden">
              {s.lines.map((l) => (
                <li key={l.id} className="py-2">
                  <p className="font-medium">{l.description}</p>
                  <p className="text-[13px] text-ink-500">
                    {l.sku && <span className="code">{l.sku}</span>}
                    {l.returnedQty > 0 && <span className="ml-2 text-warning-700">Đã trả {l.returnedQty}</span>}
                    {l.priceOverridden && <span className="ml-2">Đã sửa giá</span>}
                  </p>
                  <div className="mt-1 flex items-baseline justify-between gap-3">
                    <span className="text-ink-700 num">
                      {l.qty} × {formatVnd(l.unitPriceVnd)}
                      {l.discountVnd > 0 && <span className="ml-2 text-success-700">−{formatNumber(l.discountVnd)}</span>}
                    </span>
                    <span className="font-medium whitespace-nowrap num">{formatVnd(l.totalVnd)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="overflow-x-auto max-sm:hidden">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-[13px] text-ink-500">
                  <tr className="h-9 border-b border-paper-300">
                    <th className="text-left font-semibold">Sản phẩm</th>
                    <th className="text-right font-semibold">SL</th>
                    <th className="text-right font-semibold">Đơn giá</th>
                    <th className="text-right font-semibold">Giảm</th>
                    <th className="text-right font-semibold">Thành tiền</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-300">
                  {s.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2">
                        {l.description}
                        <span className="block text-[13px] text-ink-500">
                          {l.sku && <span className="code">{l.sku}</span>}
                          {l.returnedQty > 0 && <span className="ml-2 text-warning-700">Đã trả {l.returnedQty}</span>}
                          {l.priceOverridden && <span className="ml-2">Đã sửa giá</span>}
                        </span>
                      </td>
                      <td className="text-right num">{l.qty}</td>
                      <td className="text-right num">{formatVnd(l.unitPriceVnd)}</td>
                      <td className="text-right num">{l.discountVnd ? `−${formatNumber(l.discountVnd)}` : ''}</td>
                      <td className="text-right font-medium num">{formatVnd(l.totalVnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {s.returns.length > 0 && (
            <Card title="Đổi / trả">
              <ul className="divide-y divide-paper-300 text-sm">
                {s.returns.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      <span className="code">{r.docNo}</span> · {formatDateTime(r.createdAt)}
                      {r.reason && <span className="block text-ink-500">{r.reason}</span>}
                    </span>
                    <span className="text-right num">
                      {formatVnd(r.refundVnd)}
                      <span className="block text-[13px] text-ink-500">{METHOD_LABEL[r.refundMethod]}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Tổng cộng">
            <Facts
              items={[
                ['Tạm tính', <span className="num">{formatVnd(s.subtotalVnd)}</span>],
                ['Giảm giá', <span className="num">{s.discountVnd ? `−${formatVnd(s.discountVnd)}` : '0 ₫'}</span>],
                ...(s.pointsRedeemed ? ([['Đổi điểm', <span className="num">{formatNumber(s.pointsRedeemed)} điểm</span>]] as [string, React.ReactNode][]) : []),
                ...(s.couponCode ? ([['Mã giảm giá', <span className="code">{s.couponCode}</span>]] as [string, React.ReactNode][]) : []),
                ['Tổng', <span className="text-lg font-bold num">{formatVnd(s.totalVnd)}</span>],
                ['Trong đó VAT', <span className="num">{formatVnd(s.vatVnd)}</span>],
                ...(s.pointsEarned ? ([['Điểm cộng', <span className="num">+{formatNumber(s.pointsEarned)}</span>]] as [string, React.ReactNode][]) : []),
              ]}
            />
          </Card>
          <Card title="Thanh toán">
            <ul className="flex flex-col gap-2 text-sm">
              {s.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span>
                    {METHOD_LABEL[p.method] ?? p.method}
                    {p.ref && <span className="ml-2 code text-ink-500">{p.ref}</span>}
                  </span>
                  <span className="num">{formatVnd(p.amountVnd)}</span>
                </li>
              ))}
              {change > 0 && (
                <li className="flex justify-between text-ink-500">
                  <span>Tiền thừa</span>
                  <span className="num">{formatVnd(change)}</span>
                </li>
              )}
            </ul>
          </Card>
          {s.customerId && (
            <Card title="Khách hàng" action={<Link to={`/customers/${s.customerId}`} className="text-sm text-navy-700 underline">Xem hồ sơ</Link>}>
              <p className="text-sm text-ink-700">Đơn có gắn khách hàng.</p>
            </Card>
          )}
          {(s.status === 'completed' || s.einvoice) && (
            <Card title="Hóa đơn điện tử">
              <div className="flex flex-col gap-3 text-sm">
                <Facts
                  items={[
                    ['Trạng thái', s.einvoice ? <EinvoiceChip status={s.einvoice.status} /> : <span className="text-ink-500">Chưa xuất</span>],
                    ['Số hóa đơn', s.einvoice?.invoiceNo ? <span className="code">{s.einvoice.invoiceNo}</span> : '—'],
                    ['Người mua', s.einvoice?.buyerName ?? 'Khách lẻ'],
                    ['Gửi email', s.einvoice?.emailRequested ? (s.einvoice.emailStatus ?? 'Đang chờ') : 'Không'],
                  ]}
                />
                {/* Issue on request / add buyer details (FR-POS-15, FR-POS-16, Design §12.3). */}
                {s.status === 'completed' && can(me, 'sale.create') && (!s.einvoice || s.einvoice.status === 'pending') && (
                  <Button variant="primary" icon={FileText} onClick={() => setDialog('einvoice')}>
                    Xuất hóa đơn
                  </Button>
                )}
                {s.status === 'completed' && can(me, 'sale.create') && s.einvoice?.status === 'issued' && (
                  <Button variant="secondary" icon={Send} onClick={() => setDialog('einvoice')}>
                    Gửi lại cho khách
                  </Button>
                )}
                {s.einvoice?.status === 'failed' && (
                  <>
                    {s.einvoice.error && <InlineAlert tone="danger">{s.einvoice.error}</InlineAlert>}
                    {can(me, 'einvoice.manage') && (
                      <Button
                        variant="secondary"
                        loading={retrying}
                        onClick={async () => {
                          setRetrying(true);
                          try {
                            await post(`/api/v1/pos/sales/${s.id}/einvoice/retry`);
                            toast.success('Đã đưa hóa đơn vào hàng chờ xuất lại.');
                            await sale.refetch();
                          } catch (e) {
                            toast.error((e as Error).message);
                          } finally {
                            setRetrying(false);
                          }
                        }}
                      >
                        Thử lại
                      </Button>
                    )}
                  </>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {dialog === 'menu' && (
        <Dialog title="Thao tác" size="sm" onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-2">
            {canPrint && (
              <Button
                variant="secondary"
                full
                icon={Printer}
                onClick={() => {
                  setDialog(null);
                  printSlip(s.id).catch((e) => toast.error(e.message));
                }}
              >
                In lại phiếu
              </Button>
            )}
            {canReturn && (
              <Button variant="secondary" full icon={RotateCcw} onClick={() => setDialog('return')}>
                Đổi / trả hàng
              </Button>
            )}
            {canVoid && (
              <Button variant="destructive-outline" full icon={XCircle} onClick={() => setDialog('void')}>
                Hủy đơn
              </Button>
            )}
          </div>
        </Dialog>
      )}
      {dialog === 'void' && <VoidDialog sale={s} shift={shift.data ?? null} canVoid={can(me, 'sale.void_paid')} onClose={() => setDialog(null)} onDone={() => sale.refetch()} />}
      {dialog === 'return' && <ReturnDialog sale={s} shift={shift.data ?? null} onClose={() => setDialog(null)} onDone={() => sale.refetch()} />}
      {dialog === 'einvoice' && <EinvoiceRequestDialog saleId={s.id} reissue={s.einvoice?.status === 'issued'} onClose={() => setDialog(null)} onDone={() => sale.refetch()} />}
    </>
  );
}

function NeedShift() {
  return <InlineAlert tone="warning">Cần một ca đang mở để hoàn tiền. Hãy mở ca ở màn hình Bán hàng trước.</InlineAlert>;
}

function VoidDialog({ sale, shift, canVoid, onClose, onDone }: { sale: Sale; shift: { id: string } | null; canVoid: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [approve, setApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (approvalToken?: string) => {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/v1/pos/sales/${sale.id}/void`, { reason: reason.trim(), shiftId: shift!.id, ...(approvalToken && { approvalToken }) });
      toast.success(`Đã hủy đơn ${sale.docNo}.`);
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'approval_required') setApprove(true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (approve)
    return (
      <ApprovalPrompt
        action="void_sale"
        subject={sale.id}
        reason={`Hủy đơn ${sale.docNo} (${formatVnd(sale.totalVnd)}) cần quản lý duyệt.`}
        onClose={() => setApprove(false)}
        onToken={(tk) => {
          setApprove(false);
          void run(tk);
        }}
      />
    );
  return (
    <Dialog
      title={`Hủy đơn ${sale.docNo}?`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Không hủy
          </Button>
          <Button variant="destructive" loading={busy} disabled={!shift || !reason.trim()} onClick={() => (canVoid ? void run() : setApprove(true))}>
            Hủy đơn
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-ink-700">Hàng được nhập lại kho, điểm của khách được thu hồi và hóa đơn điện tử (nếu có) sẽ được hủy.</p>
        {!shift && <NeedShift />}
        <TextArea label="Lý do hủy" required value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

function ReturnDialog({ sale, shift, onClose, onDone }: { sale: Sale; shift: { id: string } | null; onClose: () => void; onDone: () => void }) {
  const open = sale.lines.filter((l) => l.qty > l.returnedQty);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [needApproval, setNeedApproval] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = open.filter((l) => (qty[l.id] ?? 0) > 0);
  // Refund estimate: the line total share per unit (the server computes the exact amount).
  const estimate = lines.reduce((a, l) => a + Math.round((l.totalVnd / l.qty) * (qty[l.id] ?? 0)), 0);

  const submit = async (approvalToken = token) => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ docNo: string; refundVnd: number }>(`/api/v1/pos/sales/${sale.id}/returns`, {
        shiftId: shift!.id,
        lines: lines.map((l) => ({ saleLineId: l.id, qty: qty[l.id]!, restock: restock[l.id] ?? true })),
        refundMethod: method,
        ...(reason.trim() && { reason: reason.trim() }),
        ...(approvalToken && { approvalToken }),
      });
      toast.success(`Đã tạo phiếu trả ${r.docNo}, hoàn ${formatVnd(r.refundVnd)}.`);
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'approval_required') setNeedApproval(e.message);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (needApproval)
    return (
      <ApprovalPrompt
        action="return_exception"
        subject={sale.id}
        reason={needApproval}
        onClose={() => setNeedApproval(null)}
        onToken={(tk) => {
          setToken(tk);
          setNeedApproval(null);
          void submit(tk);
        }}
      />
    );

  return (
    <Dialog
      title={`Đổi / trả – ${sale.docNo}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!lines.length || !shift} onClick={() => void submit()}>
            Xác nhận trả {lines.length ? `· ~${formatVnd(estimate)}` : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!shift && <NeedShift />}
        <ul className="divide-y divide-paper-300">
          {open.map((l) => {
            const max = l.qty - l.returnedQty;
            const v = qty[l.id] ?? 0;
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{l.description}</span>
                  <span className="text-[13px] text-ink-500 num">
                    Đã mua {l.qty} · còn trả được {max} · {formatVnd(l.unitPriceVnd)}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <button type="button" className="size-10 rounded-full border border-paper-500" aria-label="Giảm" onClick={() => setQty({ ...qty, [l.id]: Math.max(0, v - 1) })}>
                    –
                  </button>
                  <span className="w-8 text-center font-semibold num">{v}</span>
                  <button type="button" className="size-10 rounded-full border border-paper-500" aria-label="Tăng" onClick={() => setQty({ ...qty, [l.id]: Math.min(max, v + 1) })}>
                    +
                  </button>
                </span>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-5" checked={restock[l.id] ?? true} onChange={(e) => setRestock({ ...restock, [l.id]: e.target.checked })} />
                  Nhập lại kho
                </label>
              </li>
            );
          })}
        </ul>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Hoàn tiền bằng" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Tiền mặt</option>
            <option value="transfer">Chuyển khoản</option>
            <option value="card">Thẻ</option>
          </SelectField>
          <TextArea label="Lý do" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

// =============================================================================================
// E-invoice on request: buyer details, optional email (FR-POS-15, FR-POS-16, Design §12.3)

function EinvoiceRequestDialog({ saleId, reissue, onClose, onDone }: { saleId: string; reissue: boolean; onClose: () => void; onDone: () => void }) {
  const [buyer, setBuyer] = useState({ name: '', taxCode: '', address: '', email: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof buyer) => (e: React.ChangeEvent<HTMLInputElement>) => setBuyer({ ...buyer, [k]: e.target.value });
  const submit = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(buyer).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      await post(`/api/v1/pos/sales/${saleId}/einvoice-request`, body);
      toast.success(buyer.email.trim() ? 'Đã gửi yêu cầu xuất hóa đơn; hóa đơn sẽ được gửi tới email người mua.' : 'Đã gửi yêu cầu xuất hóa đơn.');
      onDone();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={reissue ? 'Gửi lại hóa đơn cho khách' : 'Xuất hóa đơn điện tử'}
      size="sm"
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Hủy
          </Button>
          <Button variant="primary" icon={FileText} loading={busy} disabled={!buyer.name.trim()} onClick={submit}>
            {reissue ? 'Gửi lại' : 'Xuất hóa đơn'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Tên người mua / đơn vị" required value={buyer.name} onChange={set('name')} />
        <Field label="Mã số thuế" value={buyer.taxCode} onChange={set('taxCode')} inputMode="numeric" />
        <Field label="Địa chỉ" value={buyer.address} onChange={set('address')} />
        <Field label="Email nhận hóa đơn" type="email" value={buyer.email} onChange={set('email')} helper="Để trống nếu khách không cần nhận qua email." />
      </div>
    </Dialog>
  );
}
