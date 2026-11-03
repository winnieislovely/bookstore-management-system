import { barcodeSvg, BORROW_BLOCK_TEXT, dueAfter, escapeXml, type BorrowBlock } from '@bookstore/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, ArrowLeftRight, BookmarkCheck, CheckCircle2, ClipboardCheck, Library, Phone, Plus, Printer, Search, Truck, User, UserPlus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog, DataTable, Facts, FilterMenu, SearchBox, SelectField, Tabs, TextArea, TimeFilter, errText, timeDays, timeLabel, toast, useDebounced, useParam, type Column } from '../components/data';
import { ProductSearch } from '../components/product-search';
import { Button, Card, EmptyState, ErrorState, Field, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { formatDate, formatNumber, formatPhone, formatVnd } from '../lib/format';
import { printHtml } from '../lib/print';
import { can, useMe } from '../lib/session';
import { Dialog, MoneyInput } from '../pos/widgets';

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
  code: string;
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
  code: string;
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
  saleDocNo: string | null;
  code: string | null;
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

interface TitleRow {
  id: string;
  code: string;
  title: string;
  authors: string[];
  language: string;
  category: string | null;
  callNo: string | null;
  copies: number;
  available: number;
  queued: number;
}

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

/** Fee per copy, the list fee struck through when the buyer discount applies (FR-LIB-18). */
function Fee({ fee }: { fee: Borrower['fee'] }) {
  return (
    <span className="whitespace-nowrap num">
      {fee.discountPct > 0 && <s className="mr-2 text-ink-500">{formatVnd(fee.listVnd)}</s>}
      <span className="font-semibold">{formatVnd(fee.amountVnd)}</span>
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
      <Field label="Số điện thoại hoặc tên khách" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
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
        Tạo khách hàng
      </Button>
    </div>
  );
}

/** Eligibility card (UC-17 step 2): loans out of the limit, overdue, unpaid charges, buyer discount. */
function EligibilityCard({ b }: { b: Borrower }) {
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
          {k === 'unpaid_charges' && ' Thu tại quầy bán hàng trước khi mượn tiếp.'}
        </p>
      ))}
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
  const [copies, setCopies] = useState<{ barcode: string; title: string; code: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ totalFeeVnd: number; dueAt: string; count: number } | null>(null);
  const b = useQuery({ queryKey: ['library-borrower', customer?.id], enabled: !!customer, queryFn: () => get<Borrower>(`/api/v1/library/borrowers/${customer!.id}`) });
  const add = async () => {
    const code = scan.trim().toUpperCase();
    if (!code) return;
    setScan('');
    setError(null);
    if (copies.some((c) => c.barcode === code)) return;
    try {
      const r = await get<{ items: TitleRow[] }>('/api/v1/library/titles', { q: code, limit: 1 });
      const t = r.items[0];
      if (!t) throw new Error(`Không tìm thấy bản sách có mã ${code}.`);
      setCopies((cs) => [...cs, { barcode: code, title: t.title, code: t.code }]);
    } catch (e) {
      setError(errText(e));
    }
  };
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ totalFeeVnd: number; dueAt: string; loans: unknown[] }>('/api/v1/library/loans/checkout', { customerId: customer!.id, barcodes: copies.map((c) => c.barcode) });
      setDone({ totalFeeVnd: r.totalFeeVnd, dueAt: r.dueAt, count: r.loans.length });
      void qc.invalidateQueries({ queryKey: ['library-loans'] });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  if (done) {
    return (
      <Dialog title="Đã cho mượn" size="sm" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Xong</Button>}>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-success-50 text-success-700">
            <CheckCircle2 size={36} aria-hidden />
          </span>
          <p className="text-lg font-semibold">
            Đã cho mượn {done.count} cuốn – thu {formatVnd(done.totalFeeVnd)} tại quầy
          </p>
          <p className="text-ink-700">
            Hạn trả <span className="text-xl font-semibold num">{formatDate(done.dueAt)}</span>
          </p>
          <p className="text-sm text-ink-500">Thu ngân thêm phí vào giỏ khi gắn khách {customer?.name} ở màn hình Bán hàng.</p>
        </div>
      </Dialog>
    );
  }
  const data = b.data;
  const due = data ? dueAfter(new Date(), data.loanDays) : null;
  return (
    <Dialog
      title="Cho mượn sách"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!data || data.blocks.length > 0 || copies.length === 0} onClick={confirm}>
            Xác nhận cho mượn
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-ink-700">1. Người mượn</h3>
          <BorrowerPicker
            value={customer}
            onChange={(c) => {
              setCustomer(c);
              setCopies([]);
            }}
          />
          {b.isLoading && customer && <Skeleton className="h-20" />}
          {b.error && <ErrorState error={b.error} onRetry={() => b.refetch()} />}
          {data && <EligibilityCard b={data} />}
        </section>
        {data && data.blocks.length === 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold text-ink-700">2. Quét sách</h3>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <input
                className="h-11 min-w-0 flex-1 rounded-md border border-paper-500 bg-white px-3 code focus:border-navy-700"
                placeholder="Quét hoặc nhập mã bản sách, ví dụ VN-0123-2"
                aria-label="Mã bản sách"
                autoFocus
                value={scan}
                onChange={(e) => setScan(e.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={!scan.trim()}>
                Thêm
              </Button>
            </form>
            {copies.length > 0 && (
              <ul className="divide-y divide-paper-300 rounded-md border border-paper-300">
                {copies.map((c) => (
                  <li key={c.barcode} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{c.title}</span>
                      <span className="code text-ink-500">{c.barcode}</span>
                    </span>
                    <Fee fee={data.fee} />
                    <Button variant="ghost" size="sm" icon={X} aria-label="Bỏ cuốn này" onClick={() => setCopies((cs) => cs.filter((x) => x.barcode !== c.barcode))} />
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 bg-paper-100 px-3 py-2 text-sm">
                  <span>
                    Hạn trả <span className="text-lg font-semibold num">{due && formatDate(due)}</span>
                  </span>
                  <span className="font-semibold num">Tổng phí {formatVnd(data.fee.amountVnd * copies.length)}</span>
                </li>
              </ul>
            )}
            {copies.length + data.openLoans.length > data.maxLoans && <InlineAlert tone="warning">Khách chỉ được mượn tối đa {data.maxLoans} cuốn cùng lúc.</InlineAlert>}
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
  barcode: string;
  code: string;
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
  const [busy, setBusy] = useState<'ok' | 'damaged' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const submit = async (condition: 'ok' | 'damaged') => {
    setBusy(condition);
    setError(null);
    try {
      setResult(await post<CheckinResult>('/api/v1/library/loans/checkin', { barcode: barcode.trim(), condition }));
      void qc.invalidateQueries({ queryKey: ['library-loans'] });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };
  const next = () => {
    setResult(null);
    setBarcode('');
  };
  const owed = result ? result.lateFeeVnd + result.damageVnd : 0;
  return (
    <Dialog title="Nhận trả sách" size="sm" onClose={onClose}>
      {result ? (
        <div className="flex flex-col gap-4">
          <div className={`flex flex-col gap-1 rounded-lg p-4 ${result.daysLate > 0 || result.damageVnd > 0 ? 'bg-danger-50' : 'bg-success-50'}`}>
            <p className="font-semibold">{result.title}</p>
            <p className="code text-sm text-ink-700">{result.barcode}</p>
            <p className="text-sm">
              {result.customerName} · hạn trả <span className="num">{formatDate(result.dueAt)}</span>
            </p>
            {result.daysLate > 0 ? (
              <p className="font-semibold text-danger-700 num">
                Trễ {result.daysLate} ngày – phí trả trễ {formatVnd(result.lateFeeVnd)}
              </p>
            ) : (
              <p className="font-semibold text-success-700">Trả đúng hạn</p>
            )}
            {result.damageVnd > 0 && <p className="font-semibold text-danger-700 num">Sách hỏng – phí {formatVnd(result.damageVnd)}</p>}
            {owed > 0 && <p className="text-sm text-ink-700">Khách thanh toán tại quầy bán hàng.</p>}
          </div>
          {result.hold && (
            <InlineAlert tone="info">
              Giữ cho {result.hold.customerName} – gọi <CallLink phone={result.hold.customerPhone} /> (giữ đến {formatDate(result.hold.holdUntil)}).
            </InlineAlert>
          )}
          <Button variant="primary" full onClick={next}>
            Nhận cuốn khác
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Mã bản sách" className="code" autoFocus value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Quét mã trên tem sách" />
          <p className="text-[13px] font-medium text-ink-700">Tình trạng sách</p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="primary" size="xl" loading={busy === 'ok'} disabled={!barcode.trim() || !!busy} onClick={() => submit('ok')}>
              OK
            </Button>
            <Button variant="destructive-outline" size="xl" loading={busy === 'damaged'} disabled={!barcode.trim() || !!busy} onClick={() => submit('damaged')}>
              Hỏng
            </Button>
          </div>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
      )}
    </Dialog>
  );
}

// =============================================================================================
// Mượn / trả: loan lists with call links (FR-LIB-14, Design §13.8)

type DeskTab = 'open' | 'due_soon' | 'overdue' | 'held';

export function LibraryDeskPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useParam('tab', 'open');
  const [q, setQ] = useParam('q');
  const [dialog, setDialog] = useState<null | { kind: 'borrow' } | { kind: 'return'; barcode?: string } | { kind: 'renew'; loan: Loan } | { kind: 'lost'; loan: Loan } | { kind: 'unhold'; hold: Hold }>(null);
  const list = useQuery({
    queryKey: ['library-loans', tab, q],
    queryFn: () => get<{ counts: { open: number; dueSoon: number; overdue: number; held: number }; items: Loan[]; holds: Hold[] }>('/api/v1/library/loans', { filter: tab, q: q || undefined }),
  });
  const counts = list.data?.counts;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['library-loans'] });
  const fee = useQuery({ queryKey: ['settings-library-fee'], enabled: dialog?.kind === 'renew', queryFn: () => get<Borrower>(`/api/v1/library/borrowers/${(dialog as { loan: Loan }).loan.customerId}`) });
  const loanColumns: Column<Loan>[] = [
    {
      header: 'Người mượn',
      cell: (l) => (
        <span className="flex flex-col">
          <Link to={`/customers/${l.customerId}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {l.customerName}
          </Link>
          <CallLink phone={l.customerPhone} />
        </span>
      ),
    },
    {
      header: 'Sách',
      cell: (l) => (
        <span className="flex flex-col">
          <span className="line-clamp-2 font-medium">{l.title}</span>
          <span className="code text-[13px] text-ink-500">{l.barcode}</span>
        </span>
      ),
    },
    { header: 'Hạn trả', cell: (l) => <DueCell loan={l} /> },
    { header: 'Phí trễ', align: 'right', cell: (l) => (l.lateFeeVnd ? <span className="text-danger-700">{formatVnd(l.lateFeeVnd)}</span> : '—') },
    {
      header: '',
      className: 'whitespace-nowrap',
      cell: (l) => (
        <span className="flex justify-end gap-1">
          <Button size="sm" variant="secondary" disabled={l.renewalsLeft === 0 || l.overdue} onClick={() => setDialog({ kind: 'renew', loan: l })}>
            Gia hạn
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'return', barcode: l.barcode })}>
            Nhận trả
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'lost', loan: l })}>
            Báo mất
          </Button>
        </span>
      ),
    },
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
                Cho mượn
              </Button>
            </>
          )
        }
      />
      <Tabs<DeskTab>
        tabs={[
          { key: 'open', label: 'Đang mượn', ...(counts && { count: counts.open }) },
          { key: 'due_soon', label: 'Sắp đến hạn', ...(counts && { count: counts.dueSoon }) },
          { key: 'overdue', label: 'Quá hạn', ...(counts && { count: counts.overdue }) },
          { key: 'held', label: 'Đang giữ', ...(counts && { count: counts.held }) },
        ]}
        value={tab as DeskTab}
        onChange={setTab}
      />
      <div className="mb-4">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm tên, SĐT khách hoặc tên sách, mã bản…" />
      </div>
      {tab === 'held' ? (
        <DataTable columns={holdColumns} rows={list.data?.holds} rowKey={(h) => h.id} error={list.error} onRetry={() => list.refetch()} empty={{ icon: BookmarkCheck, title: 'Không có sách đang giữ cho khách' }} />
      ) : (
        <DataTable
          columns={loanColumns}
          rows={list.data?.items}
          rowKey={(l) => l.id}
          error={list.error}
          onRetry={() => list.refetch()}
          minWidth={860}
          empty={q ? { icon: Search, title: 'Không có lượt mượn phù hợp', help: 'Thử đổi từ khóa.' } : { icon: Library, title: tab === 'overdue' ? 'Không có sách quá hạn' : tab === 'due_soon' ? 'Không có sách sắp đến hạn' : 'Chưa có sách nào đang được mượn' }}
        />
      )}
      {dialog?.kind === 'borrow' && <BorrowDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'return' && <ReturnDialog {...(dialog.barcode && { initialBarcode: dialog.barcode })} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'renew' && (
        <ConfirmDialog
          title={`Gia hạn “${dialog.loan.title}”?`}
          body={`Thêm ${fee.data?.loanDays ?? '…'} ngày từ hạn trả hiện tại và thu thêm ${fee.data ? formatVnd(fee.data.fee.amountVnd) : '…'} tại quầy. Còn ${dialog.loan.renewalsLeft} lần gia hạn.`}
          confirm="Gia hạn"
          onConfirm={async () => {
            const r = await post<{ dueAt: string }>(`/api/v1/library/loans/${dialog.loan.id}/renew`);
            toast.success(`Đã gia hạn đến ${formatDate(r.dueAt)}.`);
            refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
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
          }}
          onClose={() => setDialog(null)}
        />
      )}
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
// Danh mục & bản sách (FR-LIB-01..04)

export function LibraryCatalogPage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [q, setQ] = useParam('q');
  const [language, setLanguage] = useParam('lang');
  const [status, setStatus] = useParam('status');
  const [category, setCategory] = useParam('category');
  const [dialog, setDialog] = useState<null | 'new' | 'stocktake'>(null);
  const list = useQuery({
    queryKey: ['library-titles', q, language, status, category],
    queryFn: () => get<{ items: TitleRow[]; categories: string[] }>('/api/v1/library/titles', { q: q || undefined, language: language || undefined, status: status || undefined, category: category || undefined }),
  });
  const columns: Column<TitleRow>[] = [
    { header: 'Mã thư viện', cell: (r) => <span className="code font-medium">{r.code}</span> },
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
  const filtered = !!(q || language || status || category);
  return (
    <>
      <PageHeader
        title="Danh mục & bản sách"
        actions={
          manage && (
            <>
              <Button variant="secondary" icon={ClipboardCheck} onClick={() => setDialog('stocktake')}>
                Kiểm kê kệ
              </Button>
              <Button variant="primary" icon={Plus} onClick={() => setDialog('new')}>
                Thêm đầu sách
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchBox value={q} onChange={setQ} placeholder="Tìm mã thư viện, mã bản, tên sách, tác giả, ISBN…" />
        </div>
        <FilterMenu
          groups={[
            { kind: 'single', label: 'Ngôn ngữ', options: [{ key: 'vi', label: 'Tiếng Việt' }, { key: 'en', label: 'Tiếng Anh' }], value: language, onChange: setLanguage },
            { kind: 'single', label: 'Trạng thái', options: Object.entries(COPY_STATUS).map(([key, s]) => ({ key, label: `Có bản ${s.label.toLowerCase()}` })), value: status, onChange: setStatus },
            { kind: 'single', label: 'Thể loại', options: (list.data?.categories ?? []).map((c) => ({ key: c, label: c })), value: category, onChange: setCategory },
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
        empty={filtered ? { icon: Search, title: 'Không có đầu sách phù hợp', help: 'Thử đổi từ khóa hoặc bộ lọc.' } : { icon: Library, title: 'Thư viện chưa có đầu sách', help: 'Thêm đầu sách rồi thêm bản sách để in tem.' }}
      />
      {dialog === 'new' && <TitleForm title={null} onClose={() => setDialog(null)} onSaved={(id) => navigate(`/library/titles/${id}`)} />}
      {dialog === 'stocktake' && <StocktakeDialog onClose={() => setDialog(null)} />}
    </>
  );
}

interface TitleDetail {
  id: string;
  code: string;
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

function TitleForm({ title, onClose, onSaved }: { title: TitleDetail | null; onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    code: title?.code ?? '',
    title: title?.title ?? '',
    authors: title?.authors.join(', ') ?? '',
    isbn13: title?.isbn13 ?? '',
    publisher: title?.publisher ?? '',
    year: title?.year ? String(title.year) : '',
    language: title?.language ?? 'vi',
    category: title?.category ?? '',
    callNo: title?.callNo ?? '',
  });
  const [codeTouched, setCodeTouched] = useState(!!title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The next free code for the language, until staff type their own (Design §13.8).
  const next = useQuery({ queryKey: ['library-next-code', f.language], enabled: !title, queryFn: () => get<{ code: string }>('/api/v1/library/titles/next-code', { lang: f.language }) });
  const code = codeTouched ? f.code : (next.data?.code ?? '');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        code,
        title: f.title,
        authors: f.authors.split(',').map((a) => a.trim()).filter(Boolean),
        isbn13: f.isbn13 || null,
        publisher: f.publisher || null,
        year: f.year ? Number(f.year) : null,
        language: f.language,
        category: f.category || null,
        callNo: f.callNo || null,
      };
      const r = title ? await patch<{ id: string }>(`/api/v1/library/titles/${title.id}`, body) : await post<{ id: string }>('/api/v1/library/titles', body);
      toast.success('Đã lưu đầu sách.');
      void qc.invalidateQueries({ queryKey: ['library-titles'] });
      void qc.invalidateQueries({ queryKey: ['library-title', r.id] });
      onSaved(r.id);
      onClose();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={title ? `Sửa ${title.code}` : 'Thêm đầu sách'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!code.trim() || !f.title.trim()} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField label="Ngôn ngữ" required value={f.language} onChange={set('language')}>
          <option value="vi">Tiếng Việt</option>
          <option value="en">Tiếng Anh</option>
        </SelectField>
        <Field
          label="Mã thư viện"
          required
          className="code"
          value={code}
          helper={title ? 'Đổi mã không đổi mã trên các tem đã in.' : 'Gợi ý mã kế tiếp; có thể sửa.'}
          onChange={(e) => {
            setCodeTouched(true);
            setF({ ...f, code: e.target.value.toUpperCase() });
          }}
        />
        <Field label="Tên sách" required className="sm:col-span-2" autoFocus={!!title} value={f.title} onChange={set('title')} />
        <Field label="Tác giả" helper="Nhiều tác giả cách nhau bởi dấu phẩy." className="sm:col-span-2" value={f.authors} onChange={set('authors')} />
        <Field label="ISBN" className="code" value={f.isbn13} onChange={set('isbn13')} />
        <Field label="Nhà xuất bản" value={f.publisher} onChange={set('publisher')} />
        <Field label="Năm xuất bản" inputMode="numeric" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
        <Field label="Thể loại" value={f.category} onChange={set('category')} />
        <Field label="Số hiệu kệ" className="sm:col-span-2" value={f.callNo} onChange={set('callNo')} />
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
  const [dialog, setDialog] = useState<null | 'edit' | 'add' | 'transfer' | 'labels' | 'reserve' | { kind: 'copy'; copy: TitleDetail['copies'][number] } | { kind: 'unreserve'; hold: Hold }>(null);
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
    { header: 'Mã bản', cell: (c) => <span className="code font-medium">{c.barcode}</span> },
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
            Danh mục & bản sách
          </Link>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="code">{d.code}</span>
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
                <Button size="sm" variant="secondary" icon={Printer} disabled={selected.size === 0} onClick={() => setDialog('labels')}>
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
                ['Số hiệu kệ', d.callNo ?? '—'],
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
      {dialog === 'add' && <AddCopiesDialog titleId={d.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'transfer' && <TransferDialog titleId={d.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'labels' && <LabelsDialog copyIds={[...selected]} onClose={() => setDialog(null)} />}
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

function AddCopiesDialog({ titleId, onClose, onDone }: { titleId: string; onClose: () => void; onDone: () => void }) {
  const [count, setCount] = useState('1');
  const [value, setValue] = useState<number | null>(null);
  const [via, setVia] = useState<'purchase' | 'donation'>('purchase');
  const [shelf, setShelf] = useState('');
  const [condition, setCondition] = useState('');
  const s = useSubmit(
    async () => {
      const r = await post<{ items: { barcode: string }[] }>(`/api/v1/library/titles/${titleId}/copies`, { count: Number(count), valueVnd: value ?? 0, acquiredVia: via, shelf: shelf || null, condition: condition || null });
      toast.success(`Đã thêm ${r.items.map((c) => c.barcode).join(', ')}.`);
      onDone();
    },
    onClose,
  );
  return (
    <FormDialog title="Thêm bản sách" busy={s.busy} error={s.error} disabled={!Number(count)} onSave={s.run} onClose={onClose} confirm="Thêm">
      <Field label="Số bản" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 2))} />
      <MoneyInput label="Giá trị mỗi bản (dùng khi tính phí mất, hỏng)" value={value} onChange={setValue} />
      <SelectField label="Nguồn" value={via} onChange={(e) => setVia(e.target.value as 'purchase' | 'donation')}>
        <option value="purchase">Mua</option>
        <option value="donation">Được tặng</option>
      </SelectField>
      <Field label="Kệ" value={shelf} onChange={(e) => setShelf(e.target.value)} />
      <Field label="Tình trạng" value={condition} onChange={(e) => setCondition(e.target.value)} />
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

// Book labels (FR-LIB-17, Design §16.5): library code large, Code 128 of the copy barcode, short title, language.
function labelsHtml(items: { barcode: string; code: string; title: string; language: string }[], sheet: 'roll' | 'a4'): string {
  const cell = (i: (typeof items)[number]) =>
    `<div class="lb"><div class="top"><b>${escapeXml(i.code)}</b><span>${LANG[i.language] ?? ''}</span></div>${barcodeSvg(i.barcode, { moduleMm: 0.25, heightMm: 8 })}<div class="ti">${escapeXml(i.title)}</div></div>`;
  const page = sheet === 'a4' ? { w: 210, h: 297, cols: 5, rows: 13, lw: 38.1, lh: 21.2 } : { w: 40, h: 25, cols: 1, rows: 1, lw: 40, lh: 25 };
  const per = page.cols * page.rows;
  const pages: string[] = [];
  for (let i = 0; i < items.length; i += per) pages.push(`<section class="page">${items.slice(i, i + per).map((x) => `<div class="cell">${cell(x)}</div>`).join('')}</section>`);
  const mx = Math.max(0, (page.w - page.cols * page.lw) / 2);
  const my = Math.max(0, (page.h - page.rows * page.lh) / 2);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Tem sách thư viện</title><style>
@page { size: ${page.w}mm ${page.h}mm; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Be Vietnam Pro", Arial, sans-serif; color: #000; background: #fff; }
.page { width: ${page.w}mm; height: ${page.h}mm; padding: ${my}mm ${mx}mm; display: grid; grid-template-columns: repeat(${page.cols}, ${page.lw}mm); grid-auto-rows: ${page.lh}mm; page-break-after: always; }
.cell { overflow: hidden; padding: 1mm 1.5mm; text-align: center; }
.top { display: flex; justify-content: space-between; align-items: baseline; }
.top b { font-size: 14pt; } .top span { font-size: 7pt; font-weight: 600; }
.lb svg { max-width: 100%; }
.ti { font-size: 6pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style></head><body>${pages.join('')}</body></html>`;
}

function LabelsDialog({ copyIds, onClose }: { copyIds: string[]; onClose: () => void }) {
  const [sheet, setSheet] = useState<'roll' | 'a4'>('roll');
  const s = useSubmit(async () => {
    const r = await get<{ items: { barcode: string; code: string; title: string; language: string }[] }>('/api/v1/library/labels', { copyIds: copyIds.join(',') });
    printHtml(labelsHtml(r.items, sheet));
  }, onClose);
  return (
    <FormDialog title={`In tem ${copyIds.length} bản sách`} busy={s.busy} error={s.error} onSave={s.run} onClose={onClose} confirm="In">
      <SelectField label="Khổ giấy" value={sheet} onChange={(e) => setSheet(e.target.value as 'roll' | 'a4')}>
        <option value="roll">Cuộn tem 40 × 25 mm</option>
        <option value="a4">A4, 65 tem</option>
      </SelectField>
    </FormDialog>
  );
}

// Stock-take by shelf (FR-LIB-04): scan everything on the shelf, then compare.
function StocktakeDialog({ onClose }: { onClose: () => void }) {
  const [shelf, setShelf] = useState('');
  const [codes, setCodes] = useState('');
  type Row = { barcode: string; title: string; shelf: string | null; status: string };
  const [result, setResult] = useState<{ scanned: number; missing: Row[]; misplaced: Row[]; unknown: string[] } | null>(null);
  const s = useSubmit(async () => {
    setResult(await post('/api/v1/library/stocktake', { shelf: shelf || null, barcodes: codes.split(/\s+/).filter(Boolean) }));
  }, () => undefined);
  const list = (title: string, rows: Row[], tone: 'warning' | 'danger') =>
    rows.length > 0 && (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">
          {title} ({rows.length})
        </p>
        <ul className="divide-y divide-paper-300 rounded-md border border-paper-300 text-sm">
          {rows.map((r) => (
            <li key={r.barcode} className="flex items-center gap-2 px-3 py-2">
              <span className="code">{r.barcode}</span>
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <span className="text-ink-500">{r.shelf ?? '—'}</span>
              {r.status !== 'available' && <CopyChip status={r.status} />}
            </li>
          ))}
        </ul>
        <span className="sr-only">{tone}</span>
      </div>
    );
  return (
    <FormDialog title="Kiểm kê kệ sách" busy={s.busy} error={s.error} disabled={!codes.trim()} onSave={s.run} onClose={onClose} confirm="So sánh">
      <Field label="Kệ" helper="Để trống để so với cả thư viện." value={shelf} onChange={(e) => setShelf(e.target.value)} />
      <TextArea label="Mã bản đã quét (mỗi mã một dòng)" rows={6} className="code" value={codes} onChange={(e) => setCodes(e.target.value)} />
      {result && (
        <div className="flex flex-col gap-3">
          <InlineAlert tone={result.missing.length || result.misplaced.length || result.unknown.length ? 'warning' : 'success'}>
            Đã quét {formatNumber(result.scanned)} mã. {result.missing.length || result.misplaced.length || result.unknown.length ? 'Có chênh lệch, xem bên dưới.' : 'Khớp với dữ liệu.'}
          </InlineAlert>
          {list('Thiếu trên kệ', result.missing, 'danger')}
          {list('Sai chỗ hoặc sai trạng thái', result.misplaced, 'warning')}
          {result.unknown.length > 0 && <p className="text-sm">Mã không có trong thư viện: <span className="code">{result.unknown.join(', ')}</span></p>}
        </div>
      )}
    </FormDialog>
  );
}

// =============================================================================================
// Customer page, Library section (FR-LIB-15); the customer page has no tabs (Design §12.3)

export function CustomerLibrarySection({ customerId }: { customerId: string }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [waive, setWaive] = useState<Charge | null>(null);
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
          {c.saleDocNo && <span className="code text-[13px] text-ink-500">{c.saleDocNo}</span>}
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
      <EligibilityCard b={d} />
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
  popular: { code: string; title: string; loans: number }[];
  collection: { language: string; status: string; n: number }[];
}

export function LibraryReportPage() {
  const [time, setTime] = useParam('time', '30d');
  const days = timeDays(time);
  const r = useQuery({ queryKey: ['report-library', time], enabled: !!days, queryFn: () => get<LibraryReport>('/api/v1/reports/library', { from: days![0], to: days![1] }) });
  const d = r.data;
  const kpi = (label: string, value: ReactNode) => (
    <div className="rounded-lg border border-paper-300 bg-white p-4">
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
                    <li key={p.code} className="flex gap-3">
                      <span className="code w-20 shrink-0">{p.code}</span>
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
