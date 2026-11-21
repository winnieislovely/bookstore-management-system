import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown, Minus, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ConfirmDialog, Facts, SelectField, TextArea, toast } from '../components/data';
import { CustomerPicker, type CustomerChoice } from '../components/customer-picker';
import { ProductSearch, hitTitle, type ProductHit } from '../components/product-search';
import { Button, Field, InlineAlert, StatusChip, type Tone } from '../components/ui';
import { post } from '../lib/api';
import { formatDateTime, formatNumber, formatPhone, formatVnd } from '../lib/format';
import { can, useMe } from '../lib/session';
import { useOpenShift } from '../lib/shift';
import type { CartCustomer, CartPreorder } from './cart';
import { Dialog, MoneyInput } from './widgets';

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
  delivery: boolean;
  deliveryNote: string | null;
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

function DepositFields({ value, onChange, hint }: { value: DepositState; onChange: (d: DepositState) => void; hint?: string }) {
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
            onClick={() => onChange({ ...value, method: k })}
            className={clsx('h-11 rounded-xl border text-sm font-medium', value.method === k ? 'border-2 border-navy-700 bg-navy-50 text-navy-700' : 'border-paper-500')}
          >
            {label}
          </button>
        ))}
      </div>
      <MoneyInput label="Tiền cọc" value={value.amountVnd} onChange={(v) => onChange({ ...value, amountVnd: v })} />
      {hint && <p className="-mt-2 text-[13px] text-ink-500 num">{hint}</p>}
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
      <NewPreorder initialCustomer={customer} shiftId={shiftId} onDone={onClose} />
    </Dialog>
  );
}

function NewPreorder({ initialCustomer, shiftId, onDone }: { initialCustomer: CartCustomer | null; shiftId: string | null; onDone: () => void }) {
  const qc = useQueryClient();
  const open = useOpenShift();
  const shift = { data: shiftId ? { id: shiftId } : open.data };
  const [cust, setCust] = useState<CustomerChoice>(initialCustomer ? { kind: 'existing', customer: { ...initialCustomer, tierName: null } as never } : null);
  const [items, setItems] = useState<Draft[]>([]);
  const [note, setNote] = useState('');
  // Thu cọc box: open or closed; its state reads Có once an amount is entered (Design §12.8).
  const [depOpen, setDepOpen] = useState<boolean | null>(null);
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
  const minDeposit = hold ? 0 : Math.round((value * 30) / 100);
  // A required deposit (an order) starts open; an optional one (a hold) starts closed.
  const depositOpen = depOpen ?? !hold;
  const hasDeposit = (dep.amountVnd ?? 0) > 0;
  const add = (h: ProductHit) =>
    setItems((xs) => (xs.some((x) => x.kind === 'product' && x.hit.variantId === h.variantId) ? xs.map((x) => (x.kind === 'product' && x.hit.variantId === h.variantId ? { ...x, qty: x.qty + 1 } : x)) : [...xs, { kind: 'product', hit: h, qty: 1 }]));
  const setQty = (i: number, qty: number) => setItems((xs) => (qty < 1 ? xs.filter((_, j) => j !== i) : xs.map((x, j) => (j === i ? { ...x, qty } : x))));
  const save = async () => {
    setError(null);
    if (!cust) return setError('Chọn khách hoặc nhập khách mới.');
    if (!items.length) return setError('Thêm sách khách muốn giữ hoặc đặt.');
    if (!hold && minDeposit > 0 && (dep.amountVnd ?? 0) < minDeposit) return setError(`Tiền cọc tối thiểu ${formatVnd(minDeposit)} (30%).`);
    if (dep.amountVnd && dep.method === 'cash' && !shift.data) return setError('Cần một ca đang mở để nhận cọc tiền mặt.');
    setBusy(true);
    try {
      const r = await post<{ docNo: string; status: string; expiresAt: string | null }>('/api/v1/preorders', {
        customer: cust.kind === 'existing' ? { customerId: cust.customer.id } : { name: cust.name.trim(), phone: cust.phone.trim() },
        lines: items.map((d) => (d.kind === 'product' ? { variantId: d.hit.variantId, qty: d.qty } : { title: d.title, qty: d.qty })),
        ...(dep.amountVnd ? { deposit: depositBody(dep, shift.data?.id ?? null) } : {}),
        ...(note.trim() && { note: note.trim() }),
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
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-ink-900">Khách hàng</h3>
        <CustomerPicker value={cust} onChange={setCust} />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-ink-900">Thông tin sản phẩm</h3>
        <ProductSearch onPick={add} hideSku placeholder="Nhập SKU / tên sách / ISBN" onFreeText={(title) => setItems((xs) => [...xs, { kind: 'text', title, qty: 1 }])} />
        {items.length > 0 && (
          <ul className="divide-y divide-paper-300 rounded-md border border-paper-300">
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
      {mixed ? (
        <InlineAlert tone="warning">Một phiếu chỉ gồm sách có sẵn (giữ sách) hoặc sách cần đặt. Bỏ bớt sách rồi tạo từng phiếu riêng.</InlineAlert>
      ) : (
        items.length > 0 && (
          <div className="rounded-md border border-paper-300">
            <button type="button" className="flex min-h-12 w-full items-center gap-2 px-3 text-left text-sm" aria-expanded={depositOpen} onClick={() => setDepOpen(!depositOpen)}>
              <span className="flex-1 font-medium">
                Thu cọc{!hold && minDeposit > 0 && <span className="font-normal text-ink-500"> · bắt buộc</span>}
              </span>
              <span className={hasDeposit ? 'font-semibold text-success-700' : 'text-ink-500'}>{hasDeposit ? 'Có' : 'Không'}</span>
              <ChevronDown size={16} className={clsx('text-ink-500 transition-transform', depositOpen && 'rotate-180')} aria-hidden />
            </button>
            {depositOpen && (
              <div className="border-t border-paper-300 p-3">
                <DepositFields
                  value={dep}
                  onChange={setDep}
                  hint={
                    hold
                      ? `Không bắt buộc – có cọc thì giữ lâu hơn. Tối đa ${formatVnd(value)}`
                      : minDeposit > 0
                        ? `Tối thiểu ${formatVnd(minDeposit)} (30%)${items.some((d) => d.kind === 'text') ? ' – sách chưa có trong danh mục chưa tính' : ` · trả đủ ${formatVnd(value)}`}`
                        : 'Sách chưa có trong danh mục: không bắt buộc cọc tối thiểu.'
                  }
                />
              </div>
            )}
          </div>
        )
      )}
      <TextArea label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <Button variant="primary" size="lg" full loading={busy} disabled={mixed} onClick={save}>
        {hold ? 'Giữ sách' : 'Lưu phiếu'}
      </Button>
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
            ...(isReady(p)
              ? ([
                  [
                    'Nhận hàng',
                    <span className="inline-flex flex-col items-end">
                      <span>{p.delivery ? 'Giao hàng' : 'Tại quầy'}</span>
                      {p.delivery && p.deliveryNote && <span className="text-[13px] text-ink-500">{p.deliveryNote}</span>}
                    </span>,
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
  const [delivery, setDelivery] = useState(p.delivery);
  const [deliveryNote, setDeliveryNote] = useState(p.deliveryNote ?? '');
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
      if (target === 'arrived') await post(`/api/v1/preorders/${p.id}/status`, { status: 'arrived', ...body, delivery, deliveryNote: delivery ? deliveryNote.trim() || null : null });
      else if (target !== current || body.links.length) await post(`/api/v1/preorders/${p.id}/status`, { status: target, ...body });
      toast.success(`Đã cập nhật ${p.docNo}: ${TARGETS.find((t) => t.key === target)!.label}${target === 'arrived' ? (delivery ? ' · Giao hàng' : ' · Nhận tại quầy') : ''}.`);
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
          {target === 'collected' ? 'Nhận hàng tại quầy' : 'Lưu'}
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
        {target === 'arrived' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2" role="group" aria-label="Cách nhận hàng">
              {(
                [
                  [false, 'Nhận tại quầy'],
                  [true, 'Giao hàng'],
                ] as const
              ).map(([v, label]) => (
                <label key={label} className="flex min-h-11 items-center gap-2 font-medium">
                  <input type="checkbox" className="size-5 accent-navy-700" checked={delivery === v} onChange={() => setDelivery(v)} />
                  {label}
                </label>
              ))}
            </div>
            {delivery && <TextArea label="Ghi chú giao hàng" value={deliveryNote} maxLength={500} onChange={(e) => setDeliveryNote(e.target.value)} />}
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
