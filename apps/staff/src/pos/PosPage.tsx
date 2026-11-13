import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertOctagon, ArrowLeftRight, BookOpen, CalendarClock, Check, Coins, Info, LogOut, Menu, Minus, MoreHorizontal, Percent, Plus, RefreshCw, ScanBarcode, Search, ShoppingBasket, ShoppingCart, Ticket, User, Wallet, WifiOff, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, Field, InlineAlert, Skeleton } from '../components/ui';
import { get } from '../lib/api';
import { formatDateTime, formatNumber, formatVnd } from '../lib/format';
import { can, useMe, type Me } from '../lib/session';
import { cashMovement, closeShift, completeSale, expectedCash, openShift, refreshShift, type LocalShift, type Payment, type SaleOutcome } from './actions';
import { findByCode, isPreorderLine, priceLocally, searchItems, useCart, type CartApproval, type PricedCart } from './cart';
import { db, itemTitle, kvGet, kvSet, type CachedItem } from './db';
import { deviceInfo, registerDevice, type DeviceInfo } from './device';
import { ApprovalDialog, CloseShiftDialog, CustomerDialog, LineDialog, OrderDiscountDialog, PaymentSheet, SaleDone } from './dialogs';
import { PreorderDialog, toCart, type PreorderRow } from './preorders';
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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-white p-8" role="status">
      <Skeleton className="h-10 w-64" />
      {text && <p className="text-ink-500">{text}</p>}
    </div>
  );
}

function FullScreenMessage({ tone, text }: { tone: 'danger' | 'info'; text: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-white p-8">
      <div className="max-w-md">
        <InlineAlert tone={tone}>{text}</InlineAlert>
        <Link to="/" className="mt-4 inline-block text-navy-700 underline">
          Thoát
        </Link>
      </div>
    </div>
  );
}

function PosShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <header className="on-navy flex h-14 items-center justify-between bg-navy-700 px-4 text-white">
        <span className="font-semibold">{title}</span>
        <Link to="/" className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm text-white/80 hover:bg-navy-800">
          <LogOut size={18} aria-hidden /> Thoát
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const first = registers.data?.items[0];
    if (first && !registerId) setRegisterId(first.id);
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
    <PosShell title="Đăng ký quầy">
      <form
        className="flex w-full max-w-md flex-col gap-5 rounded-lg border border-paper-300 bg-white p-6 shadow-sm"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const d = await registerDevice(registerId);
            await kvSet('registerCode', registers.data?.items.find((r) => r.id === registerId)?.code ?? '');
            onDone(d);
          } catch (err) {
            setError(errText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="text-lg font-semibold text-ink-900">Đăng ký quầy</h2>
        <label className="flex flex-col gap-1">
          <select className="h-12 rounded-md border border-paper-500 bg-white px-3" aria-label="Quầy" value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
            {registers.data?.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} · {r.name}
              </option>
            ))}
          </select>
        </label>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={!registerId}>
          Xác nhận
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
        className="flex w-full max-w-md flex-col gap-5 rounded-lg border border-paper-300 bg-white p-6 shadow-sm"
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
  // Plainly online: no pill in the POS header (Design §13.2).
  return null;
}

const stepBtn = 'inline-flex size-11 items-center justify-center rounded-full disabled:opacity-40';
const stepCircle = 'inline-flex size-7 items-center justify-center rounded-full border border-paper-500 bg-white text-ink-900 hover:bg-navy-50';

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
  const [dialog, setDialog] = useState<null | { kind: 'customer' } | { kind: 'line'; lineId: string } | { kind: 'approval'; action: CartApproval['action']; reason: string } | { kind: 'pay' } | { kind: 'done'; outcome: SaleOutcome } | { kind: 'close'; expected: number; source: 'server' | 'device' } | { kind: 'cash' } | { kind: 'held' } | { kind: 'coupon' } | { kind: 'points' } | { kind: 'orderDiscount' } | { kind: 'menu' } | { kind: 'preorder' }>(null);
  const [message, setMessage] = useState<{ tone: 'danger' | 'info' | 'success'; text: string } | null>(null);
  const [registerCode, setRegisterCode] = useState('');
  const [heldCount, setHeldCount] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const saleKey = useRef(crypto.randomUUID());
  const grants = useMemo(() => ({ discountUnlimited: can(me, 'sale.discount_unlimited'), priceOverride: can(me, 'sale.price_override') }), [me]);
  const readOnly = !status.leader;
  const lease = leaseState();
  // Pre-orders past their holding period, on the header button (FR-ORD-16).
  const badges = useQuery({ queryKey: ['badges'], enabled: status.online, queryFn: () => get<{ holdsOverdue?: number }>('/api/v1/me/badges'), refetchInterval: 60_000 });

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
  }, [cart.lines, cart.customer, cart.couponCode, cart.redeemPoints, cart.orderDiscount, cart.preorder, grants]); // eslint-disable-line react-hooks/exhaustive-deps

  // The order discount as spread over the lines by the pricing engine (FR-POS-02).
  const orderDiscountVnd = priced?.result.lines.reduce((a, l) => a + l.manualDiscountVnd, 0) ?? 0;

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
      { shift, cashierId: me.id, lines: cart.lines, customer: cart.customer, couponCode: cart.couponCode, redeemPoints: cart.redeemPoints, orderDiscount: cart.orderDiscount, approvals: cart.approvals, payments, priced: priced!.result, items: priced!.items, preorderId: cart.preorder?.id ?? null },
      saleKey.current,
    );
    setDialog({ kind: 'done', outcome });
  };

  const newSale = () => {
    cart.clear();
    saleKey.current = crypto.randomUUID();
    setDialog(null);
  };

  // “Nhận hàng tại quầy” on Đơn hàng opens /pos?preorder=DT-… : the pre-order goes into the cart (FR-POS-09).
  const [params, setParams] = useSearchParams();
  const preorderNo = params.get('preorder');
  useEffect(() => {
    if (!preorderNo || !status.online || readOnly) return;
    setParams({}, { replace: true });
    void (async () => {
      try {
        const r = await get<{ items: PreorderRow[] }>('/api/v1/preorders', { q: preorderNo });
        const p = r.items.find((x) => x.docNo === preorderNo);
        if (!p || (p.status !== 'arrived' && p.status !== 'contacted')) {
          setMessage({ tone: 'danger', text: `Phiếu ${preorderNo} chưa có hàng hoặc đã xử lý xong.` });
          return;
        }
        // A cart in progress goes to the held carts first.
        const c = useCart.getState();
        if (c.lines.length && !c.preorder) {
          await db.heldCarts.put({ id: crypto.randomUUID(), label: c.customer?.name ?? `Giỏ ${formatDateTime(new Date())}`, payload: { lines: c.lines, customer: c.customer, couponCode: c.couponCode, redeemPoints: c.redeemPoints, orderDiscount: c.orderDiscount }, heldAt: new Date().toISOString() });
          setHeldCount(await db.heldCarts.count());
          setMessage({ tone: 'info', text: 'Đã chuyển giỏ hàng đang bán vào Giỏ chờ.' });
        }
        const { preorder, customer } = toCart(p);
        c.loadPreorder(preorder, customer);
        saleKey.current = crypto.randomUUID();
      } catch (e) {
        setMessage({ tone: 'danger', text: errText(e) });
      }
    })();
  }, [preorderNo, status.online, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const holdCart = async () => {
    if (!cart.lines.length) return;
    await db.heldCarts.put({ id: crypto.randomUUID(), label: cart.customer?.name ?? `Giỏ ${formatDateTime(new Date())}`, payload: { lines: cart.lines, customer: cart.customer, couponCode: cart.couponCode, redeemPoints: cart.redeemPoints, orderDiscount: cart.orderDiscount }, heldAt: new Date().toISOString() });
    setHeldCount(await db.heldCarts.count());
    newSale();
    setMessage({ tone: 'success', text: 'Đã giữ giỏ hàng.' });
  };

  /** Cart lines: in the cart panel, and under the search field on tablet portrait / phone (Design §13.1). */
  const cartLines = cart.lines.map((l) => {
    const pl = lines.find((x) => x.lineId === l.lineId);
    const item = priced?.items.get(l.variantId);
    // A recalled pre-order line keeps its agreed price and quantity (FR-POS-09).
    if (cart.preorder && isPreorderLine(l.lineId)) {
      return (
        <li key={l.lineId} className="bg-olive-50 px-4 py-3">
          <p className="line-clamp-2 font-semibold">{item ? itemTitle(item) : '…'}</p>
          <p className="text-[13px] text-olive-700">
            Đặt trước <span className="code">{cart.preorder!.docNo}</span> · giá đã thỏa thuận
          </p>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <span className="text-ink-700 num">
              {l.qty} × {formatVnd(pl?.unitPriceVnd ?? 0)}
            </span>
            <span className="ml-auto font-semibold whitespace-nowrap num">{formatVnd(pl?.totalVnd ?? 0)}</span>
          </div>
        </li>
      );
    }
    return (
      <li key={l.lineId} className={clsx('px-4 py-3 transition-colors duration-[600ms]', cart.flashLineId === l.lineId && 'bg-sand-50')}>
        <div className="flex gap-2">
          <p className="line-clamp-2 flex-1 font-semibold">{item ? itemTitle(item) : '…'}</p>
          <button type="button" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-navy-50" aria-label="Tùy chọn dòng" onClick={() => setDialog({ kind: 'line', lineId: l.lineId })}>
            <MoreHorizontal size={20} aria-hidden />
          </button>
        </div>
        <p className="-mt-1 text-sm whitespace-nowrap text-ink-700 num">{formatVnd(pl?.unitPriceVnd ?? item?.priceVnd ?? 0)}</p>
        <div className="mt-2 flex items-center gap-2">
          {/* Compact stepper: 28 px circles, 44 px touch area each (Design §13.1, NFR-USE-02). */}
          <span className="-mx-2 inline-flex items-center">
            <button type="button" className={stepBtn} aria-label="Giảm số lượng" onClick={() => (l.qty === 1 ? cart.remove(l.lineId) : cart.setQty(l.lineId, l.qty - 1))}>
              <span className={stepCircle}>
                <Minus size={14} aria-hidden />
              </span>
            </button>
            <span className="w-8 text-center font-semibold num" aria-label="Số lượng">
              {l.qty}
            </span>
            <button type="button" className={stepBtn} aria-label="Tăng số lượng" onClick={() => cart.setQty(l.lineId, l.qty + 1)}>
              <span className={stepCircle}>
                <Plus size={14} aria-hidden />
              </span>
            </button>
          </span>
          <span className="ml-auto text-right font-semibold whitespace-nowrap num">{formatVnd(pl?.totalVnd ?? 0)}</span>
        </div>
        {pl?.savings.map((s) => (
          <p key={s.promotionId} className="mt-1 text-[13px] text-success-700 num">
            Giảm {formatVnd(s.amountVnd)} – {s.label}
          </p>
        ))}
        {l.note && <p className="mt-1 text-[13px] text-ink-500">{l.note}</p>}
      </li>
    );
  });
  const searching = results.length > 0 || q.trim().length >= 2;

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
            {cart.preorder ? (
              <button type="button" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-navy-50" aria-label="Bỏ nhận hàng đặt trước" onClick={() => cart.clear()}>
                <X size={18} aria-hidden />
              </button>
            ) : (
              <button type="button" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-navy-50" aria-label="Bỏ khách hàng" onClick={() => cart.setCustomer(null)}>
                <X size={18} aria-hidden />
              </button>
            )}
          </div>
        ) : (
          <Button variant="primary" icon={User} onClick={() => setDialog({ kind: 'customer' })} disabled={readOnly}>
            Thêm khách
          </Button>
        )}
      </div>
      <ul className="flex-1 divide-y divide-paper-300 overflow-y-auto" aria-live="polite">
        {cart.lines.length === 0 && (
          <li className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-500">
            <ShoppingCart size={48} className="text-ink-300" aria-hidden />
            <p>Chưa có sản phẩm nào được chọn</p>
          </li>
        )}
        {cartLines}
      </ul>
      <div className="border-t border-paper-300 p-4">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-sm num">
          <dt className="text-ink-700">Tạm tính</dt>
          <dd className="text-right">{formatVnd(priced?.result.subtotalVnd ?? 0)}</dd>
          {!!priced?.result.discountVnd && (
            <>
              <dt className="text-ink-700">Khuyến mãi / giảm giá</dt>
              <dd className="text-right text-success-700">−{formatVnd(priced.result.discountVnd).replace('−', '')}</dd>
            </>
          )}
          {can(me, 'sale.discount') && (
            <>
              <dt className="text-ink-700">Giảm giá đơn</dt>
              <dd className="flex items-center justify-end gap-1">
                {cart.orderDiscount ? (
                  <>
                    <span>{cart.orderDiscount.kind === 'percent' ? `${cart.orderDiscount.bp / 100}%` : formatVnd(cart.orderDiscount.vnd)}</span>
                    {orderDiscountVnd > 0 && <span className="text-success-700">−{formatVnd(orderDiscountVnd)}</span>}
                    <Button variant="ghost" size="sm" icon={X} className="size-8 px-0!" aria-label="Bỏ giảm giá đơn" title="Bỏ giảm giá đơn" onClick={() => cart.setOrderDiscount(null)} disabled={readOnly} />
                  </>
                ) : (
                  <Button variant="tonal" size="sm" icon={Percent} onClick={() => setDialog({ kind: 'orderDiscount' })} disabled={readOnly || !cart.lines.length}>
                    Giảm giá
                  </Button>
                )}
              </dd>
            </>
          )}
          <dt className="text-ink-700">Mã giảm giá</dt>
          <dd className="flex items-center justify-end gap-1">
            {cart.couponCode ? (
              <>
                <span className="code font-medium">{cart.couponCode}</span>
                {priced?.result.couponApplied ? (
                  <Check size={16} className="text-success-700" aria-label="Đã áp dụng" />
                ) : (
                  <span className="text-xs text-warning-700">không áp dụng</span>
                )}
                <Button variant="ghost" size="sm" icon={X} className="size-8 px-0!" aria-label="Bỏ mã giảm giá" title="Bỏ mã giảm giá" onClick={() => cart.setCoupon('')} disabled={readOnly} />
              </>
            ) : (
              <Button variant="tonal" size="sm" icon={Ticket} onClick={() => setDialog({ kind: 'coupon' })} disabled={readOnly}>
                Nhập mã
              </Button>
            )}
          </dd>
          {cart.customer && (
            <>
              <dt className="text-ink-700">
                Điểm <span className="text-ink-500">(có {formatNumber(cart.customer.pointsBalance)})</span>
              </dt>
              <dd className="flex items-center justify-end gap-1">
                {cart.redeemPoints ? (
                  <>
                    <span>{formatNumber(cart.redeemPoints)} điểm</span>
                    {!!priced?.result.redeemValueVnd && <span className="text-success-700">−{formatVnd(priced.result.redeemValueVnd)}</span>}
                    <Button variant="ghost" size="sm" icon={X} className="size-8 px-0!" aria-label="Bỏ dùng điểm" title="Bỏ dùng điểm" onClick={() => cart.setRedeem(0)} disabled={readOnly} />
                  </>
                ) : (
                  <Button variant="tonal" size="sm" icon={Coins} onClick={() => setDialog({ kind: 'points' })} disabled={readOnly || !cart.customer.pointsBalance}>
                    Dùng điểm
                  </Button>
                )}
              </dd>
            </>
          )}
          <dt className="mt-1 text-base font-semibold">TỔNG</dt>
          <dd className="mt-1 text-right text-[28px] leading-9 font-bold whitespace-nowrap">{formatVnd(total)}</dd>
          {!!cart.preorder?.depositVnd && (
            <>
              <dt className="text-ink-700">Đã đặt cọc</dt>
              <dd className="text-right">−{formatVnd(cart.preorder.depositVnd)}</dd>
              <dt className="font-semibold">Còn phải trả</dt>
              <dd className="text-right font-semibold">{formatVnd(Math.max(0, total - cart.preorder.depositVnd))}</dd>
            </>
          )}
        </dl>
        <div className="mt-3 grid grid-cols-[1fr_3fr] gap-2">
          <Button variant="secondary" size="lg" className="px-2!" onClick={holdCart} disabled={!cart.lines.length || readOnly || !!cart.preorder}>
            Giữ giỏ
          </Button>
          <Button variant="accent" size="lg" full icon={Check} disabled={!cart.lines.length || !priced || readOnly || lease === 'expired'} onClick={confirm}>
            Xác nhận
          </Button>
        </div>
      </div>
    </div>
  );

  const editing = dialog?.kind === 'line' ? cart.lines.find((l) => l.lineId === dialog.lineId) : undefined;

  return (
    <div className="flex h-dvh flex-col bg-white">
      <header className="on-navy flex h-14 shrink-0 items-center gap-3 bg-navy-700 px-4 text-white">
        <button type="button" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-navy-800" aria-label="Menu ca làm" onClick={() => setDialog({ kind: 'menu' })}>
          <Menu size={20} aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate font-semibold code" title={`${me.displayName} · Quầy ${registerCode}`}>
          {registerCode}
        </span>
        <ConnectionPill />
        <button
          type="button"
          className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-navy-800 pointer-coarse:size-11"
          aria-label={badges.data?.holdsOverdue ? `Đặt trước – ${badges.data.holdsOverdue} phiếu quá hạn giữ hàng` : 'Đặt trước'}
          title="Đặt trước"
          onClick={() => setDialog({ kind: 'preorder' })}
          disabled={readOnly}
        >
          <CalendarClock size={22} aria-hidden />
          {!!badges.data?.holdsOverdue && <span className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-danger-700 px-1 text-center text-xs leading-5 font-semibold num" aria-hidden>{badges.data.holdsOverdue}</span>}
        </button>
        <button
          type="button"
          className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-navy-800 pointer-coarse:size-11"
          aria-label={`Giỏ chờ – ${heldCount} giỏ`}
          title="Giỏ chờ"
          onClick={() => setDialog({ kind: 'held' })}
        >
          <ShoppingBasket size={22} aria-hidden />
          {heldCount > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-white px-1 text-center text-xs leading-5 font-semibold text-navy-700 num" aria-hidden>{heldCount}</span>}
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
          <form onSubmit={submitSearch} className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
            <Search size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />
            <input
              ref={search}
              autoFocus
              className={clsx('h-12 w-full rounded-md border bg-white pr-4 pl-10 text-base code focus:border-navy-700', notFound ? 'border-danger-700' : 'border-paper-500')}
              placeholder="Nhập SKUs/tên sản phẩm"
              aria-label="Nhập SKUs/tên sản phẩm"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setNotFound(null);
              }}
              disabled={readOnly}
            />
            </div>
            <button type="button" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-navy-700 text-white hover:bg-navy-800" aria-label="Quét bằng camera" onClick={() => setCamera(true)}>
              <ScanBarcode size={22} aria-hidden />
            </button>
          </form>
          {notFound && <InlineAlert tone="danger">Không tìm thấy mã {notFound}. Thử tìm theo tên sản phẩm.</InlineAlert>}
          {message && (
            <div onClick={() => setMessage(null)}>
              <InlineAlert tone={message.tone}>{message.text}</InlineAlert>
            </div>
          )}
          {searching ? (
            <ul className="min-h-0 flex-1 divide-y divide-paper-300 overflow-y-auto rounded-lg border border-paper-300 bg-white shadow-sm">
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
                      <span className="line-clamp-2 font-medium">{itemTitle(r)}</span>
                      <span className="block text-[13px] text-ink-500">
                        {r.authors.join(', ')} {r.authors.length ? '· ' : ''}
                        <span className="code">{r.sku}</span>
                      </span>
                    </span>
                    <span className="font-semibold num">{formatVnd(r.priceVnd)}</span>
                  </button>
                </li>
              ))}
              {!results.length && <li className="p-6 text-center text-ink-500">Không có sản phẩm phù hợp.</li>}
            </ul>
          ) : (
            // Tablet portrait / phone: the whole cart on the selling screen, no bottom sheet (Design §13.1).
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-paper-300 bg-white shadow-sm lg:hidden" aria-label="Giỏ hàng">
              {cartPanel}
            </div>
          )}
        </section>
        <aside className="hidden w-[420px] shrink-0 border-l border-paper-300 bg-white lg:block">{cartPanel}</aside>
      </div>

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
          title={(() => { const it = priced?.items.get(editing.variantId); return it ? itemTitle(it) : ''; })()}
          unitPriceVnd={priced?.items.get(editing.variantId)?.priceVnd ?? 0}
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
      {dialog?.kind === 'pay' && priced && <PaymentSheet priced={priced.result} depositVnd={cart.preorder?.depositVnd ?? 0} online={status.online} onClose={() => setDialog(null)} onPay={pay} />}
      {dialog?.kind === 'preorder' && (
        <PreorderDialog
          shiftId={shift.serverId ?? null}
          online={status.online}
          customer={cart.preorder ? null : cart.customer}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'done' && <SaleDone outcome={dialog.outcome} online={status.online} onNew={newSale} />}
      {dialog?.kind === 'orderDiscount' && (
        <OrderDiscountDialog
          initial={cart.orderDiscount}
          // What the discount applies to: the order after automatic promotions and tier discounts.
          baseVnd={priced ? priced.result.lines.reduce((a, l) => a + l.grossVnd - l.promoDiscountVnd - l.tierDiscountVnd - l.orderDiscountVnd, 0) : 0}
          onClose={() => setDialog(null)}
          onSave={(d) => {
            cart.setOrderDiscount(d);
            setDialog(null);
          }}
        />
      )}
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
              <LogOut size={20} aria-hidden /> Thoát
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

