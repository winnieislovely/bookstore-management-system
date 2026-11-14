import { barcodeSvg, BORROW_BLOCK_TEXT, cutterNumber, deweyCategory, discountedLoanFees, dueAfter, escapeXml, normalizeDewey, vietnameseNaturalOrder, type BorrowBlock, type LoanDiscount } from '@bookstore/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertOctagon, ArrowLeftRight, BookmarkCheck, CheckCircle2, ChevronDown, Library, Phone, Plus, Printer, ScanBarcode, Search, Truck, User, UserPlus, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ConfirmDialog, DataTable, Facts, FilterMenu, SearchBox, SelectField, TextArea, TimeFilter, errText, timeDays, timeLabel, toast, useDebounced, useParam, type Column } from '../components/data';
import { BookLookup, type BookResult } from '../components/bookLookup';
import { ProductSearch } from '../components/product-search';
import { Button, Card, EmptyState, ErrorState, Field, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { ApiError, get, patch, post } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, formatPhone, formatVnd } from '../lib/format';
import { printHtml } from '../lib/print';
import { can, useMe } from '../lib/session';
import { CameraScanner, Dialog, MoneyInput } from '../pos/widgets';

/** Library (SRS §3.9, Design §13.8): borrow / return, catalogue and copies, report, customer tab. */

// =============================================================================================
// Shared types and labels

export const COPY_STATUS: Record<string, { label: string; tone: Tone; icon?: typeof BookmarkCheck }> = {
  available: { label: 'Còn', tone: 'success' },
  reserved: { label: 'Đã giữ', tone: 'accent', icon: BookmarkCheck },
  on_loan: { label: 'Đang mượn', tone: 'info' },
  lost: { label: 'Mất', tone: 'danger', icon: AlertOctagon },
  damaged: { label: 'Hỏng', tone: 'danger', icon: AlertOctagon },
};
const LANG: Record<string, string> = { vi: 'VN', en: 'EN' };
const CHARGE: Record<string, string> = { loan_fee: 'Phí mượn', late_fee: 'Phí trả trễ', lost: 'Phí mất sách', damage: 'Phí hỏng sách' };
const CHARGE_STATUS: Record<string, { label: string; tone: Tone }> = {
  unpaid: { label: 'Chưa thu', tone: 'warning' },
  paid: { label: 'Đã thu', tone: 'success' },
  waived: { label: 'Đã miễn', tone: 'neutral' },
  cancelled: { label: 'Đã hủy', tone: 'neutral' },
};

interface Loan {
  id: string;
  copyId: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  titleId: string;
  callNo: string | null;
  title: string;
  barcode: string;
  loanedAt: string;
  dueAt: string;
  returnedAt: string | null;
  closedAs: string | null;
  renewals: number;
  renewalsLeft: number;
  overdue: boolean;
  daysLate: number;
  lateFeeVnd: number;
}

interface Hold {
  id: string;
  titleId: string;
  callNo: string | null;
  title: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  status: string;
  queuedAt: string;
  holdUntil: string | null;
  barcode: string | null;
  position: number | null;
}

interface Charge {
  id: string;
  kind: string;
  listVnd: number;
  discountPct: number;
  amountVnd: number;
  status: string;
  reason: string | null;
  createdAt: string;
  paidAt: string | null;
  /** Desk receipt (PT-…), or the POS sale for charges paid before 4 Nov 2026. */
  receiptNo: string | null;
  callNo: string | null;
  title: string | null;
  barcode: string | null;
}

interface Borrower {
  customer: { id: string; name: string; phone: string | null };
  openLoans: Loan[];
  history: Loan[];
  overdueLoans: number;
  unpaidChargesVnd: number;
  maxLoans: number;
  blocks: BorrowBlock[];
  spendVnd: number;
  fee: { listVnd: number; discountPct: number; amountVnd: number };
  discountSpendVnd: number;
  loanDays: number;
  charges: Charge[];
  reservations: Hold[];
}

interface CopyHit {
  id: string;
  barcode: string;
  status: string;
  shelf: string | null;
  callNo: string | null;
  title: string;
}

interface TitleRow {
  id: string;
  /** Call number (`891.733 D67c`), null while unclassified. */
  callNo: string | null;
  dewey: string | null;
  cutter: string | null;
  title: string;
  authors: string[];
  language: string;
  category: string | null;
  copies: number;
  available: number;
  queued: number;
  onLoan: number;
  /** Earliest due date of an open loan of the title. */
  nextDueAt: string | null;
}

/** A title with no copy on the shelf, reserved on the borrow form (FR-LIB-13). */
type HoldLine = { titleId: string; callNo: string | null; title: string; nextDueAt: string | null; queued: number };

/** Call number as shown in lists; unclassified titles say so (FR-LIB-01). */
const callNoText = (c: string | null | undefined) => c ?? 'Chưa phân loại';

function CallNo({ value }: { value: string | null }) {
  return value ? <span className="code font-medium">{value}</span> : <StatusChip tone="neutral">Chưa phân loại</StatusChip>;
}
/** Out of copies but some are lent, so a reservation makes sense. */
const reservable = (t: TitleRow) => t.available === 0 && t.onLoan > 0;

function CallLink({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-ink-500">—</span>;
  return (
    <a href={`tel:${phone}`} className="inline-flex items-center gap-1 whitespace-nowrap text-navy-700 underline-offset-2 hover:underline num" onClick={(e) => e.stopPropagation()}>
      <Phone size={14} aria-hidden />
      {formatPhone(phone)}
    </a>
  );
}

function CopyChip({ status }: { status: string }) {
  const s = COPY_STATUS[status] ?? { label: status, tone: 'neutral' as Tone };
  return (
    <StatusChip tone={s.tone} icon={s.icon}>
      {s.label}
    </StatusChip>
  );
}

function DueCell({ loan }: { loan: Pick<Loan, 'dueAt' | 'overdue' | 'daysLate'> }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="num">{formatDate(loan.dueAt)}</span>
      {loan.overdue && (
        <StatusChip tone="danger" icon={AlertOctagon}>
          Quá hạn {loan.daysLate} ngày
        </StatusChip>
      )}
    </span>
  );
}

/** Ưu đãi on the borrow form: a number with a % / ₫ switch (FR-LIB-18, Design §13.8). */
function DiscountInput({ value, onChange, disabled }: { value: LoanDiscount | null; onChange: (d: LoanDiscount) => void; disabled?: boolean }) {
  const kind = value?.kind ?? 'vnd';
  const text = value && value.value > 0 ? formatNumber(value.value) : '';
  return (
    <span className="flex w-full items-center justify-between gap-3">
      {/* The kind is a dropdown on the left, the value on the right (Design §13.8). */}
      <select
        className="h-9 rounded-md border border-paper-500 bg-white pr-8 pl-2 text-sm focus:border-navy-700 disabled:bg-paper-100"
        aria-label="Kiểu ưu đãi"
        disabled={disabled}
        value={kind}
        onChange={(e) => onChange({ kind: e.target.value as LoanDiscount['kind'], value: 0 })}
      >
        <option value="vnd">Giảm theo số tiền (₫)</option>
        <option value="pct">Giảm theo phần trăm (%)</option>
      </select>
      <span className="relative">
      <input
        className="h-9 w-32 rounded-md border border-paper-500 bg-white pr-7 pl-2 text-right num focus:border-navy-700 disabled:bg-paper-100"
        inputMode="numeric"
        aria-label={kind === 'pct' ? 'Ưu đãi theo phần trăm' : 'Ưu đãi theo số tiền'}
        placeholder="0"
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '');
          onChange({ kind, value: digits ? Number(digits) : 0 });
        }}
      />
      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-sm text-ink-500">{kind === 'pct' ? '%' : '₫'}</span>
      </span>
    </span>
  );
}

// =============================================================================================
// Borrower picker: customer by phone or name, or a new one (FR-LIB-05, UC-17 step 1)

interface PickedCustomer {
  id: string;
  name: string;
  phoneE164: string | null;
}

function BorrowerPicker({ value, onChange }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void }) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState<{ name: string; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const term = useDebounced(q.trim(), 300);
  const found = useQuery({ queryKey: ['library-borrower-search', term], enabled: term.length >= 2 && !value, queryFn: () => get<{ items: PickedCustomer[] }>('/api/v1/customers', { q: term, limit: 6 }) });
  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-paper-300 p-3 text-sm">
        <User size={20} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{value.name}</span>
          <span className="text-ink-500 num">{value.phoneE164 && formatPhone(value.phoneE164)}</span>
        </span>
        <Button variant="ghost" icon={X} aria-label="Chọn khách khác" onClick={() => onChange(null)} />
      </div>
    );
  }
  if (creating) {
    const create = async () => {
      setError(null);
      try {
        const r = await post<{ id: string }>('/api/v1/customers', { name: creating.name.trim(), phone: creating.phone.trim() });
        onChange({ id: r.id, name: creating.name.trim(), phoneE164: null });
      } catch (e) {
        setError(errText(e));
      }
    };
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Số điện thoại" required inputMode="tel" value={creating.phone} onChange={(e) => setCreating({ ...creating, phone: e.target.value })} />
          <Field label="Họ tên" required value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" disabled={!creating.name.trim() || creating.phone.replace(/\D/g, '').length < 9} onClick={create}>
            Tạo khách hàng
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setCreating(null)}>
            Tìm khách cũ
          </Button>
        </div>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    );
  }
  const items = found.data?.items ?? [];
  const digits = q.replace(/\D/g, '');
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
      <Search size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />
      <input
        className="h-11 w-full rounded-md border border-paper-500 bg-white pr-3 pl-10 focus:border-navy-700"
        placeholder="Nhập số điện thoại/tên khách"
        aria-label="Số điện thoại hoặc tên khách"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      </div>
      {term.length >= 2 && found.data && (
        <ul className="divide-y divide-paper-300 rounded-md border border-paper-300">
          {items.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">Không có khách phù hợp.</li>}
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-navy-50" onClick={() => onChange(c)}>
                <span className="min-w-0 flex-1 font-medium">{c.name}</span>
                <span className="whitespace-nowrap text-ink-500 num">{c.phoneE164 && formatPhone(c.phoneE164)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="tonal" size="sm" icon={UserPlus} className="self-start" onClick={() => setCreating({ phone: digits.length >= 6 ? q.trim() : '', name: digits.length >= 6 ? '' : q.trim() })}>
        Khách mới
      </Button>
    </div>
  );
}

// =============================================================================================
// Payment at the library desk (FR-LIB-09a, Design §13.8): cash, transfer (reference) or card (approval code)

/** Cash or bank transfer only, no reference to type (FR-LIB-09a). */
export type DeskPayment = { method: 'cash' | 'transfer' };
export const PAYMENT_METHOD: Record<DeskPayment['method'], string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản' };
/** Labels for cash-book rows, including card receipts taken before 5 Nov 2026. */
export const PAYMENT_METHOD_LABEL: Record<string, string> = { ...PAYMENT_METHOD, card: 'Thẻ' };
const paymentBody = (p: DeskPayment) => ({ method: p.method });
const paymentReady = (_p: DeskPayment) => true;

function PaymentFields({ totalVnd, value, onChange, showTotal = true }: { totalVnd: number; value: DeskPayment; onChange: (p: DeskPayment) => void; showTotal?: boolean }) {
  // Own radio group per form: the borrow form and the Thu phí dialog can be open together.
  const name = useId();
  return (
    <div className="flex flex-col gap-3">
      {showTotal && (
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-ink-700">Số tiền cần thu</span>
          <span className="text-lg font-semibold num">{formatVnd(totalVnd)}</span>
        </div>
      )}
      {/* Radio ticks (Design §13.8). */}
      <fieldset className="flex gap-6">
        <legend className="sr-only">Phương thức thanh toán</legend>
        {(Object.keys(PAYMENT_METHOD) as DeskPayment['method'][]).map((m) => (
          <label key={m} className="inline-flex h-10 items-center gap-2 text-sm">
            <input type="radio" name={name} className="size-[18px] accent-navy-700" checked={value.method === m} onChange={() => onChange({ method: m })} />
            {PAYMENT_METHOD[m]}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/** “Thu phí”: owed charges of one borrower collected at the desk (FR-LIB-09a). */
export function PayChargesDialog({ customerId, onClose, onDone }: { customerId: string; onClose: () => void; onDone?: () => void }) {
  const qc = useQueryClient();
  const b = useQuery({ queryKey: ['library-borrower', customerId], queryFn: () => get<Borrower>(`/api/v1/library/borrowers/${customerId}`) });
  const owed = (b.data?.charges ?? []).filter((c) => c.status === 'unpaid');
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [payment, setPayment] = useState<DeskPayment>({ method: 'cash' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = owed.filter((c) => !skip.has(c.id));
  const total = chosen.reduce((a, c) => a + c.amountVnd, 0);
  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ docNo: string; amountVnd: number }>('/api/v1/library/charges/pay', { customerId, chargeIds: chosen.map((c) => c.id), payment: paymentBody(payment) });
      toast.success(`Đã thu ${formatVnd(r.amountVnd)} – phiếu ${r.docNo}.`);
      void qc.invalidateQueries({ queryKey: ['library-borrower'] });
      void qc.invalidateQueries({ queryKey: ['library-loans'] });
      void qc.invalidateQueries({ queryKey: ['library-payments'] });
      onDone?.();
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Thu phí${b.data ? ` – ${b.data.customer.name}` : ''}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!chosen.length || !paymentReady(payment)} onClick={pay}>
            Thu tiền
          </Button>
        </>
      }
    >
      {!b.data ? (
        <Skeleton className="h-24" />
      ) : owed.length === 0 ? (
        <p className="text-sm text-ink-700">Khách không còn khoản nào chưa thu.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="divide-y divide-paper-300 rounded-md border border-paper-300">
            {owed.map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input type="checkbox" className="size-[18px] accent-navy-700" checked={!skip.has(c.id)} onChange={() => setSkip((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
                  <span className="min-w-0 flex-1">
                    {CHARGE[c.kind] ?? c.kind}
                    {c.barcode && <span className="text-ink-500"> · {c.barcode}</span>}
                  </span>
                  <span className="font-semibold num">{formatVnd(c.amountVnd)}</span>
                </label>
              </li>
            ))}
          </ul>
          <PaymentFields totalVnd={total} value={payment} onChange={setPayment} />
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
      )}
    </Dialog>
  );
}

/** Eligibility card (UC-17 step 2): loans out of the limit, overdue, unpaid charges, buyer discount. */
function EligibilityCard({ b, onPay }: { b: Borrower; onPay?: () => void }) {
  const ok = b.blocks.length === 0;
  return (
    <div className={`flex flex-col gap-2 rounded-lg p-4 text-sm ${ok ? 'bg-success-50' : 'bg-danger-50'}`}>
      <p className="flex items-center gap-2 font-semibold">
        {ok ? <CheckCircle2 size={18} className="text-success-700" aria-hidden /> : <AlertOctagon size={18} className="text-danger-700" aria-hidden />}
        {ok ? 'Được mượn' : 'Chưa mượn được'}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-ink-700 num">
        <span>
          Đang mượn {b.openLoans.length}/{b.maxLoans}
        </span>
        {b.overdueLoans > 0 && <span className="text-danger-700">{b.overdueLoans} cuốn quá hạn</span>}
        {b.unpaidChargesVnd > 0 && <span className="text-danger-700">Còn nợ {formatVnd(b.unpaidChargesVnd)}</span>}
      </div>
      {b.blocks.map((k) => (
        <p key={k} className="text-danger-700">
          {BORROW_BLOCK_TEXT[k]}
        </p>
      ))}
      {b.unpaidChargesVnd > 0 && onPay && (
        <Button size="sm" variant="secondary" className="self-start" onClick={onPay}>
          Thu phí
        </Button>
      )}
      {b.fee.discountPct > 0 && (
        <p className="flex flex-wrap items-center gap-2">
          <StatusChip tone="success">Giảm {b.fee.discountPct}% phí mượn</StatusChip>
          <span className="text-ink-500 num">Đã mua {formatVnd(b.spendVnd)}</span>
        </p>
      )}
    </div>
  );
}

// =============================================================================================
// Borrow (FR-LIB-07, UC-17)

function BorrowDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [scan, setScan] = useState('');
  const [camera, setCamera] = useState(false);
  // Copies on the shelf matching the code or title typed (Design §13.8).
  const scanTerm = useDebounced(scan.trim(), 250);
  const shelfMatches = useQuery({
    queryKey: ['library-copies', 'available', scanTerm],
    enabled: scanTerm.length >= 2,
    queryFn: () => get<{ items: CopyHit[] }>('/api/v1/library/copies', { q: scanTerm, status: 'available' }),
  });
  // Titles with no copy on the shelf matching the text, offered as reservations (FR-LIB-13).
  const outTitles = useQuery({
    queryKey: ['library-titles', 'reservable', scanTerm],
    enabled: scanTerm.length >= 2,
    queryFn: () => get<{ items: TitleRow[] }>('/api/v1/library/titles', { q: scanTerm, limit: 10 }),
  });
  const [copies, setCopies] = useState<{ barcode: string; title: string; callNo: string | null }[]>([]);
  const [holds, setHolds] = useState<HoldLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ totalFeeVnd: number; dueAt: string; count: number; holds: { callNo: string | null; title: string; position: number }[] } | null>(null);
  const [payment, setPayment] = useState<DeskPayment>({ method: 'cash' });
  const [payOwed, setPayOwed] = useState(false);
  const b = useQuery({ queryKey: ['library-borrower', customer?.id], enabled: !!customer, queryFn: () => get<Borrower>(`/api/v1/library/borrowers/${customer!.id}`) });
  // Ưu đãi entered by hand; until then the buyer discount applies (FR-LIB-18). Reset per borrower.
  const [manual, setManual] = useState<{ customerId: string; d: LoanDiscount } | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const discount: LoanDiscount | null = b.data ? (manual?.customerId === b.data.customer.id ? manual.d : b.data.fee.discountPct > 0 ? { kind: 'pct', value: b.data.fee.discountPct } : { kind: 'vnd', value: 0 }) : null;
  const listTotal = b.data ? b.data.fee.listVnd * copies.length : 0;
  const discountTooHigh = !!discount && (discount.kind === 'pct' ? discount.value > 100 : discount.value > listTotal);
  const feeTotal = b.data && discount && !discountTooHigh ? discountedLoanFees(b.data.fee.listVnd, copies.length, discount).amounts.reduce((a, x) => a + x, 0) : listTotal;
  const pick = (c: CopyHit) => {
    setScan('');
    setError(null);
    if (!copies.some((x) => x.barcode === c.barcode)) setCopies((cs) => [...cs, { barcode: c.barcode, title: c.title, callNo: c.callNo }]);
  };
  const pickHold = (t: TitleRow) => {
    setScan('');
    setError(null);
    if (!holds.some((x) => x.titleId === t.id)) setHolds((hs) => [...hs, { titleId: t.id, callNo: t.callNo, title: t.title, nextDueAt: t.nextDueAt, queued: t.queued }]);
  };
  /**
   * Enter or scan: an exact copy code is added; a title code or title adds its only copy on the
   * shelf, or leaves the matches listed to pick; a title with every copy out becomes a reservation
   * line (FR-LIB-13); otherwise say why nothing can be lent.
   */
  const add = async (raw = scan) => {
    const text = raw.trim();
    if (!text) return;
    setError(null);
    try {
      const exact = await get<CopyHit>(`/api/v1/library/copies/by-barcode/${encodeURIComponent(text)}`).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      });
      if (exact) {
        if (exact.status !== 'available' && exact.status !== 'reserved') {
          setError(`Bản ${exact.barcode} đang ${COPY_STATUS[exact.status]?.label.toLowerCase() ?? exact.status}, không cho mượn được.`);
          return;
        }
        pick(exact);
        return;
      }
      const shelf = (await get<{ items: CopyHit[] }>('/api/v1/library/copies', { q: text, status: 'available' })).items.filter((c) => !copies.some((x) => x.barcode === c.barcode));
      if (shelf.length === 1) return pick(shelf[0]!);
      if (shelf.length > 1) {
        setScan(text);
        return; // the list under the field lets staff choose the copy
      }
      const titles = (await get<{ items: TitleRow[] }>('/api/v1/library/titles', { q: text, limit: 10 })).items;
      const out = titles.filter(reservable);
      if (out.length === 1) return pickHold(out[0]!);
      if (out.length > 1) {
        setScan(text);
        return; // the list under the field lets staff choose the title to reserve
      }
      const t = titles[0];
      setError(
        !t
          ? `Không tìm thấy sách có mã hoặc tên “${text}”.`
          : t.copies === 0
            ? `Đầu sách “${t.title}” chưa có bản sách nào. Thêm bản ở Quản lý đầu sách trước khi cho mượn.`
            : `Mọi bản của “${t.title}” đang được giữ hoặc không dùng được.`,
      );
    } catch (e) {
      setError(errText(e));
    }
  };
  const suggestions = scanTerm.length >= 2 ? (shelfMatches.data?.items ?? []).filter((c) => !copies.some((x) => x.barcode === c.barcode)) : [];
  const holdSuggestions = scanTerm.length >= 2 ? (outTitles.data?.items ?? []).filter((t) => reservable(t) && !holds.some((x) => x.titleId === t.id)) : [];
  /** A form with reservations only is a reservation slip: no fee, no payment (Design §13.8). */
  const holdsOnly = copies.length === 0 && holds.length > 0;
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      // The loan fee is taken at the desk before the loans are recorded (FR-LIB-07, FR-LIB-09a).
      const r = await post<{ totalFeeVnd: number; dueAt: string; loans: unknown[]; holds: { callNo: string | null; title: string; position: number }[] }>('/api/v1/library/loans/checkout', {
        customerId: customer!.id,
        barcodes: copies.map((c) => c.barcode),
        holdTitleIds: holds.map((h) => h.titleId),
        ...(copies.length > 0 && { payment: paymentBody(payment), ...(discount && { discount }) }),
      });
      setDone({ totalFeeVnd: r.totalFeeVnd, dueAt: r.dueAt, count: r.loans.length, holds: r.holds });
      void qc.invalidateQueries({ queryKey: ['library-loans'] });
      void qc.invalidateQueries({ queryKey: ['library-titles'] });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    const heading = done.count > 0 ? 'Đã cho mượn' : 'Đã đặt giữ';
    return (
      <Dialog title={heading} size="sm" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Xong</Button>}>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-success-50 text-success-700">
            <CheckCircle2 size={36} aria-hidden />
          </span>
          <p className="text-lg font-semibold">{heading}</p>
          {/* Labels left, values right (Design §13.8). */}
          {done.count > 0 && (
            <dl className="grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-left text-sm">
              <dt className="text-ink-700">Số cuốn</dt>
              <dd className="text-right font-semibold num">{formatNumber(done.count)}</dd>
              <dt className="text-ink-700">Hạn trả</dt>
              <dd className="text-right font-semibold num">{formatDate(done.dueAt)}</dd>
              <dt className="text-ink-700">Phí mượn</dt>
              <dd className="text-right font-semibold num">{formatVnd(done.totalFeeVnd)}</dd>
            </dl>
          )}
          {done.holds.length > 0 && (
            <div className={clsx('flex w-full flex-col gap-2 text-left text-sm', done.count > 0 && 'border-t border-paper-300 pt-3')}>
              {done.count > 0 && <p className="font-semibold">Đặt giữ</p>}
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2">
                {done.holds.map((h) => (
                  <div key={`${h.title}-${h.position}`} className="contents">
                    <dt className="min-w-0 text-ink-700">
                      {h.title} {h.callNo && <span className="text-ink-500">· {h.callNo}</span>}
                    </dt>
                    <dd className="text-right font-semibold whitespace-nowrap num">Thứ {h.position} trong hàng chờ</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </Dialog>
    );
  }
  const data = b.data;
  const due = data ? dueAfter(new Date(), data.loanDays) : null;
  // Reservations do not count toward the loan limit (FR-LIB-13).
  const blocks = data ? data.blocks.filter((k) => copies.length > 0 || k !== 'limit_reached') : [];
  // Copies held for this borrower, offered first (UC-17 step 3).
  const heldForMe = (data?.reservations ?? []).filter((r) => r.status === 'held' && r.barcode && !copies.some((c) => c.barcode === r.barcode));
  return (
    <Dialog
      title={holdsOnly ? 'Phiếu giữ sách' : 'Phiếu mượn sách'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!data || blocks.length > 0 || copies.length + holds.length === 0 || discountTooHigh || !paymentReady(payment)} onClick={confirm}>
            Xác nhận
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-ink-700">1. Thông tin người mượn</h3>
          <BorrowerPicker
            value={customer}
            onChange={setCustomer}
          />
          {b.isLoading && customer && <Skeleton className="h-20" />}
          {b.error && <ErrorState error={b.error} onRetry={() => b.refetch()} />}
          {data && <EligibilityCard b={data} onPay={() => setPayOwed(true)} />}
          {payOwed && customer && <PayChargesDialog customerId={customer.id} onClose={() => setPayOwed(false)} onDone={() => void b.refetch()} />}
        </section>
        {/* Every section is shown from the start (Design §13.8). */}
        <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-ink-700">2. Thông tin sách mượn</h3>
            {heldForMe.length > 0 && (
              <div className="flex flex-col gap-1 rounded-md border border-olive-100 bg-olive-50 px-3 py-2 text-sm">
                <p className="font-semibold">Sách đang giữ cho khách</p>
                {heldForMe.map((r) => (
                  <div key={r.id} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      {r.title} <span className="text-ink-500">· {r.barcode}</span>
                    </span>
                    <Button size="sm" variant="secondary" onClick={() => setCopies((cs) => [...cs, { barcode: r.barcode!, title: r.title, callNo: r.callNo }])}>
                      Lấy sách
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <div className="relative min-w-0 flex-1">
                <Search size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />
                <input
                  className="h-11 w-full rounded-md border border-paper-500 bg-white pr-3 pl-10 focus:border-navy-700"
                  placeholder="Nhập mã cá biệt/tên sách"
                  aria-label="Mã cá biệt"
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                />
              </div>
              <button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-navy-700 hover:bg-navy-50" aria-label="Quét mã bằng camera" onClick={() => setCamera(true)}>
                <ScanBarcode size={24} aria-hidden />
              </button>
            </form>
            {suggestions.length + holdSuggestions.length > 0 && (
              <ul className="max-h-56 divide-y divide-paper-300 overflow-y-auto rounded-md border border-paper-300">
                {suggestions.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-navy-50" onClick={() => pick(c)}>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{c.title}</span>
                        <span className="text-ink-500">
                          {c.barcode}
                          {c.shelf ? ` · kệ ${c.shelf}` : ''}
                        </span>
                      </span>
                      <Plus size={16} className="text-ink-500" aria-hidden />
                    </button>
                  </li>
                ))}
                {holdSuggestions.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-navy-50" onClick={() => pickHold(t)}>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{t.title}</span>
                        <span className="text-ink-500">
                          {callNoText(t.callNo)}
                          {t.nextDueAt ? ` · có lại ${formatDate(t.nextDueAt)}` : ''}
                        </span>
                      </span>
                      <StatusChip tone="neutral">Hết bản</StatusChip>
                      <BookmarkCheck size={16} className="text-ink-500" aria-label="Đặt giữ" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {camera && (
              <CameraScanner
                onCode={(code) => {
                  setCamera(false);
                  void add(code);
                }}
                onClose={() => setCamera(false)}
              />
            )}
            {copies.length + holds.length === 0 && <p className="text-sm text-ink-500">Chưa có sách nào.</p>}
            {copies.length + holds.length > 0 && (
              <ul className="divide-y divide-paper-300 rounded-md border border-paper-300">
                {copies.map((c) => (
                  <li key={c.barcode} className="flex items-start gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{c.title}</span>
                      {/* The copy's library code, with its loan fee on the same line (Design §13.8). */}
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-ink-500">{c.barcode}</span>
                        {/* Fee before discount; Ưu đãi is applied in Thanh toán (Design §13.8). */}
                        {data ? <span className="font-semibold whitespace-nowrap num">{formatVnd(data.fee.listVnd)}</span> : <span className="text-ink-500">—</span>}
                      </span>
                    </span>
                    <Button variant="ghost" size="sm" icon={X} aria-label="Bỏ cuốn này" onClick={() => setCopies((cs) => cs.filter((x) => x.barcode !== c.barcode))} />
                  </li>
                ))}
                {/* Reservation lines: no fee (FR-LIB-13, Design §13.8). */}
                {holds.map((h) => (
                  <li key={h.titleId} className="flex items-start gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{h.title}</span>
                      <span className="flex items-center justify-between gap-3">
                        <span className="text-ink-500">{callNoText(h.callNo)}</span>
                        <StatusChip tone="accent" icon={BookmarkCheck}>
                          Đặt giữ
                        </StatusChip>
                      </span>
                      <span className="block text-ink-500">
                        {h.nextDueAt ? `Dự kiến có lại ${formatDate(h.nextDueAt)} · ` : ''}thứ {h.queued + 1} trong hàng chờ
                      </span>
                    </span>
                    <Button variant="ghost" size="sm" icon={X} aria-label="Bỏ đặt giữ" onClick={() => setHolds((hs) => hs.filter((x) => x.titleId !== h.titleId))} />
                  </li>
                ))}
              </ul>
            )}
            {data && copies.length + data.openLoans.length > data.maxLoans && <InlineAlert tone="warning">Khách chỉ được mượn tối đa {data.maxLoans} cuốn cùng lúc.</InlineAlert>}
        </section>
        {!holdsOnly && (
        <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-ink-700">3. Thanh toán</h3>
            {/* Due date and fee sit with the payment, labels left and values right (Design §13.8). */}
            <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 rounded-md bg-paper-100 px-3 py-2 text-sm">
              <span>Hạn trả</span>
              <span className="text-right font-semibold num">{due ? formatDate(due) : '—'}</span>
              <span>Số lượng</span>
              <span className="text-right font-semibold num">{formatNumber(copies.length)}</span>
              <span>Phí mượn</span>
              <span className="text-right font-semibold num">{data && copies.length ? formatVnd(listTotal) : '—'}</span>
              {/* Ưu đãi folds open with an arrow to choose % or ₫ and enter the value (Design §13.8). */}
              <button
                type="button"
                className="col-span-2 -mx-1 flex items-center justify-between gap-3 rounded px-1 py-0.5 text-left hover:bg-paper-200"
                aria-expanded={discountOpen}
                onClick={() => setDiscountOpen((o) => !o)}
              >
                <span className="inline-flex items-center gap-1">
                  Ưu đãi
                  <ChevronDown size={16} className={clsx('text-ink-500 transition-transform', discountOpen && 'rotate-180')} aria-hidden />
                </span>
                <span className={clsx('font-semibold num', listTotal > feeTotal && !discountTooHigh ? 'text-success-700' : 'text-ink-500')}>
                  {data && copies.length > 0 && !discountTooHigh && listTotal > feeTotal ? `−${formatVnd(listTotal - feeTotal)}` : '—'}
                </span>
              </button>
              {discountOpen && (
                <div className="col-span-2">
                  <DiscountInput value={discount} disabled={!data} onChange={(d) => data && setManual({ customerId: data.customer.id, d })} />
                </div>
              )}
              <span className="font-semibold">Tổng phí mượn</span>
              <span className="text-right text-base font-semibold num">{data && copies.length ? formatVnd(feeTotal) : '—'}</span>
            </div>
            {discountTooHigh && <InlineAlert tone="danger">Ưu đãi không được lớn hơn phí mượn.</InlineAlert>}
            <PaymentFields totalVnd={feeTotal} value={payment} onChange={setPayment} showTotal={false} />
        </section>
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

// =============================================================================================
// Return (FR-LIB-08, UC-18)

interface CheckinResult {
  customerId: string;
  barcode: string;
  callNo: string | null;
  title: string;
  customerName: string;
  customerPhone: string | null;
  dueAt: string;
  daysLate: number;
  lateFeeVnd: number;
  damageVnd: number;
  hold: { customerName: string; customerPhone: string | null; holdUntil: string } | null;
}

function ReturnDialog({ initialBarcode, onClose }: { initialBarcode?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [barcode, setBarcode] = useState(initialBarcode ?? '');
  const [condition, setCondition] = useState<'ok' | 'damaged'>('ok');
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  // Copies on loan matching the code or title typed (Design §13.8).
  const term = useDebounced(barcode.trim(), 250);
  const matches = useQuery({
    queryKey: ['library-loans', 'return-search', term],
    enabled: term.length >= 2 && !result,
    queryFn: () => get<{ items: Loan[] }>('/api/v1/library/loans', { filter: 'open', q: term }),
  });
  const picked = matches.data?.items.some((l) => l.barcode.toUpperCase() === barcode.trim().toUpperCase());
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await post<CheckinResult>('/api/v1/library/loans/checkin', { barcode: barcode.trim(), condition }));
      void qc.invalidateQueries({ queryKey: ['library-loans'] });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const owed = result ? result.lateFeeVnd + result.damageVnd : 0;
  if (result) {
    // A notice like the borrow success screen; Xác nhận ends the return (Design §13.8).
    const late = result.daysLate > 0;
    return (
      <Dialog
        title="Nhận trả sách thành công"
        size="sm"
        onClose={onClose}
        footer={
          <Button variant="primary" onClick={onClose}>
            Xác nhận
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-success-50 text-success-700">
            <CheckCircle2 size={36} aria-hidden />
          </span>
          {/* Labels left, values right. */}
          <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-left text-sm">
            <dt className="text-ink-700">Tên sách</dt>
            <dd className="text-right font-semibold">{result.title}</dd>
            <dt className="text-ink-700">Mã cá biệt</dt>
            <dd className="text-right font-semibold">{result.barcode}</dd>
            <dt className="text-ink-700">Tên khách</dt>
            <dd className="text-right font-semibold">{result.customerName}</dd>
            <dt className="text-ink-700">Hạn trả</dt>
            <dd className="text-right font-semibold num">{formatDate(result.dueAt)}</dd>
            <dt className="text-ink-700">Tình trạng</dt>
            <dd className={clsx('text-right font-semibold num', late ? 'text-danger-700' : 'text-success-700')}>{late ? `Trễ ${result.daysLate} ngày` : 'Trả đúng hạn'}</dd>
            {result.lateFeeVnd > 0 && (
              <>
                <dt className="text-ink-700">Phí trả trễ</dt>
                <dd className="text-right font-semibold text-danger-700 num">{formatVnd(result.lateFeeVnd)}</dd>
              </>
            )}
            {result.damageVnd > 0 && (
              <>
                <dt className="text-ink-700">Phí sách hỏng</dt>
                <dd className="text-right font-semibold text-danger-700 num">{formatVnd(result.damageVnd)}</dd>
              </>
            )}
          </dl>
          {owed > 0 && (
            <Button variant="secondary" full onClick={() => setPayFor(result.customerId)}>
              Thu phí {formatVnd(owed)}
            </Button>
          )}
          {payFor && <PayChargesDialog customerId={payFor} onClose={() => setPayFor(null)} />}
          {result.hold && (
            <InlineAlert tone="info">
              Giữ cho {result.hold.customerName} – gọi <CallLink phone={result.hold.customerPhone} /> (giữ đến {formatDate(result.hold.holdUntil)}).
            </InlineAlert>
          )}
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog
      title="Nhận trả sách"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!barcode.trim()} onClick={submit}>
            Xác nhận
          </Button>
        </>
      }
    >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-end gap-2">
              <Field
                label="Mã cá biệt"
                leadingIcon={Search}
                className="flex-1"
                autoFocus
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && barcode.trim() && void submit()}
                placeholder="Nhập mã cá biệt/tên sách"
              />
              {/* Camera scan fills the copy code (Design §13.8). */}
              <button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-navy-700 hover:bg-navy-50" aria-label="Quét mã bằng camera" onClick={() => setCamera(true)}>
                <ScanBarcode size={24} aria-hidden />
              </button>
            </div>
            {term.length >= 2 && !picked && matches.data && (
              <ul className="max-h-56 divide-y divide-paper-300 overflow-y-auto rounded-md border border-paper-300">
                {matches.data.items.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">Không có sách đang mượn phù hợp.</li>}
                {matches.data.items.map((l) => (
                  <li key={l.id}>
                    <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-navy-50" onClick={() => setBarcode(l.barcode)}>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{l.title}</span>
                        <span className="text-ink-500">
                          {l.barcode} · {l.customerName}
                        </span>
                      </span>
                      {l.overdue && <StatusChip tone="danger">Quá hạn</StatusChip>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <fieldset>
            <legend className="mb-1 text-[13px] font-medium text-ink-700">Tình trạng sách</legend>
            <div className="flex gap-6">
              {(
                [
                  ['ok', 'Nguyên vẹn'],
                  ['damaged', 'Hỏng'],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="inline-flex h-10 items-center gap-2 text-sm">
                  <input type="radio" name="return-condition" className="size-[18px] accent-navy-700" checked={condition === v} onChange={() => setCondition(v)} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          {camera && (
            <CameraScanner
              onCode={(code) => {
                setBarcode(code);
                setCamera(false);
              }}
              onClose={() => setCamera(false)}
            />
          )}
        </div>
    </Dialog>
  );
}

// =============================================================================================
// Library overview (FR-LIB-15a, Design §12.5): four figures, each opening its list

export interface LibraryOverviewData {
  copies: number;
  available: number;
  /** Cash-book receipts less refunds in the period (FR-LIB-15a). */
  collectedVnd: number;
  period: 'day' | 'week' | 'month';
  from: string;
  to: string;
  onLoan: number;
  overdue: number;
}

const COLLECTED_LABEL: Record<LibraryOverviewData['period'], string> = { day: 'Đã thu hôm nay', week: 'Đã thu trong tuần', month: 'Đã thu trong tháng' };

export function LibraryOverview({ data }: { data: LibraryOverviewData | undefined }) {
  const tile = (label: string, value: string | undefined, to: string, tone?: string) => (
    <Link to={to} className="flex flex-col gap-1 rounded-lg border border-paper-300 bg-white p-4 hover:border-navy-700">
      <span className="text-sm text-ink-500">{label}</span>
      {value === undefined ? <Skeleton className="h-8 w-16" /> : <span className={clsx('text-2xl leading-8 font-semibold num', tone)}>{value}</span>}
    </Link>
  );
  const n = (v: number | undefined) => (v === undefined ? undefined : formatNumber(v));
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {tile('Tổng', n(data?.copies), '/library/catalog')}
      {tile(COLLECTED_LABEL[data?.period ?? 'week'], data && formatVnd(data.collectedVnd), data ? `/library?tab=all&time=${data.from}..${data.to}` : '/library?tab=all', 'text-success-700')}
      {tile('Đang mượn', n(data?.onLoan), '/library')}
      {tile('Quá hạn', n(data?.overdue), '/library?tab=overdue', data?.overdue ? 'text-danger-700' : undefined)}
    </div>
  );
}

/** Gia hạn: one more loan period; the fee is taken at the desk (FR-LIB-12, FR-LIB-09a). */
function RenewDialog({ loan, fee, onClose, onDone }: { loan: Loan; fee: Borrower | undefined; onClose: () => void; onDone: () => void }) {
  const [payment, setPayment] = useState<DeskPayment>({ method: 'cash' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renew = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ dueAt: string }>(`/api/v1/library/loans/${loan.id}/renew`, { payment: paymentBody(payment) });
      toast.success(`Đã gia hạn đến ${formatDate(r.dueAt)}.`);
      onDone();
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={`Gia hạn “${loan.title}”`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!fee || !paymentReady(payment)} onClick={renew}>
            Thu tiền và gia hạn
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-700">
          Thêm {fee?.loanDays ?? '…'} ngày từ hạn trả hiện tại ({formatDate(loan.dueAt)}). Còn {loan.renewalsLeft} lần gia hạn.
        </p>
        {fee ? <PaymentFields totalVnd={fee.fee.amountVnd} value={payment} onChange={setPayment} /> : <Skeleton className="h-24" />}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

// =============================================================================================
// Mượn / trả: loan lists with call links (FR-LIB-14, Design §13.8)


// =============================================================================================
// Loan slips (FR-LIB-09a, Design §13.8): one row per check-out receipt

interface SlipCounts {
  open: number;
  dueSoon: number;
  overdue: number;
  returned: number;
  all: number;
  held: number;
}

interface Slip {
  id: string;
  /** The check-out receipt number (PT-…); none for loans from before slips. */
  docNo: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  copies: number;
  out: number;
  amountVnd: number;
  /** Earliest due date of the copies still out. */
  dueAt: string | null;
  overdue: boolean;
  createdAt: string;
  receivedBy: string | null;
}

interface SlipPayment {
  id: string;
  docNo: string;
  kind: 'receipt' | 'refund';
  method: string;
  amountVnd: number;
  reason: string | null;
  receivedAt: string;
  receivedBy: string | null;
  refunded: boolean;
  items: string | null;
}

interface SlipDetail extends Slip {
  loans: Loan[];
  payments: SlipPayment[];
  owed: { id: string; kind: string; label: string; barcode: string; amountVnd: number }[];
}

/** Phiếu mượn: its own page, opened from a row of Mượn / trả (Design §13.8). */
export function LibrarySlipPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | { kind: 'return'; barcode: string } | { kind: 'renew'; loan: Loan } | { kind: 'lost'; loan: Loan } | { kind: 'pay'; customerId: string } | { kind: 'refund'; payment: SlipPayment }>(null);
  const [reason, setReason] = useState('');
  const d = useQuery({ queryKey: ['library-loans', 'slip', id], queryFn: () => get<SlipDetail>(`/api/v1/library/slips/${id}`) });
  const fee = useQuery({ queryKey: ['library-borrower', d.data?.customerId], enabled: !!d.data && dialog?.kind === 'renew', queryFn: () => get<Borrower>(`/api/v1/library/borrowers/${d.data!.customerId}`) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['library-loans'] });
  const s = d.data;
  const owedVnd = s ? s.owed.reduce((a, c) => a + c.amountVnd, 0) : 0;
  const canRefund = can(me, 'library.fine_waive');
  const onRenew = (loan: Loan) => setDialog({ kind: 'renew', loan });
  const onReturn = (barcode: string) => setDialog({ kind: 'return', barcode });
  const onLost = (loan: Loan) => setDialog({ kind: 'lost', loan });
  const onPay = (customerId: string) => setDialog({ kind: 'pay', customerId });
  const onRefund = (payment: SlipPayment) => setDialog({ kind: 'refund', payment });
  if (d.error) return <ErrorState error={d.error} onRetry={() => d.refetch()} />;
  if (!s) return <Skeleton className="h-64" />;
  return (
    <>
      <PageHeader
        title={s.docNo ? `Phiếu mượn ${s.docNo}` : 'Phiếu mượn'}
        breadcrumb={
          <Link to="/library" className="hover:underline">
            Mượn / trả
          </Link>
        }
      />
        <div className="flex flex-col gap-4 text-sm">
          <Card title="Thông tin phiếu">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-ink-500">Khách</dt>
            <dd>
              <Link to={`/customers/${s.customerId}`} className="font-semibold hover:underline">
                {s.customerName}
              </Link>
            </dd>
            {/* Phone on its own line (Design §13.8). */}
            <dt className="text-ink-500">SĐT</dt>
            <dd>
              <CallLink phone={s.customerPhone} />
            </dd>
            <dt className="text-ink-500">Thời gian tạo</dt>
            <dd className="num">{formatDateTime(s.createdAt)}</dd>
            <dt className="text-ink-500">Người thu</dt>
            <dd>{s.receivedBy ?? '—'}</dd>
          </dl>
          </Card>
          <Card title="Sách mượn">
            <ul className="divide-y divide-paper-300 rounded-md border border-paper-300">
              {s.loans.map((l) => {
                const out = !l.returnedAt;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{l.title}</span>
                      <span className="text-ink-500">
                        {l.barcode} · hạn trả <span className="num">{formatDate(l.dueAt)}</span>
                      </span>
                    </span>
                    {out ? (
                      l.overdue ? (
                        <StatusChip tone="danger" icon={AlertOctagon}>
                          Quá hạn {l.daysLate} ngày
                        </StatusChip>
                      ) : (
                        <StatusChip tone="info">Đang mượn</StatusChip>
                      )
                    ) : l.closedAs === 'lost' ? (
                      <StatusChip tone="danger">Mất</StatusChip>
                    ) : (
                      <StatusChip tone="neutral">Đã trả</StatusChip>
                    )}
                    {out && (
                      <span className="flex gap-1">
                        <Button size="sm" variant="secondary" disabled={l.renewalsLeft === 0 || l.overdue} onClick={() => onRenew(l)}>
                          Gia hạn
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => onReturn(l.barcode)}>
                          Nhận trả
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onLost(l)}>
                          Báo mất
                        </Button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Thanh toán">
            <div className="flex flex-col gap-3">
            <ul className="divide-y divide-paper-300 rounded-md border border-paper-300">
              {s.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block">
                      <span className="code font-medium">{p.docNo}</span> · {p.kind === 'refund' ? `Hoàn tiền${p.reason ? ` – ${p.reason}` : ''}` : (p.items ?? '—')}
                    </span>
                    <span className="text-ink-500">
                      <span className="num">{formatDateTime(p.receivedAt)}</span> · {PAYMENT_METHOD_LABEL[p.method] ?? p.method} · {p.receivedBy ?? '—'}
                    </span>
                  </span>
                  {p.refunded && <StatusChip tone="neutral">Đã hoàn</StatusChip>}
                  <span className={clsx('font-semibold num', p.amountVnd < 0 && 'text-danger-700')}>{formatVnd(p.amountVnd)}</span>
                  {canRefund && p.kind === 'receipt' && p.amountVnd > 0 && !p.refunded && (
                    <Button size="sm" variant="ghost" onClick={() => onRefund(p)}>
                      Hoàn tiền
                    </Button>
                  )}
                </li>
              ))}
              {s.owed.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    {c.label} <span className="text-ink-500">· {c.barcode}</span>
                  </span>
                  <StatusChip tone="warning">Chưa thu</StatusChip>
                  <span className="font-semibold num">{formatVnd(c.amountVnd)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">Đã thu</span>
              <span className="text-base font-semibold num">{formatVnd(s.amountVnd)}</span>
            </div>
            {owedVnd > 0 && (
              <Button variant="primary" className="self-end" onClick={() => onPay(s.customerId)}>
                Thu phí {formatVnd(owedVnd)}
              </Button>
            )}
            </div>
          </Card>
        </div>
      {dialog?.kind === 'return' && <ReturnDialog initialBarcode={dialog.barcode} onClose={() => { setDialog(null); refresh(); }} />}
      {dialog?.kind === 'renew' && <RenewDialog loan={dialog.loan} fee={fee.data} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'pay' && <PayChargesDialog customerId={dialog.customerId} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'lost' && (
        <ConfirmDialog
          title={`Báo mất “${dialog.loan.title}”?`}
          body="Lượt mượn kết thúc, bản sách chuyển sang Mất và khách chịu giá trị cuốn sách cộng phí xử lý. Nếu tìm lại được, khoản phí sẽ được hủy."
          confirm="Báo mất"
          destructive
          onConfirm={async () => {
            const r = await post<{ chargeVnd: number }>(`/api/v1/library/loans/${dialog.loan.id}/mark-lost`);
            toast.success(`Đã ghi nhận mất sách – phí ${formatVnd(r.chargeVnd)}.`);
            refresh();
            // Collect the charge now if the borrower pays at once (FR-LIB-11).
            if (r.chargeVnd > 0) setTimeout(() => setDialog({ kind: 'pay', customerId: dialog.loan.customerId }), 0);
          }}
          onClose={() => setDialog((x) => (x?.kind === 'lost' ? null : x))}
        />
      )}
      {dialog?.kind === 'refund' && (
        <ConfirmDialog
          title={`Hoàn phiếu ${dialog.payment.docNo} – ${formatVnd(dialog.payment.amountVnd)}?`}
          body="Trả lại tiền cho khách; các khoản của phiếu này chuyển về chưa thu."
          confirm="Hoàn tiền"
          destructive
          onConfirm={async () => {
            await post(`/api/v1/library/payments/${dialog.payment.id}/refund`, { reason });
            setReason('');
            refresh();
          }}
          onClose={() => setDialog(null)}
        >
          <TextArea label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} />
        </ConfirmDialog>
      )}
    </>
  );
}

export function LibraryDeskPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useParam('tab', 'open');
  const [q, setQ] = useParam('q');
  const [time, setTime] = useParam('time');
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<null | { kind: 'borrow' } | { kind: 'return' } | { kind: 'unhold'; hold: Hold }>(null);
  const days = time ? timeDays(time) : null;
  // Loan slips, one per check-out receipt (FR-LIB-09a); held copies keep their own list.
  const list = useQuery({
    // Also read on Đang giữ, for the counts in the filter.
    queryKey: ['library-loans', 'slips', tab === 'held' ? 'open' : tab, q, time],
    queryFn: () => get<{ counts: SlipCounts; items: Slip[] }>('/api/v1/library/slips', { filter: tab === 'held' ? 'open' : tab, q: q || undefined, from: days?.[0], to: days?.[1] }),
  });
  const heldList = useQuery({
    queryKey: ['library-loans', 'held', q],
    enabled: tab === 'held',
    queryFn: () => get<{ holds: Hold[] }>('/api/v1/library/loans', { filter: 'held', q: q || undefined }),
  });
  const counts = list.data?.counts;
  const overview = useQuery({ queryKey: ['library-loans', 'overview'], queryFn: () => get<LibraryOverviewData>('/api/v1/library/overview') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['library-loans'] });
  const slipColumns: Column<Slip>[] = [
    { header: 'Số phiếu', className: 'whitespace-nowrap', cell: (s) => <span className="code font-medium">{s.docNo ?? '—'}</span> },
    {
      header: 'Khách',
      cell: (s) => (
        <Link to={`/customers/${s.customerId}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
          {s.customerName}
        </Link>
      ),
    },
    { header: 'SĐT', className: 'whitespace-nowrap', cell: (s) => <span onClick={(e) => e.stopPropagation()}><CallLink phone={s.customerPhone} /></span> },
    { header: 'Số sách', align: 'right', cell: (s) => <span className="num">{formatNumber(s.copies)}</span> },
    { header: 'Số tiền', align: 'right', cell: (s) => <span className="num">{formatVnd(s.amountVnd)}</span> },
    {
      header: 'Hạn trả',
      className: 'whitespace-nowrap',
      cell: (s) => (s.dueAt ? <span className={clsx('num', s.overdue && 'font-semibold text-danger-700')}>{formatDate(s.dueAt)}</span> : <span className="text-ink-500">Đã trả hết</span>),
    },
    { header: 'Thời gian tạo', className: 'whitespace-nowrap', cell: (s) => <span className="num">{formatDateTime(s.createdAt)}</span> },
    { header: 'Người thu', cell: (s) => s.receivedBy ?? '—' },
  ];
  const holdColumns: Column<Hold>[] = [
    {
      header: 'Người đặt giữ',
      cell: (h) => (
        <span className="flex flex-col">
          <span className="font-medium">{h.customerName}</span>
          <CallLink phone={h.customerPhone} />
        </span>
      ),
    },
    {
      header: 'Sách',
      cell: (h) => (
        <span className="flex flex-col">
          <span className="font-medium">{h.title}</span>
          <span className="code text-[13px] text-ink-500">{h.barcode}</span>
        </span>
      ),
    },
    { header: 'Giữ đến', cell: (h) => <span className="num">{formatDate(h.holdUntil)}</span> },
    {
      header: '',
      cell: (h) => (
        <span className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'unhold', hold: h })}>
            Hủy giữ
          </Button>
        </span>
      ),
    },
  ];
  const lendable = can(me, 'library.lend');
  return (
    <>
      <PageHeader
        title="Mượn / trả"
        actions={
          lendable && (
            <>
              <Button variant="secondary" icon={ArrowLeftRight} onClick={() => setDialog({ kind: 'return' })}>
                Nhận trả
              </Button>
              <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: 'borrow' })}>
                Phiếu mượn
              </Button>
            </>
          )
        }
      />
      {/* One card like the dashboard's (Design §12.5, §13.8). */}
      <Card title="Tổng quan thư viện" className="mb-4">
        <LibraryOverview data={overview.data} />
      </Card>
      {/* Loan slips with a filter beside the search box, not tabs (Design §13.8). */}
      <div className="mb-4 flex items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm số phiếu, tên, SĐT khách hoặc tên sách, mã bản…" />
        <FilterMenu
          groups={[
            {
              kind: 'single',
              label: 'Trạng thái',
              options: [
                { key: 'due_soon', label: `Sắp đến hạn${counts ? ` (${counts.dueSoon})` : ''}` },
                { key: 'overdue', label: `Quá hạn${counts ? ` (${counts.overdue})` : ''}` },
                { key: 'returned', label: `Đã trả hết${counts ? ` (${counts.returned})` : ''}` },
                { key: 'all', label: `Tất cả${counts ? ` (${counts.all})` : ''}` },
                { key: 'held', label: `Đang giữ${counts ? ` (${counts.held})` : ''}` },
              ],
              // No choice lists slips with a copy still out (“Đang mượn”); clearing the filter returns to it.
              value: tab === 'open' ? '' : tab,
              onChange: (v) => setTab(v || 'open'),
            },
            { kind: 'custom', label: 'Thời gian', summary: timeLabel(time), active: !!time, onClear: () => setTime(''), content: <TimeFilter value={time} onChange={setTime} /> },
          ]}
        />
      </div>
      {tab === 'held' ? (
        <DataTable columns={holdColumns} rows={heldList.data?.holds} rowKey={(h) => h.id} error={heldList.error} onRetry={() => heldList.refetch()} empty={{ icon: BookmarkCheck, title: 'Không có sách đang giữ cho khách' }} />
      ) : (
        <DataTable
          columns={slipColumns}
          rows={list.data?.items}
          rowKey={(s) => s.id}
          onRow={(s) => navigate(`/library/slips/${s.id}`)}
          error={list.error}
          onRetry={() => list.refetch()}
          minWidth={960}
          empty={
            q || time
              ? { icon: Search, title: 'Không có phiếu mượn phù hợp', help: 'Thử đổi từ khóa hoặc bộ lọc.' }
              : { icon: Library, title: tab === 'overdue' ? 'Không có phiếu quá hạn' : tab === 'due_soon' ? 'Không có phiếu sắp đến hạn' : tab === 'returned' ? 'Chưa có phiếu nào trả hết' : 'Chưa có sách nào đang được mượn' }
          }
        />
      )}
      {dialog?.kind === 'borrow' && <BorrowDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'return' && <ReturnDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'unhold' && (
        <ConfirmDialog
          title="Hủy giữ sách?"
          body={`Cuốn ${dialog.hold.barcode ?? ''} sẽ chuyển cho người đặt giữ kế tiếp hoặc lên kệ.`}
          confirm="Hủy giữ"
          destructive
          onConfirm={async () => {
            await post(`/api/v1/library/reservations/${dialog.hold.id}/cancel`);
            refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

// =============================================================================================
// Quản lý đầu sách: titles and copies (FR-LIB-01..04)

export function LibraryCatalogPage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [q, setQ] = useParam('q');
  const [language, setLanguage] = useParam('lang');
  const [status, setStatus] = useParam('status');
  const [category, setCategory] = useParam('category');
  const [classified, setClassified] = useParam('class');
  const [dialog, setDialog] = useState<null | 'new'>(null);
  const list = useQuery({
    queryKey: ['library-titles', q, language, status, category, classified],
    queryFn: () => get<{ items: TitleRow[]; categories: string[] }>('/api/v1/library/titles', { q: q || undefined, language: language || undefined, status: status || undefined, category: category || undefined, unclassified: classified === 'no' ? 'true' : undefined }),
  });
  const columns: Column<TitleRow>[] = [
    {
      header: 'Ký hiệu xếp giá',
      cell: (r) =>
        r.dewey ? (
          <span className="code flex flex-col font-medium leading-5">
            <span>{normalizeDewey(r.dewey)}</span>
            {r.cutter && <span>{r.cutter}</span>}
          </span>
        ) : (
          <CallNo value={r.callNo} />
        ),
    },
    {
      header: 'Tên sách',
      cell: (r) => (
        <span className="flex flex-col">
          <span className="line-clamp-2 font-medium">{r.title}</span>
          {r.authors.length > 0 && <span className="text-[13px] text-ink-500">{r.authors.join(', ')}</span>}
        </span>
      ),
    },
    { header: 'Ngôn ngữ', cell: (r) => <StatusChip tone="neutral">{LANG[r.language]}</StatusChip> },
    { header: 'Thể loại', cell: (r) => r.category ?? '—' },
    {
      header: 'Số bản (còn/tổng)',
      align: 'right',
      cell: (r) => (
        <span className={r.available === 0 && r.copies > 0 ? 'text-warning-700' : ''}>
          {r.available}/{r.copies}
          {r.queued > 0 && <span className="ml-2 text-[13px] text-ink-500">· {r.queued} chờ</span>}
        </span>
      ),
    },
  ];
  const manage = can(me, 'library.manage');
  const filtered = !!(q || language || status || category || classified);
  return (
    <>
      <PageHeader
        title="Quản lý đầu sách"
        actions={
          manage && (
            <>
              <Button variant="primary" icon={Plus} onClick={() => setDialog('new')}>
                Thêm đầu sách
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchBox value={q} onChange={setQ} placeholder="Tìm mã cá biệt, ký hiệu, tên sách, tác giả, ISBN…" />
        </div>
        <FilterMenu
          groups={[
            { kind: 'single', label: 'Ngôn ngữ', options: [{ key: 'vi', label: 'Tiếng Việt' }, { key: 'en', label: 'Tiếng Anh' }], value: language, onChange: setLanguage },
            { kind: 'single', label: 'Trạng thái', options: Object.entries(COPY_STATUS).map(([key, s]) => ({ key, label: `Có bản ${s.label.toLowerCase()}` })), value: status, onChange: setStatus },
            { kind: 'single', label: 'Thể loại', options: (list.data?.categories ?? []).map((c) => ({ key: c, label: c })), value: category, onChange: setCategory },
            { kind: 'single', label: 'Phân loại', options: [{ key: 'no', label: 'Chưa phân loại' }], value: classified, onChange: setClassified },
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        onRow={(r) => navigate(`/library/titles/${r.id}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={filtered ? { icon: Search, title: 'Không có đầu sách phù hợp', help: 'Thử đổi từ khóa hoặc bộ lọc.' } : { icon: Library, title: 'Thư viện chưa có đầu sách', help: 'Thêm đầu sách cùng số cuốn để in tem gáy.' }}
      />
      {dialog === 'new' && <TitleForm title={null} onClose={() => setDialog(null)} onSaved={(id, copyIds) => navigate(`/library/titles/${id}${copyIds.length ? `?print=${copyIds.join(',')}` : ''}`)} />}
    </>
  );
}

interface TitleDetail {
  id: string;
  dewey: string | null;
  cutter: string | null;
  title: string;
  authors: string[];
  isbn13: string | null;
  publisher: string | null;
  year: number | null;
  language: string;
  category: string | null;
  callNo: string | null;
  copies: {
    id: string;
    copyNo: number;
    barcode: string;
    status: string;
    condition: string | null;
    valueVnd: number;
    acquiredVia: string;
    acquiredAt: string;
    shelf: string | null;
    loan: { dueAt: string; overdue: boolean; borrowerName: string | null; borrowerPhone: string | null } | null;
  }[];
  reservations: Hold[];
}

function AutoChip() {
  return (
    <span className="ml-1.5 align-middle">
      <StatusChip tone="info">Tự điền</StatusChip>
    </span>
  );
}

const storeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

/** Ngày nhập, Số cuốn, Giá trị, Nguồn for copies added with a title or later (FR-LIB-02, Design §13.8). */
type CopiesDraft = { count: string; acquiredAt: string; valueVnd: number | null; acquiredVia: 'purchase' | 'donation' };
const newCopiesDraft = (): CopiesDraft => ({ count: '1', acquiredAt: storeToday(), valueVnd: null, acquiredVia: 'purchase' });

function CopiesFields({ value, onChange, allowZero }: { value: CopiesDraft; onChange: (v: CopiesDraft) => void; allowZero?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Ngày nhập" type="date" value={value.acquiredAt} max={storeToday()} onChange={(e) => onChange({ ...value, acquiredAt: e.target.value })} />
      <Field
        label="Số cuốn"
        inputMode="numeric"
        value={value.count}
        helper={allowZero ? 'Để 0 nếu chỉ lưu đầu sách.' : undefined}
        onChange={(e) => onChange({ ...value, count: e.target.value.replace(/\D/g, '').slice(0, 2) })}
      />
      <MoneyInput label="Giá trị mỗi cuốn" value={value.valueVnd} onChange={(v) => onChange({ ...value, valueVnd: v })} />
      <SelectField label="Nguồn" value={value.acquiredVia} onChange={(e) => onChange({ ...value, acquiredVia: e.target.value as 'purchase' | 'donation' })}>
        <option value="purchase">Mua</option>
        <option value="donation">Tặng</option>
      </SelectField>
    </div>
  );
}

const copiesBody = (c: CopiesDraft) => ({ count: Number(c.count) || 0, acquiredAt: c.acquiredAt, valueVnd: c.valueVnd ?? 0, acquiredVia: c.acquiredVia });

/** “Thêm đầu sách” / “Sửa”: Tìm sách, Thông tin sách, Ký hiệu xếp giá and, for a new title, Nhập bản (Design §13.8). */
function TitleForm({ title, onClose, onSaved }: { title: TitleDetail | null; onClose: () => void; onSaved: (id: string, copyIds: string[]) => void }) {
  const qc = useQueryClient();
  const isNew = !title;
  const [f, setF] = useState({
    title: title?.title ?? '',
    authors: title?.authors.join(', ') ?? '',
    isbn13: title?.isbn13 ?? '',
    publisher: title?.publisher ?? '',
    year: title?.year ? String(title.year) : '',
    language: title?.language ?? 'vi',
    category: title?.category ?? '',
    dewey: title?.dewey ?? '',
    cutter: title?.cutter ?? '',
  });
  // The Cutter and the category follow the author, title and Dewey until staff type their own.
  const [cutterTouched, setCutterTouched] = useState(!!title?.cutter);
  const [categoryTouched, setCategoryTouched] = useState(!!title?.category);
  const [auto, setAuto] = useState<Set<string>>(new Set());
  const [copies, setCopies] = useState<CopiesDraft>(newCopiesDraft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unmark = (k: string) => auto.has(k) && setAuto((a) => new Set([...a].filter((x) => x !== k)));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    unmark(k);
    setF({ ...f, [k]: e.target.value });
  };
  const label = (text: string, k: string) => (
    <>
      {text}
      {auto.has(k) && <AutoChip />}
    </>
  );
  const lang = f.language === 'en' ? 'en' : 'vi';
  const firstAuthor = f.authors.split(',')[0]?.trim() ?? '';
  const cutter = cutterTouched ? f.cutter : cutterNumber(firstAuthor, f.title, lang);
  const dewey = normalizeDewey(f.dewey);
  const deweyBad = f.dewey.trim() !== '' && !dewey;
  const category = categoryTouched ? f.category : f.category || deweyCategory(f.dewey) || '';
  const count = Number(copies.count) || 0;

  /** Fill only empty fields from a looked-up book (FR-LIB-02a). */
  const fill = (b: BookResult) => {
    const next = { ...f };
    const marked: string[] = [];
    const take = (k: keyof typeof f, v: string | null | undefined) => {
      if (v && !f[k].trim()) {
        next[k] = v;
        marked.push(k);
      }
    };
    const language = b.language ?? (f.language as 'vi' | 'en');
    take('title', b.title);
    take('authors', (language === 'vi' ? b.authors.map(vietnameseNaturalOrder) : b.authors).join(', '));
    take('isbn13', b.isbn13);
    take('publisher', b.publisher);
    take('year', b.year ? String(b.year) : null);
    take('dewey', b.dewey);
    if (b.language && b.language !== f.language) {
      next.language = b.language;
      marked.push('language');
    }
    setF(next);
    setAuto((a) => new Set([...a, ...marked]));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: f.title,
        authors: f.authors.split(',').map((a) => a.trim()).filter(Boolean),
        isbn13: f.isbn13 || null,
        publisher: f.publisher || null,
        year: f.year ? Number(f.year) : null,
        language: f.language,
        category: category || null,
        dewey: f.dewey.trim() || null,
        cutter: dewey ? cutter || null : null,
        ...(isNew && count > 0 && { copies: copiesBody(copies) }),
      };
      let id: string;
      let made: { id: string; barcode: string }[] = [];
      if (title) id = (await patch<{ id: string }>(`/api/v1/library/titles/${title.id}`, body)).id;
      else {
        const r = await post<{ id: string; copies: { id: string; barcode: string }[] }>('/api/v1/library/titles', body);
        id = r.id;
        made = r.copies;
      }
      toast.success(made.length ? `Đã lưu đầu sách và ${made.length} cuốn (${made[0]!.barcode}${made.length > 1 ? ` – ${made[made.length - 1]!.barcode}` : ''}).` : 'Đã lưu đầu sách.');
      void qc.invalidateQueries({ queryKey: ['library-titles'] });
      void qc.invalidateQueries({ queryKey: ['library-title', id] });
      onSaved(id, made.map((c) => c.id));
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const section = 'text-sm font-semibold text-ink-900 sm:col-span-2';
  return (
    <Dialog
      title={title ? `Sửa “${title.title}”` : 'Thêm đầu sách'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" {...(isNew && count > 0 && { icon: Printer })} loading={busy} disabled={!f.title.trim() || deweyBad} onClick={save}>
            {isNew && count > 0 ? 'Lưu và in tem' : 'Lưu'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {isNew && (
          <div className="sm:col-span-2">
            <BookLookup onPick={fill} endpoint="/api/v1/library/book-lookup" />
            {auto.size > 0 && <p className="mt-1 text-xs text-ink-500">Dữ liệu từ Open Library</p>}
          </div>
        )}
        <h3 className={section}>Thông tin sách</h3>
        <Field label={label('Tên sách', 'title')} required className="sm:col-span-2" autoFocus={!!title} value={f.title} onChange={set('title')} />
        <Field label={label('Tác giả', 'authors')} helper="Nhiều tác giả cách nhau bởi dấu phẩy; tác giả đầu dùng để tính Cutter." className="sm:col-span-2" value={f.authors} onChange={set('authors')} />
        <Field label={label('ISBN', 'isbn13')} className="code" value={f.isbn13} onChange={set('isbn13')} />
        <Field label={label('Nhà xuất bản', 'publisher')} value={f.publisher} onChange={set('publisher')} />
        <Field label={label('Năm xuất bản', 'year')} inputMode="numeric" value={f.year} onChange={(e) => (unmark('year'), setF({ ...f, year: e.target.value.replace(/\D/g, '').slice(0, 4) }))} />
        <SelectField label={label('Ngôn ngữ', 'language')} required value={f.language} onChange={set('language')}>
          <option value="vi">Tiếng Việt</option>
          <option value="en">Tiếng Anh</option>
        </SelectField>
        <Field
          label="Thể loại"
          className="sm:col-span-2"
          value={category}
          helper={!categoryTouched && !f.category && deweyCategory(f.dewey) ? 'Gợi ý theo lớp Dewey; có thể sửa.' : undefined}
          onChange={(e) => {
            setCategoryTouched(true);
            setF({ ...f, category: e.target.value });
          }}
        />

        <h3 className={clsx(section, 'mt-2')}>Ký hiệu xếp giá</h3>
        <Field
          label={label('Dewey', 'dewey')}
          inputMode="decimal"
          className="code"
          value={f.dewey}
          error={deweyBad ? 'Số Dewey gồm 3 chữ số, có thể thêm phần thập phân (ví dụ 891.733).' : undefined}
          helper="Để trống nếu chưa phân loại."
          onChange={set('dewey')}
        />
        <Field
          label="Cutter"
          className="code"
          value={cutter}
          helper="Tự tính theo bảng Cutter LC; có thể sửa."
          onChange={(e) => {
            setCutterTouched(true);
            setF({ ...f, cutter: e.target.value });
          }}
        />
        <div className="flex items-center gap-3 sm:col-span-2">
          <span className="text-[13px] text-ink-500">Tem gáy:</span>
          {dewey ? (
            <span className="code inline-flex flex-col rounded-md border border-paper-500 px-3 py-1 text-center text-base leading-6 font-bold">
              <span>{dewey}</span>
              {cutter && <span>{cutter}</span>}
            </span>
          ) : (
            <StatusChip tone="neutral">Chưa phân loại</StatusChip>
          )}
        </div>

        {isNew && (
          <>
            <h3 className={clsx(section, 'mt-2')}>Nhập bản</h3>
            <div className="sm:col-span-2">
              <CopiesFields value={copies} onChange={setCopies} allowZero />
              <p className="mt-2 text-[13px] text-ink-500">Mã cá biệt được cấp tự động theo ngôn ngữ ({lang === 'vi' ? 'VN' : 'EN'}-000…).</p>
            </div>
          </>
        )}
        {error && (
          <div className="sm:col-span-2">
            <InlineAlert tone="danger">{error}</InlineAlert>
          </div>
        )}
      </div>
    </Dialog>
  );
}

const VIA: Record<string, string> = { purchase: 'Mua', donation: 'Được tặng', transfer: 'Chuyển từ kho bán' };

export function LibraryTitlePage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [params, setParams] = useSearchParams();
  // Copies just added open their spine labels straight away (FR-LIB-17).
  const [dialog, setDialog] = useState<null | 'edit' | 'add' | 'transfer' | 'reserve' | { kind: 'labels'; ids: string[] } | { kind: 'copy'; copy: TitleDetail['copies'][number] } | { kind: 'unreserve'; hold: Hold }>(() => {
    const ids = params.get('print')?.split(',').filter(Boolean) ?? [];
    return ids.length ? { kind: 'labels', ids } : null;
  });
  const t = useQuery({ queryKey: ['library-title', id], queryFn: () => get<TitleDetail>(`/api/v1/library/titles/${id}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['library-title', id] });
    void qc.invalidateQueries({ queryKey: ['library-titles'] });
  };
  if (t.error) return <ErrorState error={t.error} onRetry={() => t.refetch()} />;
  if (!t.data) return <Skeleton className="h-64" />;
  const d = t.data;
  const manage = can(me, 'library.manage');
  const columns: Column<TitleDetail['copies'][number]>[] = [
    { header: 'Mã cá biệt', cell: (c) => <span className="code font-medium">{c.barcode}</span> },
    { header: 'Ngày nhập', cell: (c) => <span className="num">{formatDate(c.acquiredAt)}</span> },
    { header: 'Trạng thái', cell: (c) => <CopyChip status={c.status} /> },
    {
      header: 'Người mượn',
      cell: (c) =>
        c.loan ? (
          <span className="flex flex-col">
            <span>{c.loan.borrowerName}</span>
            <span className="text-[13px] text-ink-500 num">
              hạn {formatDate(c.loan.dueAt)}
              {c.loan.overdue && <span className="text-danger-700"> · quá hạn</span>}
            </span>
          </span>
        ) : (
          '—'
        ),
    },
    { header: 'Kệ', cell: (c) => c.shelf ?? '—' },
    { header: 'Tình trạng', cell: (c) => c.condition ?? '—' },
    { header: 'Giá trị', align: 'right', cell: (c) => formatVnd(c.valueVnd) },
    { header: 'Nguồn', cell: (c) => VIA[c.acquiredVia] ?? c.acquiredVia },
  ];
  const holds = d.reservations;
  const available = d.copies.filter((c) => c.status === 'available').length;
  return (
    <>
      <PageHeader
        title={d.title}
        breadcrumb={
          <Link to="/library/catalog" className="hover:underline">
            Quản lý đầu sách
          </Link>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <CallNo value={d.callNo} />
            <StatusChip tone="neutral">{LANG[d.language]}</StatusChip>
          </span>
        }
        actions={
          manage && (
            <Button variant="secondary" onClick={() => setDialog('edit')}>
              Sửa
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="flex-1 text-base font-semibold">Bản sách ({d.copies.length})</h2>
            {manage && (
              <>
                <Button size="sm" variant="secondary" icon={Printer} disabled={selected.size === 0} onClick={() => setDialog({ kind: 'labels', ids: [...selected] })}>
                  In tem{selected.size ? ` (${selected.size})` : ''}
                </Button>
                {can(me, 'inventory.adjust') && (
                  <Button size="sm" variant="secondary" icon={Truck} onClick={() => setDialog('transfer')}>
                    Chuyển từ kho bán
                  </Button>
                )}
                <Button size="sm" variant="primary" icon={Plus} onClick={() => setDialog('add')}>
                  Thêm bản
                </Button>
              </>
            )}
          </div>
          <DataTable
            columns={columns}
            rows={d.copies}
            rowKey={(c) => c.id}
            {...(manage && { selection: { selected, onChange: setSelected }, onRow: (c: TitleDetail['copies'][number]) => setDialog({ kind: 'copy', copy: c }) })}
            empty={{ icon: Library, title: 'Chưa có bản sách', help: 'Thêm bản để cho mượn và in tem dán sách.' }}
          />
        </div>
        <div className="flex flex-col gap-4">
          <Card title="Thông tin">
            <Facts
              items={[
                ['Tác giả', d.authors.join(', ') || '—'],
                ['ISBN', d.isbn13 ? <span className="code">{d.isbn13}</span> : '—'],
                ['Nhà xuất bản', d.publisher ?? '—'],
                ['Năm', d.year ?? '—'],
                ['Thể loại', d.category ?? '—'],
                ['Ký hiệu xếp giá', d.callNo ?? 'Chưa phân loại'],
              ]}
            />
          </Card>
          <Card
            title={`Đặt giữ (${holds.length})`}
            action={
              can(me, 'library.lend') &&
              available === 0 &&
              d.copies.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => setDialog('reserve')}>
                  Đặt giữ cho khách
                </Button>
              )
            }
          >
            {holds.length === 0 ? (
              <p className="text-sm text-ink-500">{available > 0 ? 'Đang có bản trên kệ.' : 'Chưa có ai đặt giữ.'}</p>
            ) : (
              <ul className="flex flex-col gap-3 text-sm">
                {holds.map((h) => (
                  <li key={h.id} className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {h.status === 'held' ? <StatusChip tone="accent" icon={BookmarkCheck}>Đang giữ</StatusChip> : <span className="text-ink-500 num">#{h.position}</span>} {h.customerName}
                      </span>
                      <CallLink phone={h.customerPhone} />
                      {h.holdUntil && <span className="block text-[13px] text-ink-500 num">Giữ đến {formatDate(h.holdUntil)}</span>}
                    </span>
                    {can(me, 'library.lend') && (
                      <Button size="sm" variant="ghost" icon={X} aria-label="Hủy đặt giữ" onClick={() => setDialog({ kind: 'unreserve', hold: h })} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {dialog === 'edit' && <TitleForm title={d} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog === 'add' && (
        <AddCopiesDialog
          titleId={d.id}
          onClose={() => setDialog(null)}
          onDone={(ids) => {
            refresh();
            setDialog({ kind: 'labels', ids });
          }}
        />
      )}
      {dialog === 'transfer' && <TransferDialog titleId={d.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {typeof dialog === 'object' && dialog?.kind === 'labels' && (
        <LabelsDialog
          copyIds={dialog.ids}
          onClose={() => {
            setDialog(null);
            if (params.has('print')) setParams({}, { replace: true });
          }}
        />
      )}
      {dialog === 'reserve' && <ReserveDialog titleId={d.id} title={d.title} onClose={() => setDialog(null)} onDone={refresh} />}
      {typeof dialog === 'object' && dialog?.kind === 'copy' && <CopyDialog copy={dialog.copy} canFind={can(me, 'library.lend')} onClose={() => setDialog(null)} onDone={refresh} />}
      {typeof dialog === 'object' && dialog?.kind === 'unreserve' && (
        <ConfirmDialog
          title="Hủy đặt giữ?"
          body={`Bỏ lượt đặt giữ của ${dialog.hold.customerName}.`}
          confirm="Hủy đặt giữ"
          destructive
          onConfirm={async () => {
            await post(`/api/v1/library/reservations/${dialog.hold.id}/cancel`);
            refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function FormDialog({ title, busy, disabled, error, onSave, onClose, children, confirm = 'Lưu' }: { title: string; busy: boolean; disabled?: boolean; error: string | null; onSave: () => void; onClose: () => void; children: ReactNode; confirm?: string }) {
  return (
    <Dialog
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!!disabled} onClick={onSave}>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {children}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

function useSubmit(fn: () => Promise<unknown>, done: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** “Thêm bản”: Ngày nhập, Số cuốn, Giá trị, Nguồn; then the spine labels of the new copies (FR-LIB-02, Design §13.8). */
function AddCopiesDialog({ titleId, onClose, onDone }: { titleId: string; onClose: () => void; onDone: (copyIds: string[]) => void }) {
  const [copies, setCopies] = useState<CopiesDraft>(newCopiesDraft);
  const [shelf, setShelf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ items: { id: string; barcode: string }[] }>(`/api/v1/library/titles/${titleId}/copies`, { ...copiesBody(copies), shelf: shelf || null });
      toast.success(`Đã thêm ${r.items.length} cuốn (${r.items[0]!.barcode}${r.items.length > 1 ? ` – ${r.items[r.items.length - 1]!.barcode}` : ''}).`);
      onDone(r.items.map((c) => c.id));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog title="Thêm bản sách" busy={busy} error={error} disabled={!Number(copies.count)} onSave={run} onClose={onClose} confirm="Thêm và in tem">
      <CopiesFields value={copies} onChange={setCopies} />
      <Field label="Kệ" value={shelf} onChange={(e) => setShelf(e.target.value)} />
    </FormDialog>
  );
}

function TransferDialog({ titleId, onClose, onDone }: { titleId: string; onClose: () => void; onDone: () => void }) {
  const [pick, setPick] = useState<{ variantId: string; title: string; sku: string } | null>(null);
  const [count, setCount] = useState('1');
  const [shelf, setShelf] = useState('');
  const s = useSubmit(
    async () => {
      const r = await post<{ items: { barcode: string }[] }>(`/api/v1/library/titles/${titleId}/transfer-from-stock`, { variantId: pick!.variantId, count: Number(count), shelf: shelf || null });
      toast.success(`Đã chuyển ${r.items.length} cuốn vào thư viện.`);
      onDone();
    },
    onClose,
  );
  return (
    <FormDialog title="Chuyển từ kho bán" busy={s.busy} error={s.error} disabled={!pick || !Number(count)} onSave={s.run} onClose={onClose} confirm="Chuyển">
      <p className="text-sm text-ink-700">Sách rời tồn kho bán theo giá vốn; giá trị mỗi bản là giá bán hiện tại (FR-INV-13).</p>
      {pick ? (
        <div className="flex items-center gap-3 rounded-md border border-paper-300 p-3 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{pick.title}</span>
            <span className="code text-ink-500">{pick.sku}</span>
          </span>
          <Button variant="ghost" icon={X} aria-label="Chọn sản phẩm khác" onClick={() => setPick(null)} />
        </div>
      ) : (
        <ProductSearch placeholder="Tìm sản phẩm trong kho bán" autoFocus onPick={(h) => setPick({ variantId: h.variantId, title: h.titleVi || h.title, sku: h.sku })} />
      )}
      <Field label="Số cuốn" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))} />
      <Field label="Kệ" value={shelf} onChange={(e) => setShelf(e.target.value)} />
    </FormDialog>
  );
}

function CopyDialog({ copy, canFind, onClose, onDone }: { copy: TitleDetail['copies'][number]; canFind: boolean; onClose: () => void; onDone: () => void }) {
  const [shelf, setShelf] = useState(copy.shelf ?? '');
  const [condition, setCondition] = useState(copy.condition ?? '');
  const [value, setValue] = useState<number | null>(copy.valueVnd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.success(msg);
      onDone();
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={copy.barcode}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} onClick={() => act(() => patch(`/api/v1/library/copies/${copy.id}`, { shelf: shelf || null, condition: condition || null, valueVnd: value ?? 0 }), 'Đã lưu bản sách.')}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-700">Trạng thái</span>
          <CopyChip status={copy.status} />
        </div>
        <Field label="Kệ" value={shelf} onChange={(e) => setShelf(e.target.value)} />
        <Field label="Tình trạng" value={condition} onChange={(e) => setCondition(e.target.value)} />
        <MoneyInput label="Giá trị" value={value} onChange={setValue} />
        <div className="flex flex-wrap gap-2">
          {copy.status === 'damaged' && (
            <Button size="sm" variant="tonal" disabled={busy} onClick={() => act(() => patch(`/api/v1/library/copies/${copy.id}`, { status: 'available' }), 'Đã đưa bản sách lên kệ.')}>
              Đã sửa xong – đưa lên kệ
            </Button>
          )}
          {copy.status === 'available' && (
            <Button size="sm" variant="destructive-outline" disabled={busy} onClick={() => act(() => patch(`/api/v1/library/copies/${copy.id}`, { status: 'damaged' }), 'Đã chuyển bản sách sang Hỏng.')}>
              Đánh dấu hỏng
            </Button>
          )}
          {copy.status === 'lost' && canFind && (
            <Button size="sm" variant="tonal" disabled={busy} onClick={() => act(() => post(`/api/v1/library/copies/${copy.id}/found`), 'Đã tìm thấy sách; phí mất chưa thu đã được hủy.')}>
              Đã tìm thấy
            </Button>
          )}
        </div>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

function ReserveDialog({ titleId, title, onClose, onDone }: { titleId: string; title: string; onClose: () => void; onDone: () => void }) {
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const s = useSubmit(
    async () => {
      await post('/api/v1/library/reservations', { titleId, customerId: customer!.id });
      toast.success('Đã đặt giữ. Khi có sách trả về, gọi khách từ mục Đang giữ.');
      onDone();
    },
    onClose,
  );
  return (
    <FormDialog title={`Đặt giữ “${title}”`} busy={s.busy} error={s.error} disabled={!customer} onSave={s.run} onClose={onClose} confirm="Đặt giữ">
      <BorrowerPicker value={customer} onChange={setCustomer} />
    </FormDialog>
  );
}

// Spine labels (FR-LIB-17, Design §16.5): stacked accession barcode, Dewey and Cutter, 30 × 45 mm.
type LabelItem = { barcode: string; callNo: string | null; dewey: string | null; cutter: string | null; title: string; language: string };

/** A Dewey number with more than three decimals breaks after the third: 895.922 / 34. */
function deweyLines(dewey: string): string[] {
  const m = /^(\d{3}\.\d{3})(\d+)$/.exec(dewey);
  return m ? [m[1]!, m[2]!] : [dewey];
}

function labelsHtml(items: LabelItem[], sheet: 'roll' | 'a4'): string {
  const cell = (i: LabelItem) => {
    const lines = i.dewey ? [...deweyLines(i.dewey), ...(i.cutter ? [i.cutter] : [])] : null;
    return (
      `<div class="lb">${barcodeSvg(i.barcode, { moduleMm: 0.2, heightMm: 8, showText: false })}<div class="no">${escapeXml(i.barcode)}</div>` +
      (lines ? `<div class="cn">${lines.map((l) => `<div>${escapeXml(l)}</div>`).join('')}</div>` : `<div class="ti">${escapeXml(i.title)}</div>`) +
      '</div>'
    );
  };
  const page = sheet === 'a4' ? { w: 210, h: 297, cols: 6, rows: 6, lw: 30, lh: 45 } : { w: 30, h: 45, cols: 1, rows: 1, lw: 30, lh: 45 };
  const per = page.cols * page.rows;
  const pages: string[] = [];
  for (let i = 0; i < items.length; i += per) pages.push(`<section class="page">${items.slice(i, i + per).map((x) => `<div class="cell">${cell(x)}</div>`).join('')}</section>`);
  const mx = Math.max(0, (page.w - page.cols * page.lw) / 2);
  const my = Math.max(0, (page.h - page.rows * page.lh) / 2);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Tem gáy sách</title><style>
@page { size: ${page.w}mm ${page.h}mm; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Be Vietnam Pro", Arial, sans-serif; color: #000; background: #fff; }
.page { width: ${page.w}mm; height: ${page.h}mm; padding: ${my}mm ${mx}mm; display: grid; grid-template-columns: repeat(${page.cols}, ${page.lw}mm); grid-auto-rows: ${page.lh}mm; page-break-after: always; }
.cell { overflow: hidden; padding: 1.5mm 1mm; text-align: center; }
.lb svg { display: block; margin: 0 auto; max-width: 100%; }
.no { font-size: 7pt; font-weight: 500; margin-top: 0.5mm; }
.cn { margin-top: 2mm; font-size: 14pt; font-weight: 700; line-height: 1.15; }
.ti { margin-top: 2mm; font-size: 8pt; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
</style></head><body>${pages.join('')}</body></html>`;
}

function LabelsDialog({ copyIds, onClose }: { copyIds: string[]; onClose: () => void }) {
  const [sheet, setSheet] = useState<'roll' | 'a4'>('roll');
  const s = useSubmit(async () => {
    const r = await get<{ items: LabelItem[] }>('/api/v1/library/labels', { copyIds: copyIds.join(',') });
    printHtml(labelsHtml(r.items, sheet));
  }, onClose);
  return (
    <FormDialog title={`In tem gáy ${copyIds.length} cuốn`} busy={s.busy} error={s.error} onSave={s.run} onClose={onClose} confirm="In">
      <p className="text-sm text-ink-700">Mỗi tem: mã vạch mã cá biệt, số Dewey và Cutter xếp chồng.</p>
      <SelectField label="Khổ giấy" value={sheet} onChange={(e) => setSheet(e.target.value as 'roll' | 'a4')}>
        <option value="roll">Cuộn tem 30 × 45 mm</option>
        <option value="a4">A4, 36 tem</option>
      </SelectField>
    </FormDialog>
  );
}

// =============================================================================================
// Customer page, Library section (FR-LIB-15); the customer page has no tabs (Design §12.3)

export function CustomerLibrarySection({ customerId }: { customerId: string }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [waive, setWaive] = useState<Charge | null>(null);
  const [paying, setPaying] = useState(false);
  const [reason, setReason] = useState('');
  const b = useQuery({ queryKey: ['library-borrower', customerId], queryFn: () => get<Borrower>(`/api/v1/library/borrowers/${customerId}`) });
  if (b.error) return <ErrorState error={b.error} onRetry={() => b.refetch()} />;
  if (!b.data) return <Skeleton className="h-40" />;
  const d = b.data;
  const loanCols: Column<Loan>[] = [
    {
      header: 'Sách',
      cell: (l) => (
        <span className="flex flex-col">
          <span className="font-medium">{l.title}</span>
          <span className="code text-[13px] text-ink-500">{l.barcode}</span>
        </span>
      ),
    },
    { header: 'Ngày mượn', cell: (l) => <span className="num">{formatDate(l.loanedAt)}</span> },
    { header: 'Hạn trả', cell: (l) => <DueCell loan={l} /> },
    { header: 'Gia hạn', align: 'right', cell: (l) => l.renewals },
  ];
  const histCols: Column<Loan>[] = [
    loanCols[0]!,
    loanCols[1]!,
    { header: 'Trả ngày', cell: (l) => <span className="num">{formatDate(l.returnedAt)}</span> },
    { header: 'Kết quả', cell: (l) => (l.closedAs === 'lost' ? <StatusChip tone="danger">Mất</StatusChip> : 'Đã trả') },
  ];
  const chargeCols: Column<Charge>[] = [
    { header: 'Ngày', cell: (c) => <span className="num">{formatDate(c.createdAt)}</span> },
    { header: 'Khoản', cell: (c) => `${CHARGE[c.kind] ?? c.kind}${c.barcode ? ` – ${c.barcode}` : ''}` },
    {
      header: 'Số tiền',
      align: 'right',
      cell: (c) => (
        <span>
          {c.discountPct > 0 && <s className="mr-2 text-ink-500">{formatVnd(c.listVnd)}</s>}
          {formatVnd(c.amountVnd)}
        </span>
      ),
    },
    {
      header: 'Trạng thái',
      cell: (c) => (
        <span className="flex flex-col items-start gap-1">
          <StatusChip tone={CHARGE_STATUS[c.status]?.tone ?? 'neutral'}>{CHARGE_STATUS[c.status]?.label ?? c.status}</StatusChip>
          {c.receiptNo && <span className="code text-[13px] text-ink-500">{c.receiptNo}</span>}
          {c.reason && <span className="text-[13px] text-ink-500">{c.reason}</span>}
        </span>
      ),
    },
    {
      header: '',
      cell: (c) =>
        c.status === 'unpaid' && can(me, 'library.fine_waive') ? (
          <Button size="sm" variant="ghost" onClick={() => setWaive(c)}>
            Miễn phí
          </Button>
        ) : null,
    },
  ];
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-ink-900">Thư viện</h2>
      <EligibilityCard b={d} {...(can(me, 'library.lend') && { onPay: () => setPaying(true) })} />
      {paying && <PayChargesDialog customerId={customerId} onClose={() => setPaying(false)} />}
      <h3 className="text-sm font-semibold">Đang mượn ({d.openLoans.length})</h3>
      <DataTable columns={loanCols} rows={d.openLoans} rowKey={(l) => l.id} minWidth={560} empty={{ icon: Library, title: 'Không có sách đang mượn' }} />
      <h3 className="text-sm font-semibold">Khoản thu thư viện</h3>
      <DataTable columns={chargeCols} rows={d.charges} rowKey={(c) => c.id} minWidth={640} empty={{ icon: Library, title: 'Chưa có khoản thu nào' }} />
      <h3 className="text-sm font-semibold">Lịch sử mượn</h3>
      <DataTable columns={histCols} rows={d.history} rowKey={(l) => l.id} minWidth={560} empty={{ icon: Library, title: 'Chưa có lượt mượn đã trả' }} />
      {waive && (
        <ConfirmDialog
          title={`Miễn ${CHARGE[waive.kind]?.toLowerCase() ?? 'khoản'} ${formatVnd(waive.amountVnd)}?`}
          confirm="Miễn phí"
          destructive
          onConfirm={async () => {
            await post(`/api/v1/library/charges/${waive.id}/waive`, { reason });
            void qc.invalidateQueries({ queryKey: ['library-borrower', customerId] });
            setReason('');
          }}
          onClose={() => setWaive(null)}
        >
          <TextArea label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} />
        </ConfirmDialog>
      )}
    </section>
  );
}

// =============================================================================================
// Library report (FR-LIB-16, FR-RPT-07)

interface LibraryReport {
  loans: number;
  renewals: number;
  returns: number;
  borrowers: number;
  openLoans: number;
  overdueLoans: number;
  loanFeesVnd: number;
  lateFeesVnd: number;
  lossChargesVnd: number;
  waivedVnd: number;
  popular: { callNo: string | null; title: string; loans: number }[];
  collection: { language: string; status: string; n: number }[];
}

export function LibraryReportPage() {
  const [time, setTime] = useParam('time', '30d');
  const days = timeDays(time);
  const r = useQuery({ queryKey: ['report-library', time], enabled: !!days, queryFn: () => get<LibraryReport>('/api/v1/reports/library', { from: days![0], to: days![1] }) });
  const d = r.data;
  const kpi = (label: string, value: ReactNode) => (
    <div className="rounded-lg border border-paper-300 bg-white p-4 shadow-sm">
      <p className="text-[13px] text-ink-500">{label}</p>
      <p className="mt-1 text-xl font-semibold num">{value}</p>
    </div>
  );
  const byStatus = (lang: string) => Object.keys(COPY_STATUS).map((s) => d?.collection.find((c) => c.language === lang && c.status === s)?.n ?? 0);
  return (
    <>
      <PageHeader title="Báo cáo thư viện" />
      <div className="mb-4 flex">
        <FilterMenu groups={[{ kind: 'custom', label: 'Thời gian', summary: timeLabel(time), active: time !== '30d', onClear: () => setTime('30d'), content: <TimeFilter value={time} onChange={setTime} allowAll={false} /> }]} />
      </div>
      {r.error && <ErrorState error={r.error} onRetry={() => r.refetch()} />}
      {!d && !r.error && <Skeleton className="h-40" />}
      {d && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {kpi('Lượt mượn', formatNumber(d.loans))}
            {kpi('Lượt gia hạn', formatNumber(d.renewals))}
            {kpi('Lượt trả', formatNumber(d.returns))}
            {kpi('Người mượn', formatNumber(d.borrowers))}
            {kpi('Đang cho mượn', formatNumber(d.openLoans))}
            {kpi('Đang quá hạn', <span className={d.overdueLoans ? 'text-danger-700' : ''}>{formatNumber(d.overdueLoans)}</span>)}
            {kpi('Phí mượn đã thu', formatVnd(d.loanFeesVnd))}
            {kpi('Phí trễ đã thu', formatVnd(d.lateFeesVnd))}
            {kpi('Phí mất, hỏng đã thu', formatVnd(d.lossChargesVnd))}
            {kpi('Đã miễn', formatVnd(d.waivedVnd))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Sách được mượn nhiều">
              {d.popular.length === 0 ? (
                <EmptyState icon={Library} title="Chưa có lượt mượn trong kỳ" />
              ) : (
                <ol className="flex flex-col gap-2 text-sm">
                  {d.popular.map((p) => (
                    <li key={p.title} className="flex gap-3">
                      <span className="code w-28 shrink-0">{p.callNo ?? '—'}</span>
                      <span className="min-w-0 flex-1 truncate">{p.title}</span>
                      <span className="font-semibold num">{p.loans}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
            <Card title="Bản sách theo trạng thái">
              <table className="w-full text-sm num">
                <thead>
                  <tr className="text-left text-ink-500">
                    <th className="py-1 font-medium" />
                    {Object.values(COPY_STATUS).map((s) => (
                      <th key={s.label} className="py-1 text-right font-medium">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {['vi', 'en'].map((lang) => (
                    <tr key={lang} className="border-t border-paper-300">
                      <td className="py-2">{lang === 'vi' ? 'Tiếng Việt' : 'Tiếng Anh'}</td>
                      {byStatus(lang).map((n, i) => (
                        <td key={i} className="py-2 text-right">
                          {formatNumber(n)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
