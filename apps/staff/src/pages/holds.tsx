import { CHANNEL_KINDS, normalizePaymentRef, ORDER_SOURCES, paymentRefFromBytes } from '@bookstore/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, CalendarClock, HandCoins, PackageCheck, PhoneCall, PhoneOff, Plus, RadioTower, Truck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ConfirmDialog, DataTable, FilterMenu, SearchBox, SelectField, Tabs, TextArea, toast, useListParam, useParam, type Column } from '../components/data';
import { Combobox, CopyCode, ORDER_SOURCE } from '../components/order-ui';
import { ProductSearch, hitTitle, type ProductHit } from '../components/product-search';
import { Button, EmptyState, ErrorState, Field, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, formatPhone, formatVnd } from '../lib/format';
import { Dialog, MoneyInput } from '../pos/widgets';
import { useOpenShift } from './sales';

/**
 * Pre-orders and special orders (“Đặt trước”, FR-ORD-14..16), the to-notify worklist (“Cần liên
 * hệ”, FR-ORD-18, Design §12.8), COD reconciliation (FR-ORD-11) and channel profiles (FR-SOC-01).
 */

const HOLD_STATUS: Record<string, { label: string; tone: Tone }> = {
  reserved: { label: 'Đã đặt', tone: 'neutral' },
  requested: { label: 'Đã yêu cầu', tone: 'neutral' },
  ordered: { label: 'Đã đặt NCC', tone: 'info' },
  arrived: { label: 'Đã về', tone: 'accent' },
  contacted: { label: 'Đã liên hệ', tone: 'info' },
  collected: { label: 'Đã nhận', tone: 'success' },
  cancelled: { label: 'Đã hủy', tone: 'neutral' },
};

interface Hold {
  id: string;
  docNo: string;
  status: string;
  createdAt: string;
  qty: number;
  depositVnd: number;
  contactedAt: string | null;
  expiresAt: string | null;
  orderId: string | null;
  customerName: string;
  customerPhone: string | null;
  // Pre-order
  unitPriceVnd?: number;
  sku?: string;
  title?: string;
  // Special order
  requestedTitle?: string;
  isbn?: string | null;
  quoteVnd?: number;
  variantId?: string | null;
}

function HoldChip({ h }: { h: Hold }) {
  const s = HOLD_STATUS[h.status] ?? { label: h.status, tone: 'neutral' as Tone };
  // Holding-period countdown, turning to a warning in the last 2 days (Design §11.2).
  if (h.status === 'contacted' && h.expiresAt) {
    const left = Math.ceil((new Date(h.expiresAt).getTime() - Date.now()) / 86_400_000);
    return <StatusChip tone={left <= 2 ? 'warning' : 'info'}>{left > 0 ? `Đã liên hệ · còn ${left} ngày` : 'Quá hạn giữ hàng'}</StatusChip>;
  }
  return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
}

type Kind = 'preorder' | 'special_order';
const BASE: Record<Kind, string> = { preorder: '/api/v1/preorders', special_order: '/api/v1/special-orders' };

export function HoldsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useParam('tab', 'preorder');
  const kind = (tab === 'special_order' ? 'special_order' : 'preorder') as Kind;
  const [q, setQ] = useParam('q');
  const [status, setStatus] = useListParam('status');
  const [dialog, setDialog] = useState<null | 'new' | { hold: Hold; action: 'menu' | 'cancel' | 'collect' | 'arrived' }>(null);
  const list = useQuery({ queryKey: ['holds', kind, q, status], queryFn: () => get<{ items: Hold[] }>(BASE[kind], { q: q || undefined, status: status.join(',') || undefined }) });
  const statuses = kind === 'preorder' ? ['reserved', 'ordered', 'arrived', 'contacted', 'collected', 'cancelled'] : ['requested', 'ordered', 'arrived', 'contacted', 'collected', 'cancelled'];
  const columns: Column<Hold>[] = [
    { header: 'Mã', cell: (h) => <span className="code">{h.docNo}</span> },
    {
      header: 'Khách hàng',
      cell: (h) => (
        <span>
          {h.customerName}
          <span className="block text-[13px] text-ink-500">{h.customerPhone && formatPhone(h.customerPhone)}</span>
        </span>
      ),
    },
    {
      header: kind === 'preorder' ? 'Sản phẩm' : 'Sách yêu cầu',
      cell: (h) => (
        <span>
          {h.title ?? h.requestedTitle}
          <span className="block text-[13px] text-ink-500">{h.sku ? <span className="code">{h.sku}</span> : h.isbn}</span>
        </span>
      ),
    },
    { header: 'SL', align: 'right', cell: (h) => formatNumber(h.qty) },
    { header: 'Giá', align: 'right', cell: (h) => formatVnd((h.unitPriceVnd ?? h.quoteVnd ?? 0) * h.qty) },
    { header: 'Đã cọc', align: 'right', cell: (h) => formatVnd(h.depositVnd) },
    { header: 'Trạng thái', cell: (h) => <HoldChip h={h} /> },
    { header: 'Ngày đặt', className: 'whitespace-nowrap', cell: (h) => formatDate(h.createdAt) },
  ];
  return (
    <>
      <PageHeader
        title="Đặt trước"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setDialog('new')}>
            {kind === 'preorder' ? 'Đặt trước' : 'Đặt riêng'}
          </Button>
        }
      />
      <div className="mb-4">
        <Tabs
          tabs={[
            { key: 'preorder', label: 'Đặt trước' },
            { key: 'special_order', label: 'Đặt riêng' },
          ]}
          value={kind}
          onChange={(k) => {
            setStatus([]);
            setTab(k);
          }}
        />
      </div>
      <div className="mb-4 flex items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder={kind === 'preorder' ? 'Tìm mã, khách hàng, SKU…' : 'Tìm mã, khách hàng, tên sách, ISBN…'} />
        <FilterMenu groups={[{ label: 'Trạng thái', options: statuses.map((s) => ({ key: s, label: HOLD_STATUS[s]!.label })), values: status, onChange: setStatus }]} />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(h) => h.id}
        onRow={(h) => (h.orderId ? navigate(`/orders/${h.orderId}`) : setDialog({ hold: h, action: 'menu' }))}
        error={list.error}
        onRetry={() => list.refetch()}
        minWidth={900}
        empty={{ icon: CalendarClock, title: kind === 'preorder' ? 'Chưa có phiếu đặt trước' : 'Chưa có đơn đặt riêng', help: 'Khách đặt cọc để giữ sách sắp phát hành, hết hàng hoặc chưa có ở tiệm.' }}
      />
      {dialog === 'new' && (kind === 'preorder' ? <NewPreorderDialog onClose={() => setDialog(null)} /> : <NewSpecialOrderDialog onClose={() => setDialog(null)} />)}
      {dialog && dialog !== 'new' && <HoldActions kind={kind} hold={dialog.hold} action={dialog.action} onAction={(action) => setDialog({ hold: dialog.hold, action })} onClose={() => setDialog(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Deposit and customer fields shared by both forms

interface DepositState {
  method: 'cash' | 'transfer' | 'card';
  amountVnd: number | null;
  ref: string;
}

function DepositFields({ value, onChange, totalVnd }: { value: DepositState; onChange: (v: DepositState) => void; totalVnd: number }) {
  const shift = useOpenShift();
  const min = Math.round((totalVnd * 30) / 100);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Hình thức nhận cọc">
        {(
          [
            ['cash', 'Tiền mặt'],
            ['transfer', 'Chuyển khoản'],
            ['card', 'Thẻ'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={value.method === k}
            onClick={() => onChange({ ...value, method: k, ref: k === 'transfer' ? paymentRefFromBytes(crypto.getRandomValues(new Uint8Array(8))) : '' })}
            className={clsx('h-11 rounded-xl border text-sm font-medium', value.method === k ? 'border-2 border-navy-700 bg-navy-50 text-navy-700' : 'border-paper-500')}
          >
            {label}
          </button>
        ))}
      </div>
      <MoneyInput label="Tiền cọc" value={value.amountVnd} onChange={(v) => onChange({ ...value, amountVnd: v })} />
      {totalVnd > 0 && (
        <p className="text-[13px] text-ink-500">
          Tối thiểu {formatVnd(min)} (30%) · trả đủ {formatVnd(totalVnd)}
        </p>
      )}
      {value.method === 'cash' && !shift.data && !shift.isLoading && <InlineAlert tone="warning">Cần một ca đang mở để nhận tiền mặt. Hãy mở ca ở màn hình Bán hàng.</InlineAlert>}
      {value.method === 'transfer' && <CopyCode label="Nội dung chuyển khoản" value={value.ref} />}
      {value.method === 'card' && <Field label="Mã chuẩn chi" required className="code" value={value.ref} onChange={(e) => onChange({ ...value, ref: e.target.value })} />}
    </div>
  );
}

function useDepositBody() {
  const shift = useOpenShift();
  return (d: DepositState) => ({
    method: d.method,
    amountVnd: d.amountVnd ?? 0,
    ...(d.method === 'cash' && shift.data && { shiftId: shift.data.id }),
    ...(d.method !== 'cash' && { ref: d.method === 'transfer' ? normalizePaymentRef(d.ref) : d.ref.trim() }),
  });
}

function CustomerFields({ value, onChange }: { value: { phone: string; name: string; source: string }; onChange: (v: { phone: string; name: string; source: string }) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Số điện thoại" required inputMode="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} />
      <Field label="Tên khách" required value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      <SelectField label="Kênh" value={value.source} onChange={(e) => onChange({ ...value, source: e.target.value })} className="sm:col-span-2">
        {ORDER_SOURCES.filter((s) => s !== 'website').map((s) => (
          <option key={s} value={s}>
            {s === 'other' ? 'Tại quầy / khác' : ORDER_SOURCE[s]}
          </option>
        ))}
      </SelectField>
    </div>
  );
}

function NewPreorderDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [cust, setCust] = useState({ phone: '', name: '', source: 'other' });
  const [hit, setHit] = useState<ProductHit | null>(null);
  const [qty, setQty] = useState(1);
  const [dep, setDep] = useState<DepositState>({ method: 'cash', amountVnd: null, ref: '' });
  const depositBody = useDepositBody();
  return (
    <ConfirmDialog
      title="Đặt trước"
      confirm="Lưu phiếu đặt trước"
      size="md"
      onClose={onClose}
      onConfirm={async () => {
        if (!hit) throw new Error('Chọn sản phẩm khách đặt.');
        const r = await post<{ docNo: string; status: string }>('/api/v1/preorders', { source: cust.source, customer: { name: cust.name.trim(), phone: cust.phone.trim() }, variantId: hit.variantId, qty, deposit: depositBody(dep) });
        toast.success(r.status === 'arrived' ? `Đã lưu ${r.docNo}. Hàng đã có sẵn – khách được thêm vào danh sách cần liên hệ.` : `Đã lưu ${r.docNo}.`);
        void qc.invalidateQueries({ queryKey: ['holds'] });
      }}
    >
      <CustomerFields value={cust} onChange={setCust} />
      {hit ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-paper-300 p-3 text-sm">
          <span className="min-w-0">
            <span className="block font-medium">{hitTitle(hit)}</span>
            <span className="code text-ink-500">{hit.sku}</span> · {formatVnd(hit.priceVnd)}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setHit(null)}>
            Đổi
          </Button>
        </div>
      ) : (
        <ProductSearch onPick={setHit} placeholder="Nhập SKU / tên sản phẩm" scanIcon={false} />
      )}
      <Field label="Số lượng" inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))} />
      <DepositFields value={dep} onChange={setDep} totalVnd={(hit?.priceVnd ?? 0) * qty} />
    </ConfirmDialog>
  );
}

function NewSpecialOrderDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [cust, setCust] = useState({ phone: '', name: '', source: 'other' });
  const [f, setF] = useState({ title: '', isbn: '', qty: 1, quote: null as number | null, note: '' });
  const [dep, setDep] = useState<DepositState>({ method: 'cash', amountVnd: null, ref: '' });
  const depositBody = useDepositBody();
  return (
    <ConfirmDialog
      title="Đặt riêng"
      confirm="Lưu đơn đặt riêng"
      size="md"
      onClose={onClose}
      onConfirm={async () => {
        const r = await post<{ docNo: string }>('/api/v1/special-orders', {
          source: cust.source,
          customer: { name: cust.name.trim(), phone: cust.phone.trim() },
          requestedTitle: f.title.trim(),
          isbn: f.isbn.trim() || null,
          qty: f.qty,
          quoteVnd: f.quote ?? 0,
          deposit: depositBody(dep),
          note: f.note.trim() || null,
        });
        toast.success(`Đã lưu ${r.docNo}.`);
        void qc.invalidateQueries({ queryKey: ['holds'] });
      }}
    >
      <CustomerFields value={cust} onChange={setCust} />
      <Field label="Tên sách" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="ISBN" inputMode="numeric" value={f.isbn} onChange={(e) => setF({ ...f, isbn: e.target.value })} />
        <Field label="Số lượng" inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} />
      </div>
      <MoneyInput label="Giá báo khách (mỗi cuốn)" value={f.quote} onChange={(v) => setF({ ...f, quote: v })} />
      <DepositFields value={dep} onChange={setDep} totalVnd={(f.quote ?? 0) * f.qty} />
      <TextArea label="Ghi chú" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Actions on one pre-order or special order

function HoldActions({ kind, hold, action, onAction, onClose }: { kind: Kind; hold: Hold; action: 'menu' | 'cancel' | 'collect' | 'arrived'; onAction: (a: 'cancel' | 'collect' | 'arrived') => void; onClose: () => void }) {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['holds'] });
  const open = !['collected', 'cancelled'].includes(hold.status);
  if (action === 'cancel') return <CancelHoldDialog kind={kind} hold={hold} onClose={onClose} onDone={done} />;
  if (action === 'collect') return <CollectDialog kind={kind} hold={hold} onClose={onClose} onDone={done} />;
  if (action === 'arrived') return <ArrivedDialog hold={hold} onClose={onClose} onDone={done} />;
  return (
    <Dialog title={`${hold.docNo} · ${hold.customerName}`} size="sm" onClose={onClose}>
      <div className="flex flex-col gap-2">
        {!open && <p className="text-sm text-ink-500">Phiếu đã {HOLD_STATUS[hold.status]?.label.toLowerCase()}.</p>}
        {(hold.status === 'reserved' || hold.status === 'requested') && (
          <Button
            variant="secondary"
            full
            icon={Truck}
            onClick={async () => {
              try {
                await post(`${BASE[kind]}/${hold.id}/ordered`);
                toast.success('Đã ghi nhận đặt hàng nhà cung cấp.');
                done();
                onClose();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Đã đặt nhà cung cấp
          </Button>
        )}
        {kind === 'special_order' && (hold.status === 'requested' || hold.status === 'ordered') && (
          <Button variant="secondary" full icon={PackageCheck} onClick={() => onAction('arrived')}>
            Sách đã về
          </Button>
        )}
        {(hold.status === 'arrived' || hold.status === 'contacted') && (
          <Button variant="primary" full icon={PackageCheck} onClick={() => onAction('collect')}>
            Khách nhận hàng
          </Button>
        )}
        {open && (
          <Button variant="destructive-outline" full onClick={() => onAction('cancel')}>
            Hủy phiếu
          </Button>
        )}
      </div>
    </Dialog>
  );
}

function CancelHoldDialog({ kind, hold, onClose, onDone }: { kind: Kind; hold: Hold; onClose: () => void; onDone: () => void }) {
  const shift = useOpenShift();
  const [reason, setReason] = useState('');
  const [deposit, setDeposit] = useState<'refund' | 'forfeit'>('refund');
  const [ref, setRef] = useState('');
  return (
    <ConfirmDialog
      title={`Hủy ${hold.docNo}?`}
      body="Hàng đang giữ sẽ trở lại kho. Không thể hoàn tác."
      confirm="Hủy phiếu"
      destructive
      onClose={onClose}
      onConfirm={async () => {
        await post(`${BASE[kind]}/${hold.id}/cancel`, { reason: reason.trim(), deposit, ...(shift.data && { shiftId: shift.data.id }), ...(ref.trim() && { refundRef: ref.trim() }) });
        toast.success(`Đã hủy ${hold.docNo}.`);
        onDone();
      }}
    >
      <TextArea label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} />
      {hold.depositVnd > 0 && (
        <>
          <SelectField label={`Tiền cọc ${formatVnd(hold.depositVnd)}`} value={deposit} onChange={(e) => setDeposit(e.target.value as 'refund' | 'forfeit')}>
            <option value="refund">Hoàn cọc cho khách</option>
            <option value="forfeit">Giữ cọc (khách mất cọc)</option>
          </SelectField>
          {deposit === 'refund' && <Field label="Mã giao dịch hoàn tiền" helper="Không cần khi hoàn tiền mặt từ ca đang mở." value={ref} onChange={(e) => setRef(e.target.value)} />}
        </>
      )}
    </ConfirmDialog>
  );
}

function ArrivedDialog({ hold, onClose, onDone }: { hold: Hold; onClose: () => void; onDone: () => void }) {
  const [hit, setHit] = useState<ProductHit | null>(null);
  return (
    <ConfirmDialog
      title="Sách đã về"
      body="Chọn sản phẩm đã nhập kho cho sách này. Hệ thống giữ hàng và thêm khách vào danh sách cần liên hệ."
      confirm="Giữ hàng cho khách"
      size="md"
      onClose={onClose}
      onConfirm={async () => {
        if (!hit) throw new Error('Chọn sản phẩm đã nhập kho.');
        await post(`/api/v1/special-orders/${hold.id}/arrived`, { variantId: hit.variantId });
        toast.success('Đã giữ hàng cho khách.');
        onDone();
      }}
    >
      <p className="text-sm font-medium">{hold.requestedTitle}</p>
      {hit ? (
        <p className="text-sm">
          {hitTitle(hit)} · <span className="code">{hit.sku}</span> · Có thể bán {formatNumber(hit.available)}
        </p>
      ) : (
        <ProductSearch onPick={setHit} placeholder="Nhập SKU / tên sản phẩm" scanIcon={false} />
      )}
    </ConfirmDialog>
  );
}

/** Collect: an online order at the agreed price less the deposit (FR-ORD-14). */
function CollectDialog({ kind, hold, onClose, onDone }: { kind: Kind; hold: Hold; onClose: () => void; onDone: () => void }) {
  const navigate = useNavigate();
  const [delivery, setDelivery] = useState<'pickup' | 'ship'>('pickup');
  const [payment, setPayment] = useState<'cod' | 'transfer'>('cod');
  const [addr, setAddr] = useState({ provinceId: null as number | null, wardCode: '', line: '' });
  const [shipping, setShipping] = useState<number | null>(0);
  const provinces = useQuery({ queryKey: ['geo-provinces'], queryFn: () => get<{ items: { id: number; name: string }[] }>('/api/v1/geo/provinces'), staleTime: 3600_000 });
  const wards = useQuery({ queryKey: ['geo-wards', addr.provinceId], enabled: addr.provinceId !== null, queryFn: () => get<{ items: { code: string; label: string }[] }>(`/api/v1/geo/provinces/${addr.provinceId}/wards`) });
  const total = (hold.unitPriceVnd ?? hold.quoteVnd ?? 0) * hold.qty;
  return (
    <ConfirmDialog
      title="Khách nhận hàng"
      body={`Tạo đơn Giao hàng ${formatVnd(total)}, đã trừ cọc ${formatVnd(hold.depositVnd)}.`}
      confirm="Tạo đơn"
      size="md"
      onClose={onClose}
      onConfirm={async () => {
        const r = await post<{ order: { id: string; docNo: string } }>(`${BASE[kind]}/${hold.id}/collect`, {
          delivery,
          paymentMethod: payment,
          shippingVnd: delivery === 'ship' ? (shipping ?? 0) : 0,
          address: delivery === 'ship' ? { ...(addr.provinceId !== null && { provinceId: addr.provinceId }), ...(addr.wardCode && { wardCode: addr.wardCode }), line: addr.line.trim() } : null,
        });
        toast.success(`Đã tạo đơn ${r.order.docNo}.`);
        onDone();
        navigate(`/orders/${r.order.id}`);
      }}
    >
      <SelectField label="Nhận hàng" value={delivery} onChange={(e) => setDelivery(e.target.value as 'pickup' | 'ship')}>
        <option value="pickup">Tại cửa hàng</option>
        <option value="ship">Giao qua GHN</option>
      </SelectField>
      <SelectField label="Phần còn lại" value={payment} onChange={(e) => setPayment(e.target.value as 'cod' | 'transfer')}>
        <option value="cod">{delivery === 'pickup' ? 'Trả khi nhận hàng' : 'Thu hộ (COD)'}</option>
        <option value="transfer">Chuyển khoản</option>
      </SelectField>
      {delivery === 'ship' && (
        <>
          <Combobox
            label="Tỉnh/Thành phố"
            required
            options={(provinces.data?.items ?? []).map((p) => ({ key: String(p.id), label: p.name }))}
            value={addr.provinceId === null ? '' : String(addr.provinceId)}
            onChange={(k) => setAddr({ ...addr, provinceId: Number(k), wardCode: '' })}
          />
          <Combobox label="Phường/Xã" required disabled={addr.provinceId === null} options={(wards.data?.items ?? []).map((w) => ({ key: w.code, label: w.label }))} value={addr.wardCode} onChange={(k) => setAddr({ ...addr, wardCode: k })} />
          <Field label="Địa chỉ cụ thể" required value={addr.line} onChange={(e) => setAddr({ ...addr, line: e.target.value })} />
          <MoneyInput label="Phí giao hàng" value={shipping} onChange={setShipping} />
        </>
      )}
    </ConfirmDialog>
  );
}

// =============================================================================================
// To-notify worklist (FR-ORD-18, UC-19, Design §12.8)

interface Task {
  id: string;
  reason: string;
  name: string;
  phone: string | null;
  refType: string;
  refId: string;
  refLabel: string | null;
  dueAt: string;
  note: string | null;
  attempts: number;
  overdue: boolean;
}

const TASK_REASON: Record<string, string> = {
  preorder_arrived: 'Pre-order về',
  special_order_arrived: 'Đơn đặt riêng về',
  pickup_ready: 'Sẵn sàng nhận hàng',
  library_hold: 'Thư viện giữ sách',
  waitlist_offer: 'Suất chờ sự kiện',
  event_cancelled: 'Sự kiện hủy',
};

function refLink(t: Task): string | null {
  if (t.refType === 'web_order') return `/orders/${t.refId}`;
  if (t.refType === 'preorder') return '/preorders?tab=preorder';
  if (t.refType === 'special_order') return '/preorders?tab=special_order';
  return null;
}

function DueChip({ t }: { t: Task }) {
  if (t.overdue) return <StatusChip tone="danger">Quá hạn</StatusChip>;
  const today = new Date().toDateString() === new Date(t.dueAt).toDateString();
  return today ? <StatusChip tone="warning">Hạn hôm nay</StatusChip> : <StatusChip tone="info">Hạn {formatDateTime(t.dueAt)}</StatusChip>;
}

export function ContactTasksPage() {
  const qc = useQueryClient();
  const [reason, setReason] = useListParam('reason');
  const [unreachable, setUnreachable] = useState<Task | null>(null);
  const list = useQuery({ queryKey: ['contact-tasks', reason], queryFn: () => get<{ items: Task[] }>('/api/v1/contact-tasks', { reason: reason.join(',') || undefined }) });
  const items = [...(list.data?.items ?? [])].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueAt.localeCompare(b.dueAt));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['contact-tasks'] });
    void qc.invalidateQueries({ queryKey: ['badges'] });
  };
  return (
    <>
      <PageHeader title="Cần liên hệ" />
      <div className="mb-4">
        <FilterMenu groups={[{ label: 'Lý do', options: Object.entries(TASK_REASON).map(([key, label]) => ({ key, label })), values: reason, onChange: setReason }]} />
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data ? (
        <Skeleton className="h-40" />
      ) : items.length === 0 ? (
        <EmptyState icon={PhoneCall} title="Không có ai cần liên hệ" help="Khách có pre-order về, đơn sẵn sàng nhận… sẽ hiện ở đây." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((t) => {
            const link = refLink(t);
            return (
              <li key={t.id} className={clsx('flex flex-col gap-3 rounded-lg border bg-white p-4', t.overdue ? 'border-danger-700' : 'border-paper-300')}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-ink-700">
                    {TASK_REASON[t.reason] ?? t.reason}
                    {t.refLabel && (
                      <>
                        {' · '}
                        {link ? (
                          <Link to={link} className="code whitespace-nowrap text-navy-700 underline">
                            {t.refLabel}
                          </Link>
                        ) : (
                          <span className="code whitespace-nowrap">{t.refLabel}</span>
                        )}
                      </>
                    )}
                  </p>
                  <DueChip t={t} />
                </div>
                <div>
                  <p className="font-semibold text-ink-900">{t.name}</p>
                  {t.phone && (
                    <a href={`tel:${t.phone}`} className="text-xl font-semibold text-navy-700 underline num">
                      {formatPhone(t.phone)}
                    </a>
                  )}
                </div>
                {t.note && <p className="text-[13px] whitespace-pre-line text-ink-500">{t.note}</p>}
                <div className="mt-auto flex gap-2">
                  <Button
                    variant="primary"
                    icon={PhoneCall}
                    onClick={async () => {
                      try {
                        await post(`/api/v1/contact-tasks/${t.id}/contacted`, {});
                        toast.success(`Đã liên hệ ${t.name}.`);
                        refresh();
                      } catch (e) {
                        toast.error((e as Error).message);
                      }
                    }}
                  >
                    Đã liên hệ
                  </Button>
                  <Button variant="secondary" icon={PhoneOff} onClick={() => setUnreachable(t)}>
                    Không liên lạc được
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {unreachable && <UnreachableDialog task={unreachable} onClose={() => setUnreachable(null)} onDone={refresh} />}
    </>
  );
}

function UnreachableDialog({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  return (
    <ConfirmDialog
      title="Không liên lạc được"
      body="Việc vẫn mở tới hạn; ghi chú lần gọi để người sau biết."
      confirm="Lưu ghi chú"
      onClose={onClose}
      onConfirm={async () => {
        await post(`/api/v1/contact-tasks/${task.id}/unreachable`, { note: note.trim() });
        onDone();
      }}
    >
      <TextArea label="Ghi chú" required value={note} onChange={(e) => setNote(e.target.value)} />
    </ConfirmDialog>
  );
}

// =============================================================================================
// COD reconciliation (FR-ORD-11)

interface Remittance {
  id: string;
  status: string;
  expectedVnd: number;
  receivedVnd: number | null;
  statementRef: string | null;
  createdAt: string;
  trackingNo: string;
  orderId: string;
  docNo: string;
}

const COD_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Chờ đối soát', tone: 'warning' },
  matched: { label: 'Đã khớp', tone: 'success' },
  difference: { label: 'Chênh lệch', tone: 'danger' },
};

export function CodPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useParam('status', 'pending');
  const [row, setRow] = useState<Remittance | null>(null);
  const list = useQuery({ queryKey: ['cod', status], queryFn: () => get<{ items: Remittance[] }>('/api/v1/cod/remittances', { status: status === 'all' ? undefined : status }) });
  const columns: Column<Remittance>[] = [
    { header: 'Mã vận đơn', cell: (r) => <span className="code">{r.trackingNo}</span> },
    { header: 'Đơn', cell: (r) => <span className="code">{r.docNo}</span> },
    { header: 'Giao xong', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.createdAt) },
    { header: 'Phải thu', align: 'right', cell: (r) => formatVnd(r.expectedVnd) },
    { header: 'GHN đã trả', align: 'right', cell: (r) => (r.receivedVnd === null ? '' : formatVnd(r.receivedVnd)) },
    { header: 'Bảng kê', cell: (r) => r.statementRef ?? '' },
    { header: 'Trạng thái', cell: (r) => <StatusChip tone={COD_STATUS[r.status]!.tone}>{COD_STATUS[r.status]!.label}</StatusChip> },
  ];
  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/orders" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Giao hàng
          </Link>
        }
        title="Đối soát COD"
      />
      <div className="mb-4">
        <Tabs
          tabs={[
            { key: 'pending', label: 'Chờ đối soát' },
            { key: 'difference', label: 'Chênh lệch' },
            { key: 'matched', label: 'Đã khớp' },
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        onRow={(r) => (r.status === 'matched' ? navigate(`/orders/${r.orderId}`) : setRow(r))}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={{ icon: HandCoins, title: 'Không có khoản thu hộ nào', help: 'Đơn COD giao xong sẽ chờ đối soát với bảng kê GHN ở đây.' }}
      />
      {row && <ReconcileDialog row={row} onClose={() => setRow(null)} onDone={() => void qc.invalidateQueries({ queryKey: ['cod'] })} />}
    </>
  );
}

function ReconcileDialog({ row, onClose, onDone }: { row: Remittance; onClose: () => void; onDone: () => void }) {
  const [received, setReceived] = useState<number | null>(row.expectedVnd);
  const [ref, setRef] = useState(row.statementRef ?? '');
  return (
    <ConfirmDialog
      title={`Đối soát ${row.trackingNo}`}
      body={`Phải thu ${formatVnd(row.expectedVnd)} cho đơn ${row.docNo}.`}
      confirm="Lưu đối soát"
      onClose={onClose}
      onConfirm={async () => {
        const r = await post<{ status: string; differenceVnd: number }>(`/api/v1/cod/remittances/${row.id}/reconcile`, { receivedVnd: received ?? 0, statementRef: ref.trim() });
        if (r.status === 'matched') toast.success('Đã khớp.');
        else toast.error(`Chênh lệch ${formatVnd(r.differenceVnd)}. Hãy liên hệ GHN.`);
        onDone();
      }}
    >
      <MoneyInput label="GHN đã trả" value={received} onChange={setReceived} autoFocus />
      <Field label="Mã bảng kê" required value={ref} onChange={(e) => setRef(e.target.value)} />
    </ConfirmDialog>
  );
}

// =============================================================================================
// Channel profiles (FR-SOC-01)

interface Channel {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  handle: string | null;
  active: boolean;
}

/** Channel profiles, a tab of Cài đặt (FR-SOC-01). */
export function ChannelsPanel() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Channel | 'new' | null>(null);
  const list = useQuery({ queryKey: ['channels', 'all'], queryFn: () => get<{ items: Channel[] }>('/api/v1/channels') });
  const columns: Column<Channel>[] = [
    { header: 'Tên', cell: (c) => <span className="font-medium">{c.name}</span> },
    { header: 'Loại', cell: (c) => ORDER_SOURCE[c.kind] ?? c.kind },
    { header: 'Tài khoản', cell: (c) => c.handle ?? '' },
    { header: 'Địa chỉ', cell: (c) => (c.url ? <span className="break-all text-ink-700">{c.url}</span> : '') },
    { header: 'Trạng thái', cell: (c) => (c.active ? <StatusChip tone="success">Đang dùng</StatusChip> : <StatusChip tone="neutral">Ngừng dùng</StatusChip>) },
  ];
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-sm text-ink-500">Trang và tài khoản bán hàng, để chọn khi tạo đơn.</p>
        <Button variant="primary" icon={Plus} onClick={() => setEdit('new')}>
          Thêm kênh
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(c) => c.id}
        onRow={setEdit}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={{ icon: RadioTower, title: 'Chưa có kênh nào', help: 'Thêm fanpage, Zalo OA, Instagram, TikTok hoặc gian hàng sàn để chọn khi tạo đơn.' }}
      />
      {edit && <ChannelDialog channel={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => void qc.invalidateQueries({ queryKey: ['channels'] })} />}
    </>
  );
}

function ChannelDialog({ channel, onClose, onDone }: { channel: Channel | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: channel?.name ?? '', kind: channel?.kind ?? 'facebook', url: channel?.url ?? '', handle: channel?.handle ?? '', active: channel?.active ?? true });
  return (
    <ConfirmDialog
      title={channel ? 'Sửa kênh' : 'Thêm kênh'}
      confirm="Lưu"
      onClose={onClose}
      onConfirm={async () => {
        const body = { name: f.name.trim(), kind: f.kind, url: f.url.trim() || null, handle: f.handle.trim() || null, active: f.active };
        if (channel) await patch(`/api/v1/channels/${channel.id}`, body);
        else await post('/api/v1/channels', body);
        toast.success('Đã lưu kênh.');
        onDone();
      }}
    >
      <Field label="Tên" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <SelectField label="Loại" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
        {CHANNEL_KINDS.map((k) => (
          <option key={k} value={k}>
            {ORDER_SOURCE[k]}
          </option>
        ))}
      </SelectField>
      <Field label="Tài khoản" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} />
      <Field label="Địa chỉ trang" inputMode="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5 accent-navy-700" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        Đang dùng
      </label>
    </ConfirmDialog>
  );
}

/** Share card for a product (FR-SOC-04): copy-ready text and link. */
export function ShareCardDialog({ variantId, onClose }: { variantId: string; onClose: () => void }) {
  const card = useQuery({ queryKey: ['share-card', variantId], queryFn: () => post<{ text: string; url: string | null }>('/api/v1/share-links', { variantId }) });
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      title="Chia sẻ sản phẩm"
      size="sm"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          disabled={!card.data}
          onClick={async () => {
            await navigator.clipboard.writeText(card.data!.text);
            setCopied(true);
            toast.success('Đã sao chép nội dung.');
          }}
        >
          {copied ? 'Đã sao chép' : 'Sao chép nội dung'}
        </Button>
      }
    >
      {card.isError ? (
        <ErrorState error={card.error} />
      ) : !card.data ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="flex flex-col gap-3">
          <pre className="rounded-lg border border-paper-300 bg-paper-50 p-4 font-sans text-sm whitespace-pre-wrap text-ink-900">{card.data.text}</pre>
          {!card.data.url && <InlineAlert tone="info">Chưa có địa chỉ trang sản phẩm trên website (Cấu hình → web.product_url), nên nội dung chưa có liên kết.</InlineAlert>}
        </div>
      )}
    </Dialog>
  );
}

