import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertOctagon, ArrowLeftRight, BookOpen, Check, ChevronUp, Info, LogOut, Menu, MoreHorizontal, RefreshCw, ScanBarcode, Ticket, User, Wallet, WifiOff, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button, Field, InlineAlert, Skeleton } from '../components/ui';
import { get } from '../lib/api';
import { formatDateTime, formatNumber, formatVnd } from '../lib/format';
import { can, useMe, type Me } from '../lib/session';
import { cashMovement, closeShift, completeSale, expectedCash, openShift, refreshShift, type LocalShift, type Payment, type SaleOutcome } from './actions';
import { findByCode, priceLocally, searchItems, useCart, type CartApproval, type PricedCart } from './cart';
import { db, kvGet, kvSet, type CachedItem } from './db';
import { deviceInfo, registerDevice, type DeviceInfo } from './device';
import { ApprovalDialog, CloseShiftDialog, CustomerDialog, LineDialog, PaymentSheet, SaleDone } from './dialogs';
import { bootstrap, flush, leaseState, startSync, usePosStatus } from './sync';
import { CameraScanner, Dialog, MoneyInput } from './widgets';

/** POS (FR-POS-01..11, FR-POS-18..26, Design §13). Full screen, without the back-office sidebar. */

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// =============================================================================================
// Gates: device registration → catalogue → shift

export function PosPage() {
  const { data: me } = useMe();
  const [device, setDevice] = useState<DeviceInfo | null | undefined>(undefined);
  const ready = usePosStatus((s) => s.ready);
  const [bootError, setBootError] = useState<string | null>(null);
  const [shift, setShift] = useState<LocalShift | null | undefined>(undefined);

  useEffect(() => {
    void deviceInfo().then(setDevice);
  }, []);
  useEffect(() => {
    if (!device) return;
    void startSync();
    if (!usePosStatus.getState().ready) {
      bootstrap().catch((e) => {
        // Offline with a cache is fine; offline with nothing cached is not.
        void db.items.count().then((n) => (n ? usePosStatus.getState().set({ ready: true }) : setBootError(errText(e))));
      });
    }
    void refreshShift(device.registerId).then(setShift).catch((e) => setBootError(errText(e)));
  }, [device]);

  if (!me) return null;
  if (device === undefined) return <FullScreenLoading />;
  if (!device) return <RegisterScreen me={me} onDone={setDevice} />;
  if (bootError && !ready) return <FullScreenMessage tone="danger" text={bootError} />;
  if (!ready || shift === undefined) return <FullScreenLoading text="Đang tải danh mục về máy…" />;
  if (!shift) return <OpenShiftScreen me={me} device={device} onOpened={setShift} />;
  return <SellingScreen me={me} device={device} shift={shift} onShiftChange={setShift} />;
}

function FullScreenLoading({ text }: { text?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-paper-100 p-8" role="status">
      <Skeleton className="h-10 w-64" />
      {text && <p className="text-ink-500">{text}</p>}
    </div>
  );
}

function FullScreenMessage({ tone, text }: { tone: 'danger' | 'info'; text: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper-100 p-8">
      <div className="max-w-md">
        <InlineAlert tone={tone}>{text}</InlineAlert>
        <Link to="/" className="mt-4 inline-block text-navy-700 underline">
          Thoát POS
        </Link>
      </div>
    </div>
  );
}

function PosShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper-100">
      <header className="on-navy flex h-14 items-center justify-between bg-navy-700 px-4 text-white">
        <span className="font-semibold">{title}</span>
        <Link to="/" className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm text-white/80 hover:bg-navy-800">
          <LogOut size={18} aria-hidden /> Thoát POS
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center p-4 sm:items-center">{children}</main>
    </div>
  );
}

/** Device registration (TDD §7.2): only a manager can register a browser as a POS device. */
function RegisterScreen({ me, onDone }: { me: Me; onDone: (d: DeviceInfo) => void }) {
  const registers = useQuery({ queryKey: ['registers'], queryFn: () => get<{ items: { id: string; code: string; name: string }[] }>('/api/v1/pos/registers') });
  const [registerId, setRegisterId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const first = registers.data?.items[0];
    if (first && !registerId) {
      setRegisterId(first.id);
      setCode(first.code);
    }
  }, [registers.data, registerId]);
  if (!can(me, 'pos.offline.manage')) {
    return (
      <PosShell title="Bán hàng">
        <div className="max-w-md">
          <InlineAlert tone="info">Máy này chưa được đăng ký làm máy bán hàng. Hãy nhờ quản lý đăng nhập trên máy này để đăng ký.</InlineAlert>
        </div>
      </PosShell>
    );
  }
  return (
    <PosShell title="Đăng ký máy bán hàng">
      <form
        className="flex w-full max-w-md flex-col gap-5 rounded-lg border border-paper-300 bg-white p-6"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const d = await registerDevice(registerId, code.trim().toUpperCase());
            await kvSet('registerCode', registers.data?.items.find((r) => r.id === registerId)?.code ?? '');
            onDone(d);
          } catch (err) {
            setError(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-ink-700">Máy được đăng ký sẽ lưu danh mục để bán được cả khi mất mạng, và đồng bộ khi có mạng lại.</p>
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-ink-700">Quầy</span>
          <select className="h-12 rounded-md border border-paper-500 bg-white px-3" value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
            {registers.data?.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} · {r.name}
              </option>
            ))}
          </select>
        </label>
        <Field label="Mã thiết bị" required helper="1–6 chữ hoa hoặc số, dùng làm tiền tố số đơn ngoại tuyến (ví dụ Q1-000123)." value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={!registerId || !/^[A-Z0-9]{1,6}$/.test(code)}>
          Đăng ký máy này
        </Button>
      </form>
    </PosShell>
  );
}

function OpenShiftScreen({ me, device, onOpened }: { me: Me; device: DeviceInfo; onOpened: (s: LocalShift) => void }) {
  const [float, setFloat] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <PosShell title="Mở ca">
      <form
        className="flex w-full max-w-md flex-col gap-5 rounded-lg border border-paper-300 bg-white p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onOpened(await openShift(device.registerId, float ?? 0, me.id));
          } catch (err) {
            setError(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-ink-700">Đếm tiền trong ngăn kéo trước khi bắt đầu bán.</p>
        <MoneyInput label="Tiền đầu ca" value={float} onChange={setFloat} autoFocus />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={float === null}>
          Mở ca
        </Button>
      </form>
    </PosShell>
  );
}

// =============================================================================================
// Selling screen (Design §13.1)

function ConnectionPill() {
  const s = usePosStatus();
  if (!s.online)
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-warning-50 px-3 text-xs font-medium text-warning-700" role="status">
        <WifiOff size={14} aria-hidden /> Ngoại tuyến · {s.pending} đơn chờ
      </span>
    );
  if (s.syncing)
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-info-50 px-3 text-xs font-medium text-info-700" role="status">
        <RefreshCw size={14} className="animate-spin" aria-hidden /> Đang đồng bộ {s.pending}
      </span>
    );
  if (s.error && s.pending)
    return (
      <button type="button" onClick={() => void flush()} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-danger-50 px-3 text-xs font-medium text-danger-700">
        <AlertOctagon size={14} aria-hidden /> Lỗi đồng bộ · Đồng bộ ngay
      </button>
    );
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-success-50 px-3 text-xs font-medium text-success-700" role="status">
      <span className="size-2 rounded-full bg-success-700" aria-hidden /> Trực tuyến
    </span>
  );
}

interface Result extends CachedItem {
  available?: number;
}

function SellingScreen({ me, device, shift, onShiftChange }: { me: Me; device: DeviceInfo; shift: LocalShift; onShiftChange: (s: LocalShift | null) => void }) {
  const cart = useCart();
  const status = usePosStatus();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [priced, setPriced] = useState<PricedCart | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'customer' } | { kind: 'line'; lineId: string } | { kind: 'approval'; action: CartApproval['action']; reason: string } | { kind: 'pay' } | { kind: 'done'; outcome: SaleOutcome } | { kind: 'close'; expected: number; source: 'server' | 'device' } | { kind: 'cash' } | { kind: 'held' } | { kind: 'coupon' } | { kind: 'points' } | { kind: 'menu' }>(null);
  const [message, setMessage] = useState<{ tone: 'danger' | 'info' | 'success'; text: string } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [registerCode, setRegisterCode] = useState('');
  const [heldCount, setHeldCount] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const saleKey = useRef(crypto.randomUUID());
  const grants = useMemo(() => ({ discountUnlimited: can(me, 'sale.discount_unlimited'), priceOverride: can(me, 'sale.price_override') }), [me]);
  const readOnly = !status.leader;
  const lease = leaseState();

  useEffect(() => {
    void kvGet<string>('registerCode').then((c) => setRegisterCode(c ?? device.deviceCode));
    void db.heldCarts.count().then(setHeldCount);
  }, [device]);

  // Keep the scan field focused after every action so a keyboard-wedge scanner works (TDD §8.7).
  const refocus = useCallback(() => setTimeout(() => !dialog && search.current?.focus(), 0), [dialog]);
  useEffect(() => {
    if (!dialog) refocus();
  }, [dialog, refocus]);

  // Re-price whenever the cart changes (same engine as the server).
  useEffect(() => {
    let live = true;
    void priceLocally(cart, grants).then((p) => live && setPriced(p));
    return () => {
      live = false;
    };
  }, [cart.lines, cart.customer, cart.couponCode, cart.redeemPoints, grants]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live search as you type; Enter adds an exact code (scanner) or the single result.
  useEffect(() => {
    const id = setTimeout(async () => setResults(q.trim().length >= 2 ? await searchItems(q) : []), 150);
    return () => clearTimeout(id);
  }, [q]);

  const addCode = async (code: string) => {
    const item = await findByCode(code);
    if (item) {
      cart.add(item.variantId);
      setQ('');
      setResults([]);
      setNotFound(null);
      return true;
    }
    return false;
  };
  const submitSearch = async (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    if (await addCode(term)) return;
    if (results.length === 1) {
      cart.add(results[0]!.variantId);
      setQ('');
      setResults([]);
      return;
    }
    if (!results.length) setNotFound(term);
  };

  const lines = priced?.result.lines ?? [];
  const total = priced?.result.totalVnd ?? 0;
  const itemCount = cart.lines.reduce((a, l) => a + l.qty, 0);

  /** Xác nhận: approvals first, then the payment sheet. */
  const confirm = () => {
    if (!priced) return;
    const issue = priced.result.issues[0];
    if (issue) {
      const text =
        issue.code === 'coupon_not_found' ? `Mã giảm giá ${issue.couponCode} không đúng hoặc đã hết hạn.` : issue.code === 'points_below_minimum' ? `Cần đổi tối thiểu ${issue.minimum} điểm.` : issue.code === 'points_exceed_balance' ? 'Khách không đủ điểm.' : 'Không áp dụng được mã giảm giá hoặc điểm.';
      setMessage({ tone: 'danger', text });
      return;
    }
    for (const need of priced.result.approvalsRequired) {
      if (cart.approvals.some((a) => a.action === need.code)) continue;
      const reason = need.code === 'discount_over_limit' ? `Giảm giá ${need.discountBp / 100}% vượt hạn mức ${need.limitBp / 100}% của bạn` : 'Sửa giá bán cần quản lý duyệt';
      setDialog({ kind: 'approval', action: need.code, reason });
      return;
    }
    setDialog({ kind: 'pay' });
  };

  const pay = async (payments: Payment[]) => {
    const outcome = await completeSale(
      { shift, cashierId: me.id, lines: cart.lines, customer: cart.customer, couponCode: cart.couponCode, redeemPoints: cart.redeemPoints, approvals: cart.approvals, payments, priced: priced!.result, items: priced!.items },
      saleKey.current,
    );
    setDialog({ kind: 'done', outcome });
  };

  const newSale = () => {
    cart.clear();
    saleKey.current = crypto.randomUUID();
    setDialog(null);
    setSheet(false);
  };

  const holdCart = async () => {
    if (!cart.lines.length) return;
    await db.heldCarts.put({ id: crypto.randomUUID(), label: cart.customer?.name ?? `Giỏ ${formatDateTime(new Date())}`, payload: { lines: cart.lines, customer: cart.customer, couponCode: cart.couponCode, redeemPoints: cart.redeemPoints }, heldAt: new Date().toISOString() });
    setHeldCount(await db.heldCarts.count());
    newSale();
    setMessage({ tone: 'success', text: 'Đã giữ giỏ hàng.' });
  };

  const cartPanel = (
    <div className="flex h-full flex-col">
      <div className="border-b border-paper-300 p-4">
        {cart.customer ? (
          <div className="flex items-center gap-3">
            <User size={20} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{cart.customer.name}</p>
              <p className="text-[13px] text-ink-500 num">
                {formatNumber(cart.customer.pointsBalance)} điểm{priced?.result.pointsToEarn ? ` · +${priced.result.pointsToEarn} điểm đơn này` : ''}
              </p>
            </div>
            <button type="button" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-navy-50" aria-label="Bỏ khách hàng" onClick={() => cart.setCustomer(null)}>
              <X size={18} aria-hidden />
            </button>
          </div>
        ) : (
          <Button variant="tonal" icon={User} onClick={() => setDialog({ kind: 'customer' })} disabled={readOnly}>
            Thêm khách (SĐT)
          </Button>
        )}
      </div>
      <ul className="flex-1 divide-y divide-paper-300 overflow-y-auto" aria-live="polite">
        {cart.lines.length === 0 && <li className="p-6 text-center text-ink-500">Quét mã hoặc tìm sản phẩm để thêm vào giỏ.</li>}
        {cart.lines.map((l) => {
          const pl = lines.find((x) => x.lineId === l.lineId);
          const item = priced?.items.get(l.variantId);
          return (
            <li key={l.lineId} className={clsx('px-4 py-3 transition-colors duration-[600ms]', cart.flashLineId === l.lineId && 'bg-sand-50')}>
              <div className="flex gap-2">
                <p className="line-clamp-2 flex-1 font-semibold">{item?.title ?? '…'}</p>
                <button type="button" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-navy-50" aria-label="Tùy chọn dòng" onClick={() => setDialog({ kind: 'line', lineId: l.lineId })}>
                  <MoreHorizontal size={20} aria-hidden />
                </button>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <span className="text-sm text-ink-700 num">{formatVnd(pl?.unitPriceVnd ?? item?.priceVnd ?? 0)}</span>
                <span className="ml-auto inline-flex items-center gap-1">
                  <button type="button" className="size-12 rounded-full border border-paper-500 text-lg" aria-label="Giảm số lượng" onClick={() => (l.qty === 1 ? cart.remove(l.lineId) : cart.setQty(l.lineId, l.qty - 1))}>
                    –
                  </button>
                  <span className="w-10 text-center font-semibold num" aria-label="Số lượng">
                    {l.qty}
                  </span>
                  <button type="button" className="size-12 rounded-full border border-paper-500 text-lg" aria-label="Tăng số lượng" onClick={() => cart.setQty(l.lineId, l.qty + 1)}>
                    +
                  </button>
                </span>
                <span className="w-24 text-right font-semibold num">{formatVnd(pl?.totalVnd ?? 0)}</span>
              </div>
              {pl?.savings.map((s) => (
                <p key={s.promotionId} className="mt-1 text-[13px] text-success-700 num">
                  Giảm {formatVnd(s.amountVnd)} – {s.label}
                </p>
              ))}
              {pl && pl.manualDiscountVnd > 0 && <p className="mt-1 text-[13px] text-success-700 num">Giảm tay {formatVnd(pl.manualDiscountVnd)}</p>}
              {l.note && <p className="mt-1 text-[13px] text-ink-500">{l.note}</p>}
            </li>
          );
        })}
      </ul>
      <div className="border-t border-paper-300 p-4">
        <dl className="grid grid-cols-2 gap-y-1 text-base num">
          <dt className="text-ink-700">Tạm tính</dt>
          <dd className="text-right">{formatVnd(priced?.result.subtotalVnd ?? 0)}</dd>
          {!!priced?.result.discountVnd && (
            <>
              <dt className="text-ink-700">Khuyến mãi / giảm giá</dt>
              <dd className="text-right text-success-700">−{formatVnd(priced.result.discountVnd).replace('−', '')}</dd>
            </>
          )}
          <dt className="mt-2 text-lg font-semibold">TỔNG</dt>
          <dd className="mt-1 text-right text-[36px] leading-[44px] font-bold">{formatVnd(total)}</dd>
        </dl>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Button variant="secondary" size="sm" onClick={holdCart} disabled={!cart.lines.length || readOnly}>
            Giữ giỏ
          </Button>
          <Button variant="secondary" size="sm" icon={Ticket} onClick={() => setDialog({ kind: 'coupon' })} disabled={readOnly}>
            {cart.couponCode || 'Mã giảm giá'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: 'points' })} disabled={!cart.customer || readOnly}>
            {cart.redeemPoints ? `${formatNumber(cart.redeemPoints)} điểm` : 'Điểm'}
          </Button>
        </div>
        <Button variant="accent" size="xl" full icon={Check} className="mt-3" disabled={!cart.lines.length || !priced || readOnly || lease === 'expired'} onClick={confirm}>
          Xác nhận
        </Button>
      </div>
    </div>
  );

  const editing = dialog?.kind === 'line' ? cart.lines.find((l) => l.lineId === dialog.lineId) : undefined;

  return (
    <div className="flex h-dvh flex-col bg-paper-100">
      <header className="on-navy flex h-14 shrink-0 items-center gap-3 bg-navy-700 px-4 text-white">
        <button type="button" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-navy-800" aria-label="Menu ca làm" onClick={() => setDialog({ kind: 'menu' })}>
          <Menu size={20} aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate font-medium">
          Ca {shift.shiftNo ? `#${shift.shiftNo}` : '(ngoại tuyến)'} · {me.displayName} · Quầy {registerCode}
        </span>
        <ConnectionPill />
        <button type="button" className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm hover:bg-navy-800" onClick={() => setDialog({ kind: 'held' })}>
          Giỏ chờ {heldCount}
        </button>
      </header>
      {!status.online && (
        <div className="flex items-center gap-2 bg-warning-50 px-4 py-2 text-sm text-warning-700" role="alert">
          <WifiOff size={16} aria-hidden /> Mất kết nối. Vẫn bán được bình thường; hóa đơn điện tử và xác nhận chuyển khoản sẽ thực hiện khi có mạng.
        </div>
      )}
      {lease === 'expiring' && (
        <div className="bg-warning-50 px-4 py-2 text-sm text-warning-700" role="alert">
          Cần kết nối mạng trong {Math.ceil((new Date(status.leaseExpiresAt!).getTime() - Date.now()) / 3600_000)} giờ nữa để tiếp tục bán.
        </div>
      )}
      {lease === 'expired' && (
        <div className="bg-danger-50 px-4 py-2 text-sm text-danger-700" role="alert">
          Máy đã quá thời gian bán ngoại tuyến cho phép. Hãy kết nối mạng để tiếp tục bán.
        </div>
      )}
      {readOnly && (
        <div className="flex items-center gap-2 bg-info-50 px-4 py-2 text-sm text-info-700" role="status">
          <Info size={16} aria-hidden /> POS đang mở ở tab khác. Tab này chỉ để xem.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <form onSubmit={submitSearch} className="relative">
            <input
              ref={search}
              autoFocus
              className={clsx('h-14 w-full rounded-md border bg-white pr-16 pl-4 text-base code focus:border-navy-700', notFound ? 'border-danger-700' : 'border-paper-500')}
              placeholder="Nhập SKUs/tên sản phẩm"
              aria-label="Nhập SKUs/tên sản phẩm"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setNotFound(null);
              }}
              disabled={readOnly}
            />
            <button type="button" className="absolute top-1/2 right-2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-navy-50 text-navy-700" aria-label="Quét bằng camera" onClick={() => setCamera(true)}>
              <ScanBarcode size={24} aria-hidden />
            </button>
          </form>
          {notFound && <InlineAlert tone="danger">Không tìm thấy mã {notFound}. Thử tìm theo tên sản phẩm.</InlineAlert>}
          {message && (
            <div onClick={() => setMessage(null)}>
              <InlineAlert tone={message.tone}>{message.text}</InlineAlert>
            </div>
          )}
          <ul className="flex-1 divide-y divide-paper-300 overflow-y-auto rounded-lg border border-paper-300 bg-white">
            {results.map((r) => (
              <li key={r.variantId}>
                <button
                  type="button"
                  className="flex min-h-[72px] w-full items-center gap-3 px-4 py-2 text-left hover:bg-navy-50"
                  onClick={() => {
                    cart.add(r.variantId);
                    setQ('');
                    setResults([]);
                    refocus();
                  }}
                >
                  <span className="flex h-[60px] w-10 shrink-0 items-center justify-center rounded-sm border border-paper-300 bg-paper-200">
                    <BookOpen size={16} className="text-ink-300" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 font-medium">{r.title}</span>
                    <span className="block text-[13px] text-ink-500">
                      {r.authors.join(', ')} {r.authors.length ? '· ' : ''}
                      <span className="code">{r.sku}</span>
                    </span>
                  </span>
                  <span className="font-semibold num">{formatVnd(r.priceVnd)}</span>
                </button>
              </li>
            ))}
            {!results.length && <li className="p-6 text-center text-ink-500">{q.trim().length >= 2 ? 'Không có sản phẩm phù hợp.' : 'Kết quả tìm kiếm hiện ở đây. Tìm không dấu cũng được.'}</li>}
          </ul>
        </section>
        <aside className="hidden w-[420px] shrink-0 border-l border-paper-300 bg-white lg:block">{cartPanel}</aside>
      </div>
      {/* Tablet portrait / phone: sticky bar that opens the cart as a bottom sheet (Design §13.1). */}
      <div className="border-t border-paper-300 bg-white p-3 lg:hidden">
        <div className="flex items-center gap-3">
          <button type="button" className="flex flex-1 items-center gap-2 text-left" onClick={() => setSheet(true)} aria-expanded={sheet}>
            <ChevronUp size={20} aria-hidden />
            <span className="num">
              {itemCount} sản phẩm · <span className="font-semibold">{formatVnd(total)}</span>
            </span>
          </button>
          <Button variant="accent" size="lg" icon={Check} disabled={!cart.lines.length || !priced || readOnly} onClick={confirm}>
            Xác nhận
          </Button>
        </div>
      </div>
      {sheet && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Giỏ hàng">
          <div className="absolute inset-0 bg-[rgba(26,38,56,0.45)]" onClick={() => setSheet(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[90dvh] flex-col rounded-t-xl bg-white shadow-lg">
            <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-paper-300" aria-hidden />
            {cartPanel}
          </div>
        </div>
      )}

      {camera && (
        <CameraScanner
          onCode={(code) => {
            setCamera(false);
            void addCode(code).then((ok) => !ok && setNotFound(code));
          }}
          onClose={() => setCamera(false)}
        />
      )}
      {dialog?.kind === 'customer' && (
        <CustomerDialog
          online={status.online}
          canCreate={can(me, 'customer.manage')}
          onClose={() => setDialog(null)}
          onPick={(c) => {
            cart.setCustomer(c);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'line' && editing && (
        <LineDialog
          line={editing}
          title={priced?.items.get(editing.variantId)?.title ?? ''}
          unitPriceVnd={priced?.items.get(editing.variantId)?.priceVnd ?? 0}
          canDiscount={can(me, 'sale.discount')}
          canOverride={true}
          onClose={() => setDialog(null)}
          onRemove={() => {
            cart.remove(editing.lineId);
            setDialog(null);
          }}
          onSave={(patch) => {
            cart.update(editing.lineId, patch);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'approval' && (
        <ApprovalDialog
          action={dialog.action}
          reason={dialog.reason}
          online={status.online}
          onClose={() => setDialog(null)}
          onApproved={(a) => {
            cart.addApproval(a);
            setDialog(null);
            setTimeout(confirm, 0);
          }}
        />
      )}
      {dialog?.kind === 'pay' && priced && <PaymentSheet priced={priced.result} customer={cart.customer} online={status.online} onClose={() => setDialog(null)} onPay={pay} />}
      {dialog?.kind === 'done' && <SaleDone outcome={dialog.outcome} online={status.online} onNew={newSale} />}
      {dialog?.kind === 'coupon' && (
        <SimpleInput
          title="Mã giảm giá"
          label="Nhập mã"
          initial={cart.couponCode}
          onClose={() => setDialog(null)}
          onSave={(v) => {
            cart.setCoupon(v.trim().toUpperCase());
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'points' && cart.customer && (
        <SimpleInput
          title="Đổi điểm"
          label={`Số điểm muốn dùng (còn ${formatNumber(cart.customer.pointsBalance)})`}
          initial={cart.redeemPoints ? String(cart.redeemPoints) : ''}
          numeric
          onClose={() => setDialog(null)}
          onSave={(v) => {
            cart.setRedeem(Number(v.replace(/\D/g, '')) || 0);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'held' && (
        <HeldCarts
          onClose={() => setDialog(null)}
          onRecall={async (id) => {
            const h = await db.heldCarts.get(id);
            if (h) {
              cart.load(h.payload as Parameters<typeof cart.load>[0]);
              await db.heldCarts.delete(id);
              setHeldCount(await db.heldCarts.count());
            }
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === 'menu' && (
        <Dialog title="Ca làm" size="sm" onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-2">
            <Button variant="secondary" full icon={ArrowLeftRight} onClick={() => setDialog({ kind: 'cash' })}>
              Thu / chi tiền mặt
            </Button>
            <Button
              variant="secondary"
              full
              icon={Wallet}
              onClick={async () => {
                const r = await expectedCash(shift);
                setDialog({ kind: 'close', expected: r.expectedVnd, source: r.source });
              }}
            >
              Đóng ca
            </Button>
            <Link to="/" className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-paper-500 text-sm font-medium hover:bg-navy-50">
              <LogOut size={20} aria-hidden /> Thoát POS
            </Link>
          </div>
        </Dialog>
      )}
      {dialog?.kind === 'cash' && (
        <CashDialog
          onClose={() => setDialog(null)}
          onSave={async (direction, amount, reason) => {
            await cashMovement(shift, direction, amount, reason, me.id);
            setDialog(null);
            setMessage({ tone: 'success', text: direction === 'in' ? 'Đã ghi thu tiền mặt.' : 'Đã ghi chi tiền mặt.' });
          }}
        />
      )}
      {dialog?.kind === 'close' && (
        <CloseShiftDialog
          expectedVnd={dialog.expected}
          source={dialog.source}
          onClose={() => setDialog(null)}
          onSubmit={async (counted, denominations, reason) => {
            await closeShift(shift, counted, denominations, reason || undefined, me.id);
            onShiftChange(null);
          }}
        />
      )}
    </div>
  );
}

function SimpleInput({ title, label, initial, numeric, onSave, onClose }: { title: string; label: string; initial: string; numeric?: boolean; onSave: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(initial);
  return (
    <Dialog
      title={title}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={() => onSave('')}>
            Bỏ
          </Button>
          <Button variant="primary" onClick={() => onSave(v)}>
            Áp dụng
          </Button>
        </>
      }
    >
      <Field label={label} autoFocus inputMode={numeric ? 'numeric' : 'text'} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSave(v)} />
    </Dialog>
  );
}

function CashDialog({ onSave, onClose }: { onSave: (d: 'in' | 'out', amount: number, reason: string) => Promise<void>; onClose: () => void }) {
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title="Thu / chi tiền mặt"
      size="sm"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          disabled={!amount || !reason.trim()}
          onClick={() => onSave(direction, amount!, reason.trim()).catch((e) => setError(errText(e)))}
        >
          Lưu
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="inline-flex rounded-full bg-paper-200 p-1" role="radiogroup">
          {(['out', 'in'] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={direction === d} className={clsx('h-10 flex-1 rounded-full px-4 text-sm', direction === d && 'bg-white shadow-sm')} onClick={() => setDirection(d)}>
              {d === 'out' ? 'Chi ra' : 'Thu vào'}
            </button>
          ))}
        </div>
        <MoneyInput label="Số tiền" value={amount} onChange={setAmount} autoFocus />
        <Field label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

function HeldCarts({ onRecall, onClose }: { onRecall: (id: string) => void; onClose: () => void }) {
  const [list, setList] = useState<{ id: string; label: string; heldAt: string }[]>([]);
  useEffect(() => {
    void db.heldCarts.orderBy('heldAt').toArray().then(setList);
  }, []);
  return (
    <Dialog title="Giỏ đang giữ" size="sm" onClose={onClose}>
      {list.length === 0 ? (
        <p className="text-ink-500">Chưa có giỏ nào đang giữ.</p>
      ) : (
        <ul className="divide-y divide-paper-300">
          {list.map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-3">
              <span className="flex-1">
                <span className="block font-medium">{h.label}</span>
                <span className="text-xs text-ink-500">{formatDateTime(h.heldAt)}</span>
              </span>
              <Button variant="tonal" size="sm" onClick={() => onRecall(h.id)}>
                Gọi lại giỏ
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

