import { DENOMINATIONS_VND, normalizePaymentRef, paymentRefFromBytes, type PriceCartResult } from '@bookstore/domain';
import { clsx } from 'clsx';
import { Banknote, Check, CheckCircle2, CreditCard, Mail, Plus, Printer, QrCode, ShieldCheck, Trash2, User } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, InlineAlert } from '../components/ui';
import { ApiError, post } from '../lib/api';
import { formatNumber, formatPhone, formatVnd } from '../lib/format';
import { printSlip } from '../lib/print';
import { approveOffline, approveOnline, findCustomerByPhone, searchCustomersByName, type CartApproval, type CartCustomer, type CartLine } from './cart';
import type { Payment, SaleOutcome } from './actions';
import { Dialog, Keypad, MoneyInput, PinPad } from './widgets';

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

type Method = Payment['method'];
const TILES: { method: Method; label: string; icon: typeof Banknote }[] = [
  { method: 'cash', label: 'Tiền mặt', icon: Banknote },
  { method: 'transfer', label: 'Chuyển khoản', icon: QrCode },
  { method: 'card', label: 'Thẻ', icon: CreditCard },
];

function newRef(): string {
  return paymentRefFromBytes(crypto.getRandomValues(new Uint8Array(8)));
}

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
  const total = priced.totalVnd - depositVnd;
  const [payments, setPayments] = useState<Payment[]>([]);
  const paid = payments.reduce((a, p) => a + p.amountVnd, 0);
  const remaining = total - paid;
  const [method, setMethod] = useState<Method>('cash');
  const [amount, setAmount] = useState<number | null>(remaining);
  const [tendered, setTendered] = useState<string>('');
  const [cardRef, setCardRef] = useState('');
  const [transferRef] = useState(newRef);
  const [transferOk, setTransferOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tiles = TILES;
  const tenderedVnd = Number(tendered || 0);

  const pick = (m: Method) => {
    setMethod(m);
    setError(null);
    setAmount(remaining);
  };

  /** Build the current tender; returns null when it is not complete yet. */
  const current = (): Payment | null => {
    const amt = amount ?? 0;
    if (amt <= 0 || amt > remaining) return null;
    if (method === 'cash') return tenderedVnd && tenderedVnd < amt ? null : { method, amountVnd: amt, tenderedVnd: tenderedVnd || amt };
    if (method === 'card') return cardRef.trim() ? { method, amountVnd: amt, ref: cardRef.trim() } : null;
    return transferOk ? { method, amountVnd: amt, ref: normalizePaymentRef(transferRef) } : null;
  };

  const finish = async (list: Payment[]) => {
    setBusy(true);
    setError(null);
    try {
      await onPay(list);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const addTender = () => {
    const p = current();
    if (!p) return;
    const list = [...payments, p];
    const left = total - list.reduce((a, x) => a + x.amountVnd, 0);
    setPayments(list);
    setTendered('');
    setCardRef('');
    setTransferOk(false);
    setAmount(left);
    if (left === 0) void finish(list);
  };

  const change = method === 'cash' && tenderedVnd > (amount ?? 0) ? tenderedVnd - (amount ?? 0) : 0;
  const quick = [amount ?? 0, 50000, 100000, 200000, 500000].filter((v, i, a) => v >= (amount ?? 0) && a.indexOf(v) === i);

  return (
    <Dialog title="Thanh toán" size="lg" onClose={busy ? undefined : onClose}>
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <p className="text-[13px] text-ink-500">{payments.length ? 'Còn phải trả' : 'Số tiền phải trả'}</p>
          <p className="text-[28px] leading-9 font-bold whitespace-nowrap num">{formatVnd(remaining)}</p>
          {depositVnd > 0 && (
            <p className="text-sm text-ink-700 num">
              Tổng {formatVnd(priced.totalVnd)} · Đã đặt cọc {formatVnd(depositVnd)}
            </p>
          )}
          {payments.length > 0 && (
            <ul className="mt-2 text-sm text-ink-700">
              {payments.map((p, i) => (
                <li key={i} className="num">
                  {TILES.find((tl) => tl.method === p.method)?.label}: {formatVnd(p.amountVnd)}
                </li>
              ))}
            </ul>
          )}
        </div>
        {/* Method tiles always on one row (Design §13.4). */}
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label="Phương thức thanh toán">
          {tiles.map((tl) => (
            <button
              key={tl.method}
              type="button"
              role="radio"
              aria-checked={method === tl.method}
              onClick={() => pick(tl.method)}
              className={clsx('flex min-h-18 flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 py-2 text-center text-xs leading-tight font-medium sm:text-[13px]', method === tl.method ? 'border-navy-700 bg-navy-50' : 'border-paper-300 bg-white')}
            >
              <tl.icon size={24} aria-hidden />
              {tl.label}
            </button>
          ))}
        </div>
        <MoneyInput label="Số tiền theo phương thức này" value={amount} onChange={setAmount} />
        {method === 'cash' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-medium text-ink-700">Khách đưa</p>
              <p className="h-12 rounded-md border border-paper-500 px-3 text-right text-lg leading-[46px] num">{tendered ? formatNumber(Number(tendered)) : '—'} ₫</p>
              <div className="flex flex-wrap gap-2">
                {quick.map((v) => (
                  <button key={v} type="button" className="h-10 rounded-full border border-paper-500 px-3 text-sm num hover:bg-navy-50" onClick={() => setTendered(String(v))}>
                    {formatNumber(v)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[13px] text-ink-500">Tiền thừa</p>
              <p className="text-[28px] leading-9 font-bold whitespace-nowrap text-success-700 num">{formatVnd(change)}</p>
            </div>
            <Keypad onKey={(k) => setTendered((v) => (k === 'del' ? v.slice(0, -1) : (v + k).replace(/^0+/, '').slice(0, 10)))} />
          </div>
        )}
        {method === 'transfer' && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-paper-300 bg-paper-50 p-4 text-center">
            <p className="text-sm text-ink-700">Khách quét mã QR in sẵn tại quầy và ghi mã tham chiếu vào nội dung chuyển khoản</p>
            <p className="text-[13px] text-ink-500">Mã tham chiếu</p>
            <p className="text-2xl leading-8 font-semibold tracking-[0.04em] num">{transferRef.replace(/(.{4})/g, '$1 ').trim()}</p>
            {!online && <InlineAlert tone="warning">Ngoại tuyến: khoản chuyển khoản sẽ ở trạng thái “Chưa xác minh” cho đến khi quản lý xác nhận.</InlineAlert>}
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-5" checked={transferOk} onChange={(e) => setTransferOk(e.target.checked)} />
              Đã thấy tiền vào tài khoản (đúng số tiền và mã tham chiếu)
            </label>
          </div>
        )}
        {method === 'card' && <Field label="Mã chuẩn chi trên máy POS thẻ" required className="code" value={cardRef} onChange={(e) => setCardRef(e.target.value)} />}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" onClick={onClose} disabled={busy}>
            Hủy
          </Button>
          <Button variant="primary" size="lg" full icon={Check} loading={busy} disabled={!current()} onClick={addTender}>
            {method === 'transfer' ? 'Đã nhận tiền' : (amount ?? 0) < remaining ? 'Thêm khoản thanh toán' : 'Hoàn tất'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function SaleDone({ outcome, online, onNew }: { outcome: SaleOutcome; online: boolean; onNew: () => void }) {
  const [email, setEmail] = useState(false);
  const [buyer, setBuyer] = useState({ name: '', taxCode: '', address: '', email: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const send = async () => {
    try {
      await post(`/api/v1/pos/sales/${outcome.saleId}/einvoice-request`, { name: buyer.name, ...(buyer.taxCode && { taxCode: buyer.taxCode }), ...(buyer.address && { address: buyer.address }), ...(buyer.email && { email: buyer.email }) });
      setMsg('Đã gửi yêu cầu xuất hóa đơn. MISA meInvoice sẽ gửi hóa đơn tới email của khách.');
      setEmail(false);
    } catch (e) {
      setMsg(errText(e));
    }
  };
  return (
    <Dialog title="Hoàn tất" size="sm">
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
        {msg && <InlineAlert tone="info">{msg}</InlineAlert>}
        {email ? (
          <div className="flex w-full flex-col gap-3 text-left">
            <Field label="Tên người mua" required value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} />
            <Field label="Mã số thuế" value={buyer.taxCode} onChange={(e) => setBuyer({ ...buyer, taxCode: e.target.value })} />
            <Field label="Địa chỉ" value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} />
            <Field label="Email nhận hóa đơn" type="email" required value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} />
            <Button variant="primary" full disabled={!buyer.name || !buyer.email} onClick={send}>
              Gửi yêu cầu
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-2">
            <Button variant="primary" size="lg" full onClick={onNew}>
              Đơn mới
            </Button>
            {outcome.saleId && online && (
              <Button variant="secondary" full icon={Mail} onClick={() => setEmail(true)}>
                Gửi hóa đơn điện tử qua email
              </Button>
            )}
            {outcome.printSlip && outcome.saleId && (
              <Button variant="secondary" full icon={Printer} onClick={() => void printSlip(outcome.saleId!)}>
                In
              </Button>
            )}
          </div>
        )}
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
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          {/* Never disabled for a variance — only for a missing reason (BR-06). */}
          <Button
            variant="primary"
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
      <p className="mb-2 text-[13px] font-medium text-ink-700">Tiền mặt đếm được</p>
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 text-sm">
        <span className="text-ink-500">Mệnh giá</span>
        <span className="text-ink-500">Số tờ</span>
        <span className="text-right text-ink-500">Thành tiền</span>
        <span aria-hidden className="w-10" />
        {rows.map((r) => (
          <div key={r.id} className="contents">
            <select
              className="h-11 min-w-0 rounded-md border border-paper-500 bg-white px-2 num"
              aria-label="Mệnh giá"
              value={r.note ?? ''}
              onChange={(e) => {
                update(r.id, { note: e.target.value ? Number(e.target.value) : null });
                // Next: the number of notes.
                requestAnimationFrame(() => document.getElementById(`qty-${r.id}`)?.focus());
              }}
            >
              <option value="">Chọn</option>
              {DENOMINATIONS_VND.filter((d) => d === r.note || !used.has(d)).map((d) => (
                <option key={d} value={d}>
                  {formatNumber(d)}
                </option>
              ))}
            </select>
            <input
              id={`qty-${r.id}`}
              inputMode="numeric"
              className="h-11 min-w-0 rounded-md border border-paper-500 px-2 text-center num"
              aria-label={r.note ? `Số tờ ${formatNumber(r.note)}` : 'Số tờ'}
              placeholder="0"
              value={r.qty ?? ''}
              onChange={(e) => update(r.id, { qty: Number(e.target.value.replace(/\D/g, '')) || null })}
            />
            <span className="truncate text-right num">{r.note && r.qty ? formatNumber(r.note * r.qty) : '—'}</span>
            <Button variant="ghost" icon={Trash2} aria-label="Xóa dòng" title="Xóa dòng" onClick={() => setRows(rows.filter((x) => x.id !== r.id))} />
          </div>
        ))}
      </div>
      {used.size < DENOMINATIONS_VND.length && rows.length < DENOMINATIONS_VND.length && (
        <Button
          variant="tonal"
          size="sm"
          icon={Plus}
          className="mt-3"
          onClick={() => {
            setRows([...rows, { id: nextId, note: null, qty: null }]);
            setNextId(nextId + 1);
          }}
        >
          Thêm mệnh giá
        </Button>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-y-1 rounded-lg border border-paper-300 bg-paper-50 p-4 num">
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
  const lookup = async () => {
    if (!canSearch) return;
    setError(null);
    try {
      if (byPhone) {
        const c = await findCustomerByPhone(query, online);
        setResults(c ? [c] : []);
      } else {
        setResults(await searchCustomersByName(query, online));
      }
    } catch (e) {
      setError(errText(e));
    }
  };
  const create = async () => {
    try {
      const r = await post<{ id: string }>('/api/v1/customers', { name, phone });
      onPick({ id: r.id, name, phoneE164: null, tierCode: 'standard', pointsBalance: 0 });
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <Dialog title="Khách hàng" size="sm" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field
          label="Số điện thoại hoặc tên"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setResults(undefined);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void lookup()}
        />
        <Button variant="primary" full disabled={!canSearch} onClick={lookup}>
          Tìm
        </Button>
        {!!results?.length && (
          <ul className="flex max-h-72 flex-col divide-y divide-paper-300 overflow-y-auto rounded-lg border border-paper-300">
            {results.map((c) => (
              <li key={c.id}>
                <button type="button" className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-navy-50" onClick={() => onPick(c)}>
                  <User size={20} className="shrink-0 text-ink-500" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="text-[13px] text-ink-500 num">
                      {c.phoneE164 ? `${formatPhone(c.phoneE164)} · ` : ''}
                      {formatNumber(c.pointsBalance)} điểm
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
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

// ---------------------------------------------------------------------------------------------
// Line actions: discount, price override, note, remove (FR-POS-02)

export function LineDialog({ line, title, unitPriceVnd, canDiscount, canOverride, onSave, onRemove, onClose }: { line: CartLine; title: string; unitPriceVnd: number; canDiscount: boolean; canOverride: boolean; onSave: (patch: Partial<CartLine>) => void; onRemove: () => void; onClose: () => void }) {
  const [pct, setPct] = useState(line.manualDiscount?.kind === 'percent' ? String(line.manualDiscount.bp / 100) : '');
  const [price, setPrice] = useState<number | null>(line.priceOverrideVnd ?? null);
  const [note, setNote] = useState(line.note ?? '');
  const bp = Math.round(Number(pct.replace(',', '.') || 0) * 100);
  return (
    <Dialog
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="destructive-outline" icon={Trash2} onClick={onRemove}>
            Xóa dòng
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              onSave({
                manualDiscount: bp > 0 ? { kind: 'percent', bp: Math.min(bp, 10000) } : null,
                priceOverrideVnd: price !== null && price !== unitPriceVnd ? price : null,
                note: note.trim(),
              })
            }
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {canDiscount && <Field label="Giảm giá dòng" inputMode="decimal" suffix="%" value={pct} onChange={(e) => setPct(e.target.value)} helper={bp > 0 ? `= ${formatVnd(Math.round((unitPriceVnd * line.qty * bp) / 10000))}` : 'Vượt hạn mức sẽ cần quản lý duyệt.'} />}
        {canOverride ? <MoneyInput label="Sửa giá bán" value={price} onChange={setPrice} /> : <p className="text-sm text-ink-500">Sửa giá cần quyền hoặc quản lý duyệt khi thanh toán.</p>}
        <Field label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  );
}
