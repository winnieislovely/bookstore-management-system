import { DENOMINATIONS_VND, type PriceCartResult } from '@bookstore/domain';
import { clsx } from 'clsx';
import { CheckCircle2, Printer, Search, ShieldCheck, Plus, User, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button, Field, InlineAlert } from '../components/ui';
import { ApiError, post } from '../lib/api';
import { formatNumber, formatPhone, formatVnd } from '../lib/format';
import { printSlip } from '../lib/print';
import { approveOffline, approveOnline, findCustomerByPhone, searchCustomersByName, type CartApproval, type CartCustomer } from './cart';
import type { Payment, SaleOutcome } from './actions';
import { Dialog, Keypad, PinPad } from './widgets';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------------------------
// Supervisor approval (FR-ADM-09, Design §10.9)

export function ApprovalDialog({ action, reason, online, onApproved, onClose }: { action: CartApproval['action']; reason: string; online: boolean; onApproved: (a: CartApproval) => void; onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const a = online ? await approveOnline(username, pin, action).catch((e) => (e instanceof ApiError && e.status === 0 ? approveOffline(username, pin, action) : Promise.reject(e))) : await approveOffline(username, pin, action);
      setApproved(a.approverName);
      setTimeout(() => onApproved(a), 1500);
    } catch (e) {
      setError(errText(e));
      setPin('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Cần quản lý duyệt" size="sm" onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-full bg-navy-100 text-navy-700">
          <ShieldCheck size={28} aria-hidden />
        </span>
        <p className="text-center text-ink-700">{reason}</p>
        {approved ? (
          <InlineAlert tone="success">Đã duyệt bởi {approved}</InlineAlert>
        ) : (
          <>
            <div className="w-full">
              <Field label="Người duyệt (tên đăng nhập)" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </div>
            <PinPad value={pin} onChange={setPin} />
            {error && <InlineAlert tone="danger">{error}</InlineAlert>}
            <Button variant="primary" size="lg" full loading={busy} disabled={!username || pin.length !== 6} onClick={submit}>
              Duyệt
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Payment (FR-POS-06, Design §13.4)

export type PaymentMethod = Payment['method'];
// “CK” keeps the three equal boxes on one line on a 360 px phone; screen readers hear the full name (Design §13.4).
const METHODS: { method: PaymentMethod; label: string; spoken?: string }[] = [
  { method: 'cash', label: 'Tiền mặt' },
  { method: 'transfer', label: 'CK', spoken: 'Chuyển khoản' },
  { method: 'card', label: 'Thẻ' },
];

/** Payment method in the payment dialog: round radio ticks, text only, always on one row (Design §13.4). */
export function PaymentMethodPicker({ value, onChange, disabled }: { value: PaymentMethod; onChange: (m: PaymentMethod) => void; disabled?: boolean }) {
  // Own group per render: the cart footer can be mounted twice (wide and narrow layouts).
  const name = useId();
  return (
    // Three equal boxes, each option centred in its box (Design §13.4).
    <fieldset className="grid grid-cols-3 gap-x-2" disabled={disabled}>
      <legend className="sr-only">Phương thức thanh toán</legend>
      {METHODS.map((m) => (
        <label key={m.method} className="flex h-11 min-w-0 cursor-pointer items-center justify-center gap-2 text-sm whitespace-nowrap">
          <input type="radio" name={name} className="size-[18px] shrink-0 accent-navy-700" checked={value === m.method} onChange={() => onChange(m.method)} aria-label={m.spoken} />
          {m.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Payment dialog: the method, then the amount given and change for cash (FR-POS-06, Design §13.4). */
export function PaymentSheet({
  priced,
  depositVnd = 0,
  online,
  onPay,
  onClose,
}: {
  priced: PriceCartResult;
  /** A collected pre-order's deposit, already paid (FR-POS-09). */
  depositVnd?: number;
  online: boolean;
  onPay: (payments: Payment[]) => Promise<void>;
  onClose: () => void;
}) {
  // One method pays the whole amount (FR-POS-06): no per-method amount field, no split payment.
  const amount = priced.totalVnd - depositVnd;
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [tendered, setTendered] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tenderedVnd = Number(tendered || 0);

  /** The tender; null while it is not complete (cash short of the amount). */
  const current = (): Payment | null => {
    if (amount <= 0) return null;
    if (method === 'cash') return tenderedVnd && tenderedVnd < amount ? null : { method, amountVnd: amount, tenderedVnd: tenderedVnd || amount };
    // Transfer: pressing Xác nhận means the money was seen in the account. Card: no approval code (FR-POS-06).
    return { method, amountVnd: amount };
  };

  const pay = async () => {
    const p = current();
    if (!p) return;
    setBusy(true);
    setError(null);
    try {
      await onPay([p]);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const change = method === 'cash' && tenderedVnd > amount ? tenderedVnd - amount : 0;

  return (
    <Dialog title="Phương thức thanh toán" size="lg" onClose={busy ? undefined : onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <PaymentMethodPicker value={method} onChange={(m) => { setMethod(m); setError(null); }} disabled={busy} />
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-ink-700">Tổng giá trị đơn</p>
            <p className="text-xl leading-7 font-bold whitespace-nowrap num">{formatVnd(amount)}</p>
          </div>
          {depositVnd > 0 && (
            <p className="text-right text-[13px] text-ink-500 num">
              Tổng {formatVnd(priced.totalVnd)} · Đã đặt cọc {formatVnd(depositVnd)}
            </p>
          )}
        </div>
        {method === 'cash' && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-ink-700">Khách đưa</p>
            <p className="h-12 rounded-md border border-paper-500 px-3 text-right text-lg leading-[46px] num">{tendered ? formatNumber(Number(tendered)) : '—'} ₫</p>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <p className="text-ink-700">Tiền thừa</p>
              <p className="text-xl leading-7 font-bold whitespace-nowrap text-success-700 num">{formatVnd(change)}</p>
            </div>
          </div>
          <Keypad onKey={(k) => setTendered((v) => (k === 'del' ? v.slice(0, -1) : (v + k).replace(/^0+/, '').slice(0, 10)))} />
        </div>
        )}
        {method === 'transfer' && !online && <InlineAlert tone="warning">Ngoại tuyến: khoản chuyển khoản sẽ ở trạng thái “Chưa xác minh” cho đến khi quản lý xác nhận.</InlineAlert>}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {/* One full-width “Xác nhận”, no icon; the dialog closes with its ✕ (Design §13.4). */}
        <Button variant="primary" size="lg" full loading={busy} disabled={!current()} onClick={() => void pay()}>
          Xác nhận
        </Button>
      </div>
    </Dialog>
  );
}

export function SaleDone({ outcome, onNew }: { outcome: SaleOutcome; onNew: () => void }) {
  return (
    // No title bar; the e-invoice email is requested from the sale record (Design §13.4, FR-POS-16).
    <Dialog title="Hoàn tất" size="sm" hideHeader>
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-success-50 text-success-700">
          <CheckCircle2 size={36} aria-hidden />
        </span>
        <p className="text-[13px] text-ink-500">Số đơn</p>
        <p className="text-2xl leading-8 font-semibold num" aria-live="polite">
          {outcome.docNo}
        </p>
        {outcome.changeVnd > 0 && (
          <>
            <p className="text-[13px] text-ink-500">Tiền thừa</p>
            <p className="text-[28px] leading-9 font-bold whitespace-nowrap text-success-700 num">{formatVnd(outcome.changeVnd)}</p>
          </>
        )}
        {outcome.offline && <InlineAlert tone="warning">Đã lưu ngoại tuyến. Đơn sẽ được đồng bộ và xuất hóa đơn điện tử khi có mạng.</InlineAlert>}
        <div className="flex w-full flex-col gap-2">
          <Button variant="primary" size="lg" full onClick={onNew}>
            Đơn mới
          </Button>
          {outcome.printSlip && outcome.saleId && (
            <Button variant="secondary" full icon={Printer} onClick={() => void printSlip(outcome.saleId!)}>
              In
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Shift close (FR-POS-18/19, Design §13.6)

export function CloseShiftDialog({ expectedVnd, source, onClose, onSubmit }: { expectedVnd: number; source: 'server' | 'device'; onClose: () => void; onSubmit: (counted: number, denominations: Record<string, number>, reason: string) => Promise<void> }) {
  // One row per note counted: pick the note, then the number of notes (Design §13.6).
  const [rows, setRows] = useState<{ id: number; note: number | null; qty: number | null }[]>([{ id: 0, note: null, qty: null }]);
  const [nextId, setNextId] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts: Record<string, number> = {};
  for (const r of rows) if (r.note && r.qty) counts[r.note] = (counts[r.note] ?? 0) + r.qty;
  const counted = Object.entries(counts).reduce((a, [d, n]) => a + Number(d) * n, 0);
  const used = new Set(rows.map((r) => r.note).filter((n): n is number => n !== null));
  const update = (id: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const variance = counted - expectedVnd;
  const tone = variance === 0 ? 'text-success-700' : variance < 0 ? 'text-danger-700' : 'text-warning-700';
  return (
    <Dialog
      title="Đóng ca"
      onClose={onClose}
      footer={
        <>
          {/* One full-width “Đóng ca”; the ✕ closes the dialog (Design §13.6). Never disabled for a variance — only for a missing reason (BR-06). */}
          <Button
            variant="primary"
            full
            loading={busy}
            disabled={variance !== 0 && !reason.trim()}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSubmit(counted, Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 0)), reason);
              } catch (e) {
                setError(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Đóng ca
          </Button>
        </>
      }
    >
      <p className="mb-2 text-[13px] font-medium text-ink-700">Tiền mặt trong ca</p>
      {/* No column headings: “Mệnh giá” and “Số tờ” are grey placeholders inside the fields (Design §13.6). */}
      <div className="flex flex-col gap-2 text-sm">
        {rows.map((r) => (
          // Mệnh giá at the left; Số tờ and ✕ at the right; no row amount (Design §13.6).
          <div key={r.id} className="flex items-center gap-2">
            <select
              className={clsx('h-11 min-w-0 rounded-md border border-paper-500 bg-white px-2 num', 'w-36', r.note ? 'text-ink-900' : 'text-[13px] text-ink-500')}
              aria-label="Mệnh giá"
              value={r.note ?? ''}
              onChange={(e) => {
                update(r.id, { note: e.target.value ? Number(e.target.value) : null });
                // Next: the number of notes.
                requestAnimationFrame(() => document.getElementById(`qty-${r.id}`)?.focus());
              }}
            >
              {/* Placeholder only: not offered in the list (Design §13.6). */}
              <option value="" disabled hidden>
                Mệnh giá
              </option>
              {DENOMINATIONS_VND.filter((d) => d === r.note || !used.has(d)).map((d) => (
                <option key={d} value={d}>
                  {formatNumber(d)}
                </option>
              ))}
            </select>
            <input
              id={`qty-${r.id}`}
              inputMode="numeric"
              className="ml-auto h-11 w-24 min-w-0 rounded-md border border-paper-500 px-2 text-center num placeholder:text-[13px] placeholder:text-ink-500"
              aria-label={r.note ? `Số tờ ${formatNumber(r.note)}` : 'Số tờ'}
              placeholder="Số tờ"
              value={r.qty ?? ''}
              onChange={(e) => update(r.id, { qty: Number(e.target.value.replace(/\D/g, '')) || null })}
            />
            <Button variant="ghost" icon={X} aria-label="Xóa dòng" title="Xóa dòng" onClick={() => setRows(rows.filter((x) => x.id !== r.id))} />
          </div>
        ))}
      </div>
      {used.size < DENOMINATIONS_VND.length && rows.length < DENOMINATIONS_VND.length && (
        // Plain text button, no pill (Design §13.6).
        <button
          type="button"
          className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-sm px-1 text-sm font-medium text-navy-700 hover:underline"
          onClick={() => {
            setRows([...rows, { id: nextId, note: null, qty: null }]);
            setNextId(nextId + 1);
          }}
        >
          <Plus size={18} strokeWidth={2.25} aria-hidden />
          Thêm
        </button>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-y-1 rounded-lg border border-paper-300 bg-white p-4 num">
        <dt className="text-ink-500">Dự kiến{source === 'device' ? ' (theo máy)' : ''}</dt>
        <dd className="text-right">{formatVnd(expectedVnd)}</dd>
        <dt className="text-ink-500">Đếm được</dt>
        <dd className="text-right">{formatVnd(counted)}</dd>
        <dt className="font-semibold">Chênh lệch</dt>
        <dd className={clsx('text-right font-semibold', tone)}>{variance === 0 ? 'Khớp' : formatVnd(variance)}</dd>
      </dl>
      {variance !== 0 && (
        <div className="mt-4">
          <Field label="Lý do chênh lệch" required value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      {error && (
        <div className="mt-4">
          <InlineAlert tone="danger">{error}</InlineAlert>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Customer attach (FR-POS-04)

export function CustomerDialog({ online, canCreate, onPick, onClose }: { online: boolean; canCreate: boolean; onPick: (c: CartCustomer) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  // undefined = not searched yet; [] = no match
  const [results, setResults] = useState<CartCustomer[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const digits = query.replace(/\D/g, '');
  const byPhone = /^[\d\s+().-]+$/.test(query.trim());
  const phone = byPhone ? query : '';
  const canSearch = byPhone ? digits.length >= 9 : query.trim().length >= 2;
  // Search as you type (Design §13.1): the matches drop down under the field.
  useEffect(() => {
    if (!canSearch) {
      setResults(undefined);
      return;
    }
    let live = true;
    const id = setTimeout(async () => {
      setError(null);
      try {
        const found = byPhone ? await findCustomerByPhone(query, online).then((c) => (c ? [c] : [])) : await searchCustomersByName(query, online, 5);
        if (live) setResults(found);
      } catch (e) {
        if (live) setError(errText(e));
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, canSearch, byPhone, online]);
  const create = async () => {
    try {
      const r = await post<{ id: string }>('/api/v1/customers', { name, phone });
      onPick({ id: r.id, name, phoneE164: null, tierCode: 'standard', pointsBalance: 0 });
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <Dialog title="Thông tin khách hàng" size="sm" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="relative">
            <Search size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />
            <input
              autoFocus
              aria-label="Số điện thoại hoặc tên khách hàng"
              placeholder="Nhập SĐT/tên"
              className={clsx('h-11 w-full border border-paper-500 bg-white pr-3 pl-10 text-base sm:text-sm', results?.length ? 'rounded-t-md' : 'rounded-md')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && results?.length === 1 && onPick(results[0]!)}
            />
          </div>
          {!!results?.length && (
            <ul role="listbox" aria-label="Khách hàng phù hợp" className="flex max-h-72 flex-col divide-y divide-paper-300 overflow-y-auto rounded-b-md border border-t-0 border-paper-500 bg-white shadow-md">
              {results.map((c) => (
                <li key={c.id} role="option" aria-selected={false}>
                  <button type="button" className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-navy-50" onClick={() => onPick(c)}>
                    <User size={20} className="shrink-0 text-ink-500" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{c.name}</span>
                      {c.phoneE164 && <span className="text-[13px] text-ink-500 num">{formatPhone(c.phoneE164)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {results?.length === 0 && !byPhone && <InlineAlert tone="warning">Không tìm thấy khách hàng tên “{query.trim()}”{online ? '' : ' trong dữ liệu trên máy'}.</InlineAlert>}
        {results?.length === 0 &&
          byPhone &&
          (canCreate && online ? (
            <div className="flex flex-col gap-3">
              <InlineAlert tone="info">Chưa có khách hàng với số này. Tạo khách hàng mới:</InlineAlert>
              <Field label="Họ tên" required value={name} onChange={(e) => setName(e.target.value)} />
              <Button variant="secondary" full disabled={!name.trim()} onClick={create}>
                Tạo khách hàng
              </Button>
            </div>
          ) : (
            <InlineAlert tone="warning">Không tìm thấy khách hàng{online ? '' : ' trong dữ liệu trên máy'}.</InlineAlert>
          ))}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}
