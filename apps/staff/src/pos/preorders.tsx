import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, ChevronDown, Minus, Plus, ShoppingCart, User, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ConfirmDialog, Facts, SelectField, TextArea, toast } from '../components/data';
import type { CustomerChoice } from '../components/customer-picker';
import { ProductSearch, hitTitle, type ProductHit } from '../components/product-search';
import { Button, Field, InlineAlert, PageHeader, StatusChip, type Tone } from '../components/ui';
import { get, post } from '../lib/api';
import { formatDateTime, formatNumber, formatPhone, formatVnd } from '../lib/format';
import { can, useMe } from '../lib/session';
import { useOpenShift } from '../lib/shift';
import type { CartCustomer, CartPreorder } from './cart';
import { CustomerDialog, PaymentMethodPicker } from './dialogs';
import { Dialog, Keypad } from './widgets';

/**
 * Pre-orders (FR-ORD-14, FR-ORD-16, FR-POS-09; Design §12.8; revised 15 Nov 2026): one slip for books
 * kept for a customer, never edited once taken. Copies on the shelf are held at once; a slip of books to
 * order takes its deposit when it is taken, and staff set its status by hand with “Cập nhật”. Needs the server.
 */

/** What staff see (SRS B.5): five statuses grouping the stored ones. */
export const PREORDER_GROUPS = {
  waiting: { label: 'Chờ xác nhận', tone: 'warning', statuses: ['quote', 'confirmed'] },
  ordering: { label: 'Đang đặt hàng', tone: 'info', statuses: ['ordered'] },
  ready: { label: 'Chờ nhận', tone: 'success', statuses: ['arrived', 'contacted'] },
  collected: { label: 'Đã nhận', tone: 'neutral', statuses: ['collected'] },
  cancelled: { label: 'Đã hủy', tone: 'neutral', statuses: ['cancelled'] },
} satisfies Record<string, { label: string; tone: Tone; statuses: string[] }>;
export type PreorderGroup = keyof typeof PREORDER_GROUPS;

/** Stored status → what staff see. */
export const PREORDER_STATUS: Record<string, { label: string; tone: Tone }> = Object.fromEntries(
  Object.values(PREORDER_GROUPS).flatMap((g) => g.statuses.map((s) => [s, { label: g.label, tone: g.tone as Tone }])),
);

export const PREORDER_OPEN = ['quote', 'confirmed', 'ordered', 'arrived', 'contacted'];
const METHOD: Record<string, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' };

export interface PreorderLine {
  lineId: string;
  variantId: string | null;
  sku: string | null;
  title: string;
  freeText: boolean;
  qty: number;
  unitPriceVnd: number | null;
  held: boolean;
}

export interface PreorderRow {
  id: string;
  docNo: string;
  status: string;
  createdAt: string;
  lines: PreorderLine[];
  totalVnd: number;
  unpriced: boolean;
  depositVnd: number;
  depositMethod: string | null;
  quotedAt: string | null;
  confirmedAt: string | null;
  contactedAt: string | null;
  expiresAt: string | null;
  extensions: number;
  /** Chờ nhận: Giao hàng rather than Nhận tại quầy, with the note staff wrote. */
  /** The delivery order created from the slip (FR-ORD-14). */
  orderId: string | null;
  orderDocNo: string | null;
  note: string | null;
  saleId: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  customerTierCode: string | null;
  customerPoints: number;
}

export const isOverdue = (p: Pick<PreorderRow, 'status' | 'expiresAt'>) => p.status === 'contacted' && !!p.expiresAt && new Date(p.expiresAt).getTime() < Date.now();
export const isReady = (p: Pick<PreorderRow, 'status'>) => p.status === 'arrived' || p.status === 'contacted';

export function PreorderChip({ p }: { p: Pick<PreorderRow, 'status'> }) {
  const s = PREORDER_STATUS[p.status] ?? { label: p.status, tone: 'neutral' as Tone };
  return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
}

/** What the POS cart needs to collect a slip (FR-POS-09). */
export function toCart(p: PreorderRow): { preorder: CartPreorder; customer: CartCustomer } {
  return {
    preorder: { id: p.id, docNo: p.docNo, lines: p.lines.map((l) => ({ variantId: l.variantId!, qty: l.qty, unitPriceVnd: l.unitPriceVnd ?? 0 })), depositVnd: p.depositVnd },
    customer: { id: p.customerId, name: p.customerName, phoneE164: p.customerPhone, tierCode: p.customerTierCode, pointsBalance: p.customerPoints },
  };
}

// =============================================================================================
// Deposit fields (cash into an open shift, bank transfer with its reference, card)

interface DepositState {
  method: 'cash' | 'transfer' | 'card';
  amountVnd: number | null;
  ref: string;
}

/**
 * A compact dropdown (Design §12.8): a 36 px button opening a small menu. Not a native select, so it
 * stays at body size on phones without the iPhone zoom on focus.
 */
function CompactSelect<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const current = options.find(([k]) => k === value)?.[1] ?? '';
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-9 min-w-32 items-center justify-between gap-2 rounded-md border border-paper-500 bg-white px-3 text-sm font-medium before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] disabled:bg-paper-100 disabled:text-ink-500"
      >
        {current}
        {!disabled && <ChevronDown size={16} className={clsx('text-ink-500 transition-transform', open && 'rotate-180')} aria-hidden />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <ul role="listbox" aria-label={label} className="absolute right-0 z-20 mt-1 min-w-full overflow-hidden rounded-md border border-paper-300 bg-white py-1 shadow-md">
            {options.map(([k, text]) => (
              <li key={k} role="option" aria-selected={k === value}>
                <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm whitespace-nowrap hover:bg-navy-50" onClick={() => { onChange(k); setOpen(false); }}>
                  {text}
                  {k === value && <Check size={16} className="text-navy-700" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function DepositFields({ value, onChange }: { value: DepositState; onChange: (d: DepositState) => void }) {
  const digits = value.amountVnd ? String(value.amountVnd) : '';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-medium text-ink-700">Phương thức thanh toán</p>
        {/* Round radio ticks in three equal boxes, as on the payment dialog (Design §12.8, §13.4). */}
        <PaymentMethodPicker value={value.method} onChange={(m) => onChange({ ...value, method: m })} />
      </div>
      {/* Every method: keyed on the keypad, as on the selling screen's cash payment (Design §12.8). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-ink-700">Tiền cọc</p>
          <p className="h-12 rounded-md border border-paper-500 px-3 text-right text-lg leading-[46px] num">{digits ? formatNumber(Number(digits)) : '—'} ₫</p>
        </div>
        <Keypad onKey={(k) => { const next = k === 'del' ? digits.slice(0, -1) : (digits + k).replace(/^0+/, '').slice(0, 10); onChange({ ...value, amountVnd: next ? Number(next) : null }); }} />
      </div>
    </div>
  );
}

const depositBody = (d: DepositState, shiftId: string | null) => ({
  method: d.method,
  amountVnd: d.amountVnd ?? 0,
  // A transfer needs no reference: confirming means the money arrived (FR-POS-06).
  ...(d.method === 'cash' ? { shiftId: shiftId ?? undefined } : {}),
});

// =============================================================================================
// New slip (POS button and the page)

type Draft = { kind: 'product'; hit: ProductHit; qty: number } | { kind: 'text'; title: string; qty: number };

/** The POS “Đặt trước” button and the page's “+ Tạo phiếu”: a new slip. */
export function PreorderDialog({ online, customer, shiftId = null, onClose }: { online: boolean; customer: CartCustomer | null; /** The POS shift, preferred for a cash deposit. */ shiftId?: string | null; onClose: () => void }) {
  if (!online) {
    return (
      <Dialog title="Phiếu đặt trước" size="sm" onClose={onClose}>
        <InlineAlert tone="warning">Cần kết nối mạng để tạo phiếu đặt trước.</InlineAlert>
      </Dialog>
    );
  }
  return (
    <Dialog title="Phiếu đặt trước" size="lg" onClose={onClose}>
      <NewPreorder initialCustomer={customer} shiftId={shiftId} onDone={onClose} onCancel={onClose} />
    </Dialog>
  );
}

/** “+ Tạo phiếu” on Đặt trước: the form as its own page, not a dialog (Design §12.8). */
export function PreorderNewPage() {
  const navigate = useNavigate();
  return (
    // Fills the screen height on phones like the selling screen: the product card stretches, the order bar sits at the bottom (Design §12.8).
    <div className="flex max-w-[720px] flex-col max-sm:h-[calc(100dvh-104px)] lg:h-[calc(100dvh-136px)] lg:max-w-none">
      <PageHeader back={{ to: '/preorders', label: 'Đặt trước' }} title="Phiếu đặt trước" />
      <NewPreorder page initialCustomer={null} shiftId={null} onDone={() => navigate('/preorders')} onCancel={() => navigate('/preorders')} />
    </div>
  );
}

function NewPreorder({
  initialCustomer,
  shiftId,
  onDone,
  onCancel,
  page = false,
}: {
  initialCustomer: CartCustomer | null;
  shiftId: string | null;
  onDone: () => void;
  /** “Hủy”: drop the slip being written. */
  onCancel?: () => void;
  /** On its own page: the order bar sits at the bottom of the screen on phones. */
  page?: boolean;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const qc = useQueryClient();
  const open = useOpenShift();
  const shift = { data: shiftId ? { id: shiftId } : open.data };
  const [picking, setPicking] = useState(false);
  const [cust, setCust] = useState<CustomerChoice>(initialCustomer ? { kind: 'existing', customer: { ...initialCustomer, tierName: null } as never } : null);
  const [items, setItems] = useState<Draft[]>([]);
  // Xác nhận opens the Thu cọc dialog (Design §12.8): Không cọc / Có cọc, then save.
  const [depositDialog, setDepositDialog] = useState(false);
  const [takeDeposit, setTakeDeposit] = useState(false);
  const [dep, setDep] = useState<DepositState>({ method: 'cash', amountVnd: null, ref: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onShelf = (d: Draft) => d.kind === 'product' && d.hit.available >= d.qty;
  // Every book on the shelf: a hold, valid at once; otherwise a manager quotes first (FR-ORD-14).
  const hold = items.length > 0 && items.every(onShelf);
  // Never both on one slip: a hold of books on the shelf, or an order of books to order (FR-ORD-14).
  const mixed = items.some(onShelf) && !items.every(onShelf);
  const value = items.reduce((a, d) => a + (d.kind === 'product' ? d.hit.priceVnd * d.qty : 0), 0);
  // An order: at least 30 % of its catalogue books, free-text books add nothing (BR-10).
  // Minimum deposit from Cấu hình › Đặt trước (BR-10); 0 makes it optional.
  const config = useQuery({ queryKey: ['preorder-config'], queryFn: () => get<{ depositPct: number }>('/api/v1/preorders/config') });
  const pct = config.data?.depositPct ?? 30;
  const minDeposit = hold ? 0 : Math.round((value * pct) / 100);
  // A required deposit (an order with a minimum) has no Không cọc choice (Design §12.8).
  const required = !hold && minDeposit > 0;
  const depositOpen = required || takeDeposit;
  const depositVnd = depositOpen ? (dep.amountVnd ?? 0) : 0;
  const add = (h: ProductHit) =>
    setItems((xs) => (xs.some((x) => x.kind === 'product' && x.hit.variantId === h.variantId) ? xs.map((x) => (x.kind === 'product' && x.hit.variantId === h.variantId ? { ...x, qty: x.qty + 1 } : x)) : [...xs, { kind: 'product', hit: h, qty: 1 }]));
  const setQty = (i: number, qty: number) => setItems((xs) => (qty < 1 ? xs.filter((_, j) => j !== i) : xs.map((x, j) => (j === i ? { ...x, qty } : x))));
  // A stale error goes as soon as the customer or the books change.
  useEffect(() => setError(null), [cust, items]);
  /** Xác nhận on the page: customer and books first, then the Thu cọc dialog. */
  const confirm = () => {
    setError(null);
    if (!cust) return setError('Chọn khách hoặc nhập khách mới.');
    if (!items.length) return setError('Thêm sách khách muốn giữ hoặc đặt.');
    setDepositDialog(true);
  };
  const save = async () => {
    setError(null);
    if (!cust || !items.length) return;
    if (required && depositVnd < minDeposit) return setError(`Tiền cọc tối thiểu ${formatVnd(minDeposit)} (${pct}%).`);
    if (depositVnd && dep.method === 'cash' && !shift.data) return setError('Cần một ca đang mở để nhận cọc tiền mặt.');
    setBusy(true);
    try {
      const r = await post<{ docNo: string; status: string; expiresAt: string | null }>('/api/v1/preorders', {
        customer: cust.kind === 'existing' ? { customerId: cust.customer.id } : { name: cust.name.trim(), phone: cust.phone.trim() },
        lines: items.map((d) => (d.kind === 'product' ? { variantId: d.hit.variantId, qty: d.qty } : { title: d.title, qty: d.qty })),
        ...(depositVnd ? { deposit: depositBody(dep, shift.data?.id ?? null) } : {}),
      });
      toast.success(r.status === 'contacted' ? `Đã giữ sách – ${r.docNo}, giữ đến ${formatDateTime(r.expiresAt!)}.` : `Đã lưu ${r.docNo} – Chờ xác nhận.`);
      void qc.invalidateQueries({ queryKey: ['preorders'] });
      void qc.invalidateQueries({ queryKey: ['badges'] });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const dirty = items.length > 0 || !!cust;
  const cancel = () => (dirty ? setConfirmCancel(true) : onCancel?.());
  return (
    // Wide screens: the selling screen's two columns – search and customer left, products and buttons right (Design §12.8, §13.1).
    <div className={clsx('flex min-h-0 flex-1 flex-col gap-4', page && 'lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-1 lg:gap-6')}>
      <div className="flex flex-col gap-4 lg:min-w-0">
      {/* Laid out like the selling screen: product search, the Gắn khách row, the product card (Design §12.8, §13.1). */}
      <ProductSearch onPick={add} hideSku placeholder="Nhập SKU / tên sách / ISBN" onFreeText={(title) => setItems((xs) => [...xs, { kind: 'text', title, qty: 1 }])} />
      <div className="flex min-h-11 items-center gap-2">
        {cust ? (
          <>
            <User size={18} className="shrink-0 text-ink-700" aria-hidden />
            <div className="min-w-0">
              <p className="truncate font-semibold">
                {cust.kind === 'existing' ? cust.customer.name : cust.name}
                {cust.kind === 'new' && <span className="ml-2 text-[13px] font-normal text-ink-500">Khách mới</span>}
              </p>
              {(cust.kind === 'existing' ? cust.customer.phoneE164 : cust.phone) && (
                <p className="text-[13px] text-ink-500 num">{cust.kind === 'existing' ? formatPhone(cust.customer.phoneE164!) : cust.phone}</p>
              )}
            </div>
            <button type="button" className="ml-auto inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-navy-50" aria-label="Đổi khách" title="Đổi khách" onClick={() => setCust(null)}>
              <X size={18} aria-hidden />
            </button>
          </>
        ) : (
          <Button variant="primary" size="sm" icon={User} className="relative min-h-0! before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']" onClick={() => setPicking(true)}>
            Gắn khách
          </Button>
        )}
      </div>
      </div>
      {picking && (
        <CustomerDialog
          online
          canCreate={false}
          onClose={() => setPicking(false)}
          onPick={(c) => {
            setCust({ kind: 'existing', customer: { id: c.id, name: c.name, phoneE164: c.phoneE164, tierCode: c.tierCode, pointsBalance: c.pointsBalance } });
            setPicking(false);
          }}
          onNew={(c) => {
            setCust({ kind: 'new', phone: c.phone, name: c.name });
            setPicking(false);
          }}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex min-h-40 flex-1 flex-col overflow-hidden rounded-lg border border-paper-300 bg-white sm:min-h-56 lg:min-h-0">
        <h3 className="px-4 pt-3 pb-1 text-sm font-semibold text-ink-900">Thông tin sản phẩm</h3>
        {items.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center text-sm text-ink-500">
            <ShoppingCart size={32} className="text-ink-300" aria-hidden />
            Chưa có sách nào
          </div>
        )}
        {items.length > 0 && (
          <ul className="min-h-0 flex-1 divide-y divide-paper-300 overflow-y-auto">
            {items.map((d, i) => (
              <li key={d.kind === 'product' ? d.hit.variantId : `t${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className={clsx('font-medium', d.kind === 'text' && 'italic')}>{d.kind === 'product' ? hitTitle(d.hit) : d.title}</p>
                  <p className={clsx('text-[13px]', onShelf(d) ? 'text-success-700' : 'text-warning-700')}>
                    {onShelf(d) ? 'Có sẵn – giữ ngay' : 'Cần đặt'}
                    {d.kind === 'product' && <span className="text-ink-500 num"> · {formatVnd(d.hit.priceVnd)}</span>}
                  </p>
                </div>
                <span className="inline-flex items-center">
                  <button type="button" className="inline-flex h-11 w-8 items-center justify-center text-ink-700 hover:text-navy-700" aria-label="Giảm số lượng" onClick={() => setQty(i, d.qty - 1)}>
                    <Minus size={16} aria-hidden />
                  </button>
                  <span className="inline-flex h-7 min-w-8 items-center justify-center rounded-sm border border-paper-500 px-1 text-sm font-semibold num">{d.qty}</span>
                  <button type="button" className="inline-flex h-11 w-8 items-center justify-center text-ink-700 hover:text-navy-700" aria-label="Tăng số lượng" onClick={() => setQty(i, d.qty + 1)}>
                    <Plus size={16} aria-hidden />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {mixed && <InlineAlert tone="warning">Một phiếu chỉ gồm sách có sẵn (giữ sách) hoặc sách cần đặt. Bỏ bớt sách rồi tạo từng phiếu riêng.</InlineAlert>}
      {/* Order bar like the selling screen: Hủy and Xác nhận (Design §12.8, §13.1), under the card that fills the screen height. */}
      <div
        className={clsx(
          // No top border and no shadow: the lines scroll inside their card, nothing passes under the buttons (Design §12.8).
          'flex shrink-0 flex-col gap-2 bg-white',
          page && '-mt-1 pb-[env(safe-area-inset-bottom)] sm:pb-0',
        )}
      >
        {error && !depositDialog && <InlineAlert tone="danger">{error}</InlineAlert>}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" full disabled={busy} onClick={cancel}>
            Hủy
          </Button>
          <Button variant="primary" size="lg" full disabled={mixed || busy} onClick={confirm}>
            Xác nhận
          </Button>
        </div>
      </div>
      {depositDialog && (
        // Like the payment dialog on the selling screen (Design §12.8, §13.4).
        <Dialog title="Thu cọc" size="sm" onClose={busy ? undefined : () => { setDepositDialog(false); setError(null); }}>
          <div className="flex flex-col gap-4">
            {/* Loại phiếu: a dropdown, Không cọc by default; fixed to Có cọc when a deposit is required (Design §12.8). */}
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-ink-700">Loại phiếu</span>
              <CompactSelect
                label="Loại phiếu"
                value={depositOpen ? 'deposit' : 'none'}
                disabled={required}
                options={[
                  ['none', 'Không cọc'],
                  ['deposit', 'Có cọc'],
                ]}
                onChange={(v) => setTakeDeposit(v === 'deposit')}
              />
            </div>
            {depositOpen && <DepositFields value={dep} onChange={setDep} />}
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-ink-700">Giá trị phiếu</p>
                <p className="text-xl leading-7 font-bold whitespace-nowrap num">{value > 0 ? formatVnd(value) : '—'}</p>
              </div>
              {required && <p className="text-right text-sm text-ink-700 num">Tối thiểu {formatVnd(minDeposit)}</p>}
            </div>
            {error && <InlineAlert tone="danger">{error}</InlineAlert>}
            <Button variant="primary" size="lg" full loading={busy} onClick={() => void save()}>
              Xác nhận
            </Button>
          </div>
        </Dialog>
      )}
      </div>
      {confirmCancel && (
        <ConfirmDialog
          title="Hủy phiếu đang tạo?"
          body="Khách và sách vừa nhập sẽ không được lưu."
          confirm="Hủy phiếu"
          cancel="Tiếp tục nhập"
          destructive
          onConfirm={async () => onCancel?.()}
          onClose={() => setConfirmCancel(false)}
        />
      )}
    </div>
  );
}

// =============================================================================================
// Slip dialog (Design §12.8)

export function PreorderRecord({ p, onClose }: { p: PreorderRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const shift = useOpenShift();
  const [step, setStep] = useState<null | 'update' | 'cancel'>(null);
  const manager = can(me, 'preorder.manage');
  const live = PREORDER_OPEN.includes(p.status);
  const canCancel = live && (p.depositVnd === 0 || manager);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['preorders'] });
    void qc.invalidateQueries({ queryKey: ['badges'] });
    onClose();
  };
  if (step === 'cancel') return <CancelPreorder p={p} shiftId={shift.data?.id ?? null} onClose={() => { setStep(null); refresh(); }} />;
  if (step === 'update') return <UpdateStatusDialog p={p} onClose={() => setStep(null)} onDone={refresh} />;
  return (
    <Dialog title={`Phiếu ${p.docNo}`} size="md" onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <Facts
          items={[
            ['Trạng thái', <PreorderChip p={p} />],
            ['Khách hàng', p.customerName],
            ['Điện thoại', p.customerPhone ? <a href={`tel:${p.customerPhone}`} className="font-semibold whitespace-nowrap text-navy-700 underline num">{formatPhone(p.customerPhone)}</a> : '—'],
            ['Tổng tiền', <span className="num">{p.unpriced ? '—' : formatVnd(p.totalVnd)}</span>],
            [
              'Đã cọc',
              p.depositVnd ? (
                <span className="inline-flex flex-col items-end">
                  <span className="num">{formatVnd(p.depositVnd)}</span>
                  {p.depositMethod && <span className="text-[13px] text-ink-500">{METHOD[p.depositMethod] ?? p.depositMethod}</span>}
                </span>
              ) : (
                '—'
              ),
            ],
            ['Thời gian', <span className="num">{formatDateTime(p.createdAt)}</span>],
            // Handed to delivery: the order it became (FR-ORD-14, Design §12.8).
            ...(p.orderId
              ? ([
                  [
                    'Đơn giao',
                    <Link to={`/orders/${p.orderId}`} className="font-semibold text-navy-700 underline code">
                      {p.orderDocNo}
                    </Link>,
                  ],
                ] as [string, React.ReactNode][])
              : []),
            ...(p.expiresAt && p.status === 'contacted' ? ([['Hạn giữ', <span className={clsx(isOverdue(p) && 'font-semibold text-danger-700')}>{formatDateTime(p.expiresAt)}</span>]] as [string, React.ReactNode][]) : []),
            ...(p.note ? ([['Ghi chú', p.note]] as [string, React.ReactNode][]) : []),
          ]}
        />
        <ul className="divide-y divide-paper-300 rounded-md border border-paper-300">
          {p.lines.map((l) => (
            <li key={l.lineId} className="flex items-baseline justify-between gap-3 p-3">
              <span className="min-w-0">
                <span className={clsx('block font-medium', l.freeText && 'italic')}>{l.title}</span>
                <span className="text-[13px] text-ink-500 num">x{formatNumber(l.qty)}</span>
              </span>
              <span className="font-medium whitespace-nowrap num">{l.unitPriceVnd != null && !l.freeText ? formatVnd(l.qty * l.unitPriceVnd) : '—'}</span>
            </li>
          ))}
        </ul>
        {live && (
          <div className={clsx('grid gap-2', canCancel && 'grid-cols-2')}>
            {canCancel && (
              <Button variant="destructive-outline" onClick={() => setStep('cancel')}>
                Hủy phiếu
              </Button>
            )}
            <Button variant="primary" onClick={() => setStep('update')}>
              Cập nhật
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

type Target = 'quote' | 'ordered' | 'arrived' | 'collected';
const TARGETS: { key: Target; label: string }[] = [
  { key: 'quote', label: 'Chờ xác nhận' },
  { key: 'ordered', label: 'Đang đặt hàng' },
  { key: 'arrived', label: 'Chờ nhận' },
  { key: 'collected', label: 'Đã nhận' },
];

/**
 * “Cập nhật”: staff set the status by hand from a dropdown (FR-ORD-14). Chờ nhận records Nhận tại quầy
 * or Giao hàng (with a note written by hand); Chờ nhận and Đã nhận need every free-text book linked to
 * a product, priced at its selling price; Đã nhận opens the POS with the slip in the cart.
 */
function UpdateStatusDialog({ p, onClose, onDone }: { p: PreorderRow; onClose: () => void; onDone: () => void }) {
  const navigate = useNavigate();
  const hold = p.status === 'contacted';
  const current: Target = p.status === 'confirmed' ? 'quote' : p.status === 'contacted' ? 'arrived' : (p.status as Target);
  const [target, setTarget] = useState<Target>(current);
  // Giao hàng only for an order slip, and only for staff who manage online orders; a hold is collected in store (FR-ORD-14).
  const { data: me } = useMe();
  const canDeliver = !hold && can(me, 'online.manage');
  const [delivery, setDelivery] = useState(false);
  const [links, setLinks] = useState<Record<string, ProductHit>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const free = p.lines.filter((l) => l.freeText);
  const needsLinks = (target === 'arrived' || target === 'collected') && free.length > 0;
  // A hold is Chờ nhận from the start.
  const options = hold ? TARGETS.filter((t) => t.key === 'arrived' || t.key === 'collected') : TARGETS;
  const save = async () => {
    setError(null);
    if (needsLinks && free.some((l) => !links[l.lineId])) return setError('Chọn sản phẩm cho mọi sách chưa có trong danh mục. Sách chưa có thì thêm ở trang Sản phẩm trước.');
    const body = { links: Object.entries(links).map(([lineId, h]) => ({ lineId, variantId: h.variantId })) };
    setBusy(true);
    try {
      if (target === 'collected') {
        // The POS sale marks the slip Đã nhận; an order is set to Chờ nhận first.
        if (!hold && (p.status !== 'arrived' || body.links.length)) await post(`/api/v1/preorders/${p.id}/status`, { status: 'arrived', ...body });
        navigate(`/pos?preorder=${encodeURIComponent(p.docNo)}`);
        return;
      }
      if (target === 'arrived' && delivery && canDeliver) {
        // Giao hàng: Chờ nhận first, then Tạo đơn giao filled from the slip (Design §12.8, §12.9).
        if (p.status !== 'arrived' || body.links.length) await post(`/api/v1/preorders/${p.id}/status`, { status: 'arrived', ...body });
        navigate(`/orders/new?preorder=${encodeURIComponent(p.docNo)}`);
        return;
      }
      if (target === 'arrived') await post(`/api/v1/preorders/${p.id}/status`, { status: 'arrived', ...body });
      else if (target !== current || body.links.length) await post(`/api/v1/preorders/${p.id}/status`, { status: target, ...body });
      toast.success(`Đã cập nhật ${p.docNo}: ${TARGETS.find((t) => t.key === target)!.label}.`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Cập nhật trạng thái"
      size="sm"
      onClose={onClose}
      footer={
        <Button variant="primary" full loading={busy} onClick={save}>
          {target === 'collected' ? 'Nhận hàng tại quầy' : 'Xác nhận'}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <SelectField label="Trạng thái" value={target} onChange={(e) => setTarget(e.target.value as Target)}>
          {options.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </SelectField>
        {target === 'arrived' && canDeliver && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2" role="radiogroup" aria-label="Cách nhận hàng">
              {(
                [
                  [false, 'Nhận tại quầy'],
                  [true, 'Giao hàng'],
                ] as const
              ).map(([v, label]) => (
                <label key={label} className="flex min-h-11 items-center gap-2 font-medium">
                  <input type="radio" name="preorder-delivery" className="size-[18px] accent-navy-700" checked={delivery === v} onChange={() => setDelivery(v)} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}
        {needsLinks &&
          free.map((l) => {
            const h = links[l.lineId];
            return (
              <div key={l.lineId} className="flex flex-col gap-2 rounded-md border border-paper-300 p-3">
                <p className="font-medium italic">
                  {l.title} · {formatNumber(l.qty)} cuốn
                </p>
                {h ? (
                  <p className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      {hitTitle(h)} <span className="text-ink-500 num">· {formatVnd(h.priceVnd)}</span>
                    </span>
                    <button type="button" className="text-ink-500 hover:text-danger-700" aria-label="Đổi sản phẩm" onClick={() => setLinks(({ [l.lineId]: _, ...rest }) => rest)}>
                      <X size={16} aria-hidden />
                    </button>
                  </p>
                ) : (
                  <ProductSearch hideSku placeholder="Chọn sản phẩm trong danh mục" onPick={(x) => setLinks((m) => ({ ...m, [l.lineId]: x }))} />
                )}
              </div>
            );
          })}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

/** Cancel; a slip with a deposit is the manager's call: refund (cash out of an open shift) or keep (FR-ORD-16). */
export function CancelPreorder({ p, shiftId, onClose }: { p: PreorderRow; shiftId: string | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [deposit, setDeposit] = useState<'refund' | 'forfeit'>('refund');
  const [ref, setRef] = useState('');
  return (
    <ConfirmDialog
      title={`Hủy ${p.docNo}?`}
      body="Sách đang giữ sẽ trở lại kệ. Không thể hoàn tác."
      confirm="Hủy phiếu"
      cancel="Giữ phiếu"
      destructive
      onClose={onClose}
      onConfirm={async () => {
        await post(`/api/v1/preorders/${p.id}/cancel`, { reason: reason.trim(), deposit, ...(shiftId && { shiftId }), ...(ref.trim() && { refundRef: ref.trim() }) });
        toast.success(`Đã hủy ${p.docNo}.`);
      }}
    >
      <TextArea label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} />
      {p.depositVnd > 0 && (
        <>
          <SelectField label={`Tiền cọc ${formatVnd(p.depositVnd)}`} value={deposit} onChange={(e) => setDeposit(e.target.value as 'refund' | 'forfeit')}>
            <option value="refund">Hoàn cọc cho khách</option>
            <option value="forfeit">Giữ cọc (khách mất cọc)</option>
          </SelectField>
          {deposit === 'refund' && p.depositMethod !== 'cash' && <Field label="Mã giao dịch hoàn tiền" required value={ref} onChange={(e) => setRef(e.target.value)} />}
          {deposit === 'refund' && p.depositMethod === 'cash' && (shiftId ? <p className="text-[13px] text-ink-500">Tiền mặt được chi ra từ ca đang mở.</p> : <InlineAlert tone="warning">Cần một ca đang mở để hoàn cọc tiền mặt. Hãy mở ca ở màn hình Bán hàng.</InlineAlert>)}
        </>
      )}
    </ConfirmDialog>
  );
}
