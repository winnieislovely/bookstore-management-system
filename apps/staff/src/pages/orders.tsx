import { isVnMobile, normalizePhone, ORDER_SOURCES, RECIPIENT_MOBILE_MESSAGE, type ManualDiscount } from '@bookstore/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Calculator, CheckCircle, Minus, MoreHorizontal, Package, PackageCheck, Plus, Truck, Undo2, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ConfirmDialog, DataTable, Facts, FilterMenu, Pager, SearchBox, SelectField, TextArea, TimeFilter, timeLabel, timeRange, toast, useDebounced, useListParam, useParam, type Column } from '../components/data';
import type { PickedCustomer } from '../components/customer-picker';
import { DiscountInput } from '../components/discount-input';
import { Combobox, CopyCode, ORDER_SOURCE, OrderStatusChip, PaymentChip, REVIEW_REASON, StatusTimeline, type TimelineEntry } from '../components/order-ui';
import { ProductSearch, hitTitle, type ProductHit } from '../components/product-search';
import type { PreorderRow } from '../pos/preorders';
import { Button, Card, ErrorState, Field, InlineAlert, PageHeader, Skeleton } from '../components/ui';
import { ApiError, api, get, post } from '../lib/api';
import { formatDateTime, formatNumber, formatPhone, formatVnd } from '../lib/format';
import { can, useMe } from '../lib/session';
import { Dialog, MoneyInput } from '../pos/widgets';

/** Delivery – “Giao hàng”: confirmed carrier orders and social-order entry (FR-ORD-01/02/10/11, FR-SOC-03, Design §12.9, §12.3, §12.4). */

interface OrderRow {
  id: string;
  docNo: string;
  createdAt: string;
  recipient: { name: string; phone: string };
  source: string;
  channelName: string | null;
  items: number;
  totalVnd: number;
  paymentMethod: string;
  paidAt: string | null;
  status: string;
  reviewReasons: string[];
  delivery: string;
  readAt: string | null;
  trackingNo: string | null;
}

const CONFIRMABLE = new Set(['new', 'pending_review']);
/** Delivery stages (FR-ORD-01). */
const STAGES: Record<string, string> = { waiting: 'Chờ tạo vận đơn', shipping: 'Đang giao', delivered: 'Đã giao', failed: 'Giao thất bại / hoàn về' };

export function OrdersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useParam('q');
  const [stage, setStage] = useListParam('stage');
  const [source, setSource] = useListParam('source');
  const [time, setTime] = useParam('time');
  const [page, setPage] = useParam('page', '1');
  const query = { scope: 'delivery', q: q || undefined, stage: stage.join(',') || undefined, source: source.join(',') || undefined, ...timeRange(time), page: Number(page), limit: 40 };
  // The list refreshes itself while open (20-second polling, TDD §4.5 fallback; FR-ORD-03).
  const list = useQuery({
    queryKey: ['orders', query],
    queryFn: () => get<{ items: OrderRow[]; total: number; stages?: Record<string, number> }>('/api/v1/orders', query),
    refetchInterval: 20_000,
  });
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const rows = list.data?.items;
  const columns: Column<OrderRow>[] = [
    {
      header: 'Mã đơn',
      cell: (r) => (
        <span className={clsx('inline-flex items-center gap-2', !r.readAt && 'font-bold')}>
          {!r.readAt && <span className="size-2 rounded-full bg-navy-700" aria-label="Chưa xem" />}
          <span className="code">{r.docNo}</span>
        </span>
      ),
    },
    {
      header: 'Khách hàng',
      cell: (r) => (
        <span>
          {r.recipient.name}
          <span className="block text-[13px] text-ink-500">{formatPhone(r.recipient.phone)}</span>
        </span>
      ),
    },
    // Source as plain text, no colour dot (Design §10.5).
    { header: 'Kênh', cell: (r) => <span className="text-ink-700">{r.channelName ?? ORDER_SOURCE[r.source] ?? r.source}</span> },
    { header: 'SP', align: 'right', cell: (r) => formatNumber(r.items) },
    { header: 'Tổng tiền', align: 'right', cell: (r) => formatVnd(r.totalVnd) },
    { header: 'Thanh toán', cell: (r) => <PaymentChip method={r.paymentMethod} paidAt={r.paidAt} status={r.status} /> },
    { header: 'Trạng thái', cell: (r) => <OrderStatusChip status={r.status} reasons={r.reviewReasons} /> },
    { header: 'Vận đơn', cell: (r) => (r.trackingNo ? <span className="code">{r.trackingNo}</span> : <span className="text-ink-500">—</span>) },
    { header: 'Thời gian', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.createdAt) },
  ];
  const stages = list.data?.stages ?? {};

  return (
    <>
      <PageHeader
        title="Giao hàng"
        actions={
          <>
            <Button variant="primary" icon={Plus} onClick={() => navigate('/orders/new')}>
              Tạo đơn giao
            </Button>
          </>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm mã đơn, người nhận, SĐT, mã vận đơn…" />
        <FilterMenu
          groups={[
            { label: 'Giai đoạn', options: Object.entries(STAGES).map(([k, label]) => ({ key: k, label, count: stages[k] ?? 0 })), values: stage, onChange: setStage },
            { label: 'Kênh', options: ORDER_SOURCES.map((k) => ({ key: k, label: ORDER_SOURCE[k]! })), values: source, onChange: setSource },
            { kind: 'custom', label: 'Thời gian', summary: timeLabel(time), active: !!time, onClear: () => setTime(''), content: <TimeFilter value={time} onChange={setTime} /> },
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRow={(r) => navigate(`/orders/${r.id}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        minWidth={1040}
        empty={{ icon: Truck, title: q || stage.length || source.length || time ? 'Không có đơn phù hợp' : 'Chưa có đơn cần giao', help: 'Đơn đã xác nhận cần giao qua đơn vị vận chuyển sẽ hiện ở đây. Đơn mạng xã hội tạo bằng nút Tạo đơn giao.' }}
      />
      <Pager page={Number(page)} hasMore={(rows?.length ?? 0) === 40} {...(list.data && { total: list.data.total })} onPage={(p) => setPage(String(p))} />
    </>
  );
}

// =============================================================================================
// Create order (“Tạo đơn”, FR-ORD-02, UC-09)

interface Line {
  hit: ProductHit;
  qty: number;
}
// Small stepper like the POS cart line (Design §12.9, §13.1).
const stepBtn = 'inline-flex h-11 w-8 items-center justify-center rounded-md text-ink-700 hover:text-navy-700 disabled:opacity-40';

interface Quote {
  subtotalVnd: number;
  discountVnd: number;
  lines: { manualDiscountVnd: number; savings: { promotionId: string; label: string; amountVnd: number }[] }[];
  shippingVnd: number;
  shippingDiscountVnd: number;
  totalVnd: number;
  pointsToEarn: number;
  approvalsRequired: unknown[];
  issues: { code: string }[];
  /** A pre-order's deposit, counted as paid (FR-ORD-14). */
  depositVnd?: number;
}
interface Channel {
  id: string;
  name: string;
  kind: string;
  active: boolean;
}

/**
 * Recipient phone and name; from 4 digits typed, customers whose phone matches are suggested
 * under the phone field, and picking one links the order to them (FR-SOC-03, Design §12.9).
 */
function RecipientFields({
  value,
  linked,
  onChange,
  onPick,
  onUnlink,
  phoneError,
}: {
  value: { phone: string; name: string };
  linked: PickedCustomer | null;
  onChange: (v: { phone: string; name: string }) => void;
  onPick: (c: PickedCustomer) => void;
  onUnlink: () => void;
  /** Not a Vietnamese mobile number for a carrier delivery (Design §12.9). */
  phoneError?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const digits = useDebounced(value.phone.replace(/\D/g, ''), 300);
  const found = useQuery({
    queryKey: ['recipient-suggest', digits],
    enabled: digits.length >= 4 && !linked,
    queryFn: async () => (await get<{ items: PickedCustomer[] }>('/api/v1/customers', { q: digits, limit: 6 })).items.filter((c) => c.phoneE164 && c.phoneE164.replace(/\D/g, '').includes(digits.replace(/^0/, ''))),
  });
  const items = !linked && digits.length >= 4 ? (found.data ?? []) : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="relative">
          <Field
            label="Số điện thoại"
            required
            inputMode="tel"
            autoComplete="off"
            error={phoneError ?? undefined}
            value={value.phone}
            onChange={(e) => {
              onChange({ ...value, phone: e.target.value });
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
          />
          {open && items.length > 0 && (
            <ul className="absolute inset-x-0 top-full z-20 mt-1 divide-y divide-paper-300 overflow-hidden rounded-md border border-paper-300 bg-white shadow-md" aria-label="Khách có số điện thoại này">
              {items.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-navy-50"
                    // mousedown keeps the field from losing focus before the pick.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setOpen(false);
                      onPick(c);
                    }}
                  >
                    <span className="font-medium">{c.name}</span>
                    <span className="text-ink-500 num">{[c.phoneE164 && formatPhone(c.phoneE164), c.tierName, `${formatNumber(c.pointsBalance)} điểm`].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Field label="Tên người nhận" required value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </div>
      {linked && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-700">
          <span>
            Khách cũ{linked.tierName ? ` · ${linked.tierName}` : ''} · {formatNumber(linked.pointsBalance)} điểm
          </span>
          <button type="button" className="inline-flex items-center gap-1 font-medium text-navy-700 underline" onClick={onUnlink}>
            <X size={14} aria-hidden /> Bỏ liên kết
          </button>
        </p>
      )}
    </div>
  );
}

function useProvinces() {
  return useQuery({ queryKey: ['geo-provinces'], queryFn: () => get<{ items: { id: number; name: string }[] }>('/api/v1/geo/provinces'), staleTime: 3600_000 });
}
function useWards(provinceId: number | null) {
  return useQuery({
    queryKey: ['geo-wards', provinceId],
    enabled: provinceId !== null,
    queryFn: () => get<{ items: { code: string; label: string }[] }>(`/api/v1/geo/provinces/${provinceId}/wards`),
    staleTime: 3600_000,
  });
}

export function OrderNewPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Opened from a pre-order slip chosen for Giao hàng (FR-ORD-14, Design §12.9).
  const slipNo = useSearchParams()[0].get('preorder');
  const slipQ = useQuery({
    queryKey: ['preorder-for-delivery', slipNo],
    enabled: !!slipNo,
    queryFn: async () => (await get<{ items: PreorderRow[] }>('/api/v1/preorders', { q: slipNo! })).items.find((x) => x.docNo === slipNo) ?? null,
  });
  const slip = slipQ.data ?? null;
  const [f, setF] = useState({
    source: slipNo ? 'phone' : 'facebook',
    channelId: '',
    delivery: 'ship' as 'ship' | 'pickup',
    provinceId: null as number | null,
    wardCode: '',
    line: '',
    paymentMethod: 'cod' as 'cod' | 'transfer',
    shippingVnd: 0 as number | null,
    note: '',
  });
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channels = useQuery({ queryKey: ['channels', 'active'], queryFn: () => get<{ items: Channel[] }>('/api/v1/channels', { active: 'true' }) });
  const provinces = useProvinces();
  const wards = useWards(f.provinceId);
  const kindChannels = (channels.data?.items ?? []).filter((c) => c.kind === f.source);

  // Existing customer found by phone or name, or a new one (FR-SOC-03, Design §12.9).
  const { data: me } = useMe();
  const [discount, setDiscount] = useState<ManualDiscount | null>(null);
  const [rcpt, setRcpt] = useState({ phone: '', name: '' });
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [linked, setLinked] = useState<PickedCustomer | null>(null);
  const customerId = linked?.id ?? null;
  // A known customer fills the recipient and, when they have one, their latest delivery address (FR-SOC-03).
  const pickCustomer = async (c: PickedCustomer) => {
    setLinked(c);
    setRcpt({ phone: c.phoneE164 ? formatPhone(c.phoneE164) : rcpt.phone, name: c.name });
    try {
      const r = await get<{ address: { provinceId: number; wardCode: string; line: string } | null }>('/api/v1/orders/last-address', { customerId: c.id });
      if (r.address) setF((x) => ({ ...x, delivery: 'ship', provinceId: r.address!.provinceId, wardCode: r.address!.wardCode, line: r.address!.line }));
    } catch {
      /* no address to fill: staff enter it */
    }
  };

  // The slip fills the customer and its books once (quantities fixed, priced by the server).
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (!slip || filled) return;
    setFilled(true);
    setLines(
      slip.lines.map((l) => ({
        hit: { variantId: l.variantId!, itemId: '', kind: 'book', title: l.title, titleVi: null, sku: l.sku ?? '', priceVnd: l.unitPriceVnd ?? 0, available: 1, imageFileId: null },
        qty: l.qty,
      })),
    );
    void pickCustomer({ id: slip.customerId, name: slip.customerName, phoneE164: slip.customerPhone, tierCode: slip.customerTierCode, pointsBalance: slip.customerPoints });
  }, [slip, filled]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = useMemo(
    () => ({
      source: f.source,
      ...(slip && { preorderId: slip.id }),
      ...(customerId && { customerId }),
      lines: lines.map((l) => ({ variantId: l.hit.variantId, qty: l.qty })),
      // A manual discount for the whole order; promotions apply by themselves (FR-ORD-02).
      orderManualDiscount: discount,
      shippingVnd: f.delivery === 'ship' ? (f.shippingVnd ?? 0) : 0,
    }),
    [f.source, f.delivery, f.shippingVnd, discount, lines, customerId, slip],
  );
  // GHN fee recalculated whenever the ward or the items change, unless staff typed a fee (FR-ORD-10).
  const [feeManual, setFeeManual] = useState(false);
  const feeKey = useDebounced(f.delivery === 'ship' && f.wardCode && lines.length ? JSON.stringify({ wardCode: f.wardCode, lines: lines.map((l) => ({ variantId: l.hit.variantId, qty: l.qty })) }) : '', 400);
  const fee = useQuery({
    queryKey: ['shipping-quote', feeKey],
    enabled: !!feeKey && !feeManual,
    queryFn: () => post<{ feeVnd: number }>('/api/v1/orders/shipping-quote', JSON.parse(feeKey)),
    retry: false,
  });
  useEffect(() => {
    if (fee.data && !feeManual) setF((x) => ({ ...x, shippingVnd: fee.data.feeVnd }));
  }, [fee.data, feeManual]);
  const quoteKey = useDebounced(JSON.stringify(body), 300);
  const quote = useQuery({
    queryKey: ['order-quote', quoteKey],
    enabled: lines.length > 0,
    queryFn: () => post<Quote>('/api/v1/orders/quote', JSON.parse(quoteKey)),
    retry: false,
  });

  const add = (h: ProductHit) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.hit.variantId === h.variantId);
      if (i < 0) return [...ls, { hit: h, qty: 1 }];
      return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
    });

  const save = async () => {
    setError(null);
    if (!lines.length) return setError('Đơn chưa có sản phẩm.');
    const recipient = { name: rcpt.name.trim(), phone: rcpt.phone.trim() };
    if (!recipient.phone || !recipient.name) return setError('Cần nhập số điện thoại và tên người nhận.');
    // The carrier takes only Vietnamese mobile numbers (FR-ORD-02, Design §12.9).
    if (f.delivery === 'ship' && !isVnMobile(normalizePhone(recipient.phone))) {
      setPhoneError(RECIPIENT_MOBILE_MESSAGE);
      return setError(RECIPIENT_MOBILE_MESSAGE);
    }
    setBusy(true);
    try {
      const r = await api<{ id: string; docNo: string; status: string }>('POST', '/api/v1/orders', {
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: {
          ...body,
          channelId: f.channelId || null,
          recipient,
          delivery: f.delivery,
          address: f.delivery === 'ship' ? { ...(f.provinceId !== null && { provinceId: f.provinceId }), ...(f.wardCode && { wardCode: f.wardCode }), line: f.line.trim() } : null,
          paymentMethod: f.paymentMethod,
          note: f.note.trim() || null,
        },
      });
      // “Tạo đơn giao”: the order is confirmed at once and its GHN shipment is created in the same step (FR-ORD-02).
      if (f.delivery === 'ship' && r.status === 'confirmed') {
        try {
          await post(`/api/v1/orders/${r.id}/shipment`, { carrier: 'ghn' });
          toast.success(`Đã tạo đơn ${r.docNo} và vận đơn.`);
        } catch (e) {
          toast.error(`Đã tạo đơn ${r.docNo} nhưng chưa tạo được vận đơn: ${(e as Error).message} Hãy tạo vận đơn từ đơn này.`);
        }
      } else {
        toast.success(`Đã tạo đơn ${r.docNo}.`);
      }
      void qc.invalidateQueries({ queryKey: ['orders'] });
      void qc.invalidateQueries({ queryKey: ['order-list'] });
      if (slip) void qc.invalidateQueries({ queryKey: ['preorders'] });
      navigate(`/orders/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'approval_required' ? 'Giảm giá vượt hạn mức của bạn. Hãy giảm bớt hoặc nhờ quản lý tạo đơn.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const q = quote.data;
  // The manual discount vs promotions, which apply by themselves (Design §12.9).
  const manualVnd = q ? q.lines.reduce((a, l) => a + l.manualDiscountVnd, 0) : 0;
  const autoVnd = q ? Math.max(0, q.discountVnd - manualVnd) : 0;
  const promoNames = [...new Map((q?.lines ?? []).flatMap((l) => l.savings).map((x) => [x.promotionId, x.label])).values()];
  return (
    <div className="pb-20">
      <PageHeader
        back={slip ? { to: '/preorders', label: 'Đặt trước' } : { to: '/orders', label: 'Giao hàng' }}
        title="Tạo đơn giao"
      />
      {slipNo && slipQ.isFetched && !slip && (
        <div className="mb-4">
          <InlineAlert tone="danger">Không tìm thấy phiếu đặt trước {slipNo}.</InlineAlert>
        </div>
      )}
      {slip && (
        <div className="mb-4">
          <InlineAlert tone="info">Tạo từ phiếu đặt trước {slip.docNo} – sách và giá theo phiếu.</InlineAlert>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card title="Thông tin đơn hàng">
            <div className="grid grid-cols-1 gap-4">
              <SelectField label="Kênh" required value={f.source} onChange={(e) => setF({ ...f, source: e.target.value, channelId: '' })}>
                {ORDER_SOURCES.filter((s) => s !== 'website').map((s) => (
                  <option key={s} value={s}>
                    {ORDER_SOURCE[s]}
                  </option>
                ))}
              </SelectField>
              {kindChannels.length > 0 ? (
                <SelectField label="Trang / tài khoản" value={f.channelId} onChange={set('channelId')}>
                  <option value="">—</option>
                  {kindChannels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </SelectField>
              ) : null}
            </div>
            <div className="h-5" aria-hidden />
            {/* Each line like the POS cart line: name, then price with the − qty + stepper at the right; − at 1 removes it (Design §12.9). */}
            <p className="mb-1 text-[13px] font-medium text-ink-700">Sản phẩm</p>
            {!slip && <ProductSearch onPick={add} hideSku placeholder="Nhập SKU / tên sản phẩm" />}
            {lines.length > 0 && (
              <ul className="mt-4 divide-y divide-paper-300">
                {lines.map((l, i) => {
                  const update = (patch: Partial<Line>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <li key={l.hit.variantId} className="bg-white py-3">
                      <p className="line-clamp-2 font-semibold">{hitTitle(l.hit)}</p>
                      <div className="flex items-center gap-2">
                        <p className="flex-1 text-sm whitespace-nowrap text-ink-700 num">{formatVnd(l.hit.priceVnd)}</p>
                        {slip ? (
                          // From a slip: its quantities, no stepper (FR-ORD-14).
                          <span className="text-sm font-semibold num">× {l.qty}</span>
                        ) : (
                        <span className="-my-2 -mr-1 inline-flex items-center">
                          <button type="button" className={stepBtn} aria-label={`Giảm số lượng ${hitTitle(l.hit)}`} onClick={() => (l.qty === 1 ? setLines(lines.filter((_, j) => j !== i)) : update({ qty: l.qty - 1 }))}>
                            <Minus size={16} aria-hidden />
                          </button>
                          <span className="inline-flex h-7 min-w-8 items-center justify-center rounded-sm border border-paper-500 bg-white px-1 text-sm font-semibold num" aria-label="Số lượng">
                            {l.qty}
                          </span>
                          <button type="button" className={stepBtn} aria-label={`Tăng số lượng ${hitTitle(l.hit)}`} onClick={() => update({ qty: l.qty + 1 })}>
                            <Plus size={16} aria-hidden />
                          </button>
                        </span>
                        )}
                      </div>
                      {/* Stock is not shown; only an out-of-stock product is flagged (Design §12.9). */}
                      {l.hit.available <= 0 && <span className="mt-1 inline-block rounded-full bg-danger-50 px-2 text-xs leading-5 font-medium text-danger-700">Hết hàng</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Thông tin giao hàng">
            <RecipientFields
              value={rcpt}
              linked={linked}
              phoneError={phoneError}
              onChange={(v) => {
                if (v.phone !== rcpt.phone) setPhoneError(null);
                // Changing the phone after a pick unlinks the customer; changing the name does not.
                if (linked && v.phone !== rcpt.phone) setLinked(null);
                setRcpt(v);
              }}
              onPick={(c) => void pickCustomer(c)}
              onUnlink={() => setLinked(null)}
            />
            <div className="h-5" aria-hidden />
            {/* Always delivered by carrier: store pickup for chat customers goes through the POS (FR-ORD-02). */}
            {f.delivery === 'ship' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Combobox
                  label="Tỉnh/Thành phố"
                  required
                  placeholder={provinces.data?.items.length === 0 ? 'Chưa có dữ liệu địa chỉ GHN' : 'Chọn tỉnh/thành phố'}
                  options={(provinces.data?.items ?? []).map((p) => ({ key: String(p.id), label: p.name }))}
                  value={f.provinceId === null ? '' : String(f.provinceId)}
                  onChange={(k) => setF({ ...f, provinceId: Number(k), wardCode: '' })}
                />
                <Combobox
                  label="Phường/Xã"
                  required
                  disabled={f.provinceId === null}
                  placeholder="Chọn phường/xã"
                  options={(wards.data?.items ?? []).map((w) => ({ key: w.code, label: w.label }))}
                  value={f.wardCode}
                  onChange={(k) => setF({ ...f, wardCode: k })}
                />
                <div className="sm:col-span-2">
                  <Field label="Địa chỉ cụ thể" required value={f.line} onChange={set('line')} helper="Số nhà, ngõ, đường." />
                </div>
              </div>
            )}
          </Card>

        </div>

        <div className="flex flex-col gap-6">
          <Card title="Thanh toán">
            <div className="mb-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Phương thức thanh toán">
              {(
                [
                  ['cod', 'Thu hộ (COD)'],
                  ['transfer', 'Chuyển khoản'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.paymentMethod === k}
                  onClick={() => setF({ ...f, paymentMethod: k })}
                  className={clsx('h-12 rounded-xl border text-sm font-medium', f.paymentMethod === k ? 'border-2 border-navy-700 bg-navy-50 text-navy-700' : 'border-paper-500')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-4">
              {f.delivery === 'ship' && (
                <div className="flex flex-col gap-2">
                  <MoneyInput
                    label="Phí giao hàng"
                    value={f.shippingVnd}
                    onChange={(v) => {
                      setFeeManual(true);
                      setF({ ...f, shippingVnd: v });
                    }}
                  />
                  {/* Only states worth reading: no standing hint under the field (Design §12.9). */}
                  {(feeManual || (feeKey && (fee.isFetching || fee.isError))) && (
                    <p className="text-[13px] text-ink-500" aria-live="polite">
                      {feeManual ? 'Phí nhập tay.' : fee.isFetching ? 'Đang tính phí GHN…' : (fee.error as Error).message}
                    </p>
                  )}
                  {feeManual && feeKey && (
                    <Button variant="tonal" size="sm" icon={Calculator} onClick={() => setFeeManual(false)}>
                      Tính lại theo GHN
                    </Button>
                  )}
                </div>
              )}
              {can(me, 'sale.discount') && !slip && (
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-medium text-ink-700">Giảm giá</span>
                  <DiscountInput size="md" value={discount} onChange={setDiscount} disabled={!lines.length} />
                  {manualVnd > 0 && <p className="text-[13px] text-ink-500">= {formatVnd(manualVnd)}</p>}
                </div>
              )}
              <TextArea label="Ghi chú" value={f.note} onChange={set('note')} />
            </div>
          </Card>
          <Card title="Tổng cộng">
            {q ? (
              <Facts
                items={[
                  ['Tạm tính', <span className="num">{formatVnd(q.subtotalVnd)}</span>],
                  ...(autoVnd
                    ? ([
                        [
                          'Khuyến mãi',
                          <span className="flex flex-col items-end">
                            <span className="num text-success-700">−{formatVnd(autoVnd)}</span>
                            {promoNames.length > 0 && <span className="text-xs text-ink-500">{promoNames.join(' · ')}</span>}
                          </span>,
                        ],
                      ] as [string, React.ReactNode][])
                    : []),
                  ...(manualVnd ? ([['Giảm giá', <span className="num text-success-700">−{formatVnd(manualVnd)}</span>]] as [string, React.ReactNode][]) : []),
                  ['Phí giao hàng', <span className="num">{formatVnd(q.shippingVnd - q.shippingDiscountVnd)}</span>],
                  ['Tổng', <span className="text-lg font-bold num">{formatVnd(q.totalVnd)}</span>],
                  // A pre-order's deposit counts as paid: the order collects the rest (FR-ORD-14).
                  ...(q.depositVnd
                    ? ([
                        ['Đã đặt cọc', <span className="num">−{formatVnd(q.depositVnd)}</span>],
                        ['Còn phải thu', <span className="font-bold num">{formatVnd(Math.max(0, q.totalVnd - q.depositVnd))}</span>],
                      ] as [string, React.ReactNode][])
                    : []),
                ]}
              />
            ) : (
              <p className="text-sm text-ink-500">{lines.length ? 'Đang tính…' : 'Thêm sản phẩm để tính tiền.'}</p>
            )}
            {quote.error && (
              <div className="mt-3">
                <InlineAlert tone="danger">{(quote.error as Error).message}</InlineAlert>
              </div>
            )}
          </Card>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-center justify-end gap-2 border-t border-paper-300 bg-white px-4 shadow-sm sm:px-6 md:left-[72px] lg:left-[264px]">
        <Button variant="secondary" onClick={() => navigate('/orders')}>
          Hủy
        </Button>
        <Button variant="primary" loading={busy} onClick={save}>
          Xác nhận
        </Button>
      </div>
    </div>
  );
}

// =============================================================================================
// Order record (Design §12.3)

interface Order {
  id: string;
  docNo: string;
  status: string;
  source: string;
  sourceRef: string | null;
  channelName: string | null;
  recipient: { name: string; phone: string };
  delivery: 'ship' | 'pickup';
  address: { provinceName: string; wardName: string; line: string } | null;
  paymentMethod: string;
  paymentRef: string | null;
  paidAt: string | null;
  subtotalVnd: number;
  discountVnd: number;
  shippingVnd: number;
  totalVnd: number;
  vatVnd: number;
  depositVnd: number;
  pointsRedeemed: number;
  pointsEarned: number;
  couponCode: string | null;
  reviewReasons: string[];
  note: string | null;
  readyAt: string | null;
  doneAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  hasPickupCode: boolean;
  customer: { id: string; name: string; phoneE164: string | null; tierName: string | null; pointsBalance: number } | null;
  lines: { id: string; description: string; sku: string; qty: number; unitPriceVnd: number; discountVnd: number; totalVnd: number }[];
  events: TimelineEntry[];
  shipments: { id: string; carrier: string; trackingNo: string; status: string; feeVnd: number; codVnd: number; createdAt: string }[];
  returns: { id: string; status: string; reason: string; lines: { orderLineId: string; qty: number; restock?: boolean }[]; returnShippingPaidBy: string; refundVnd: number | null; createdAt: string }[];
}

const SHIPMENT_STATUS: Record<string, string> = {
  created: 'Chờ lấy hàng',
  picking: 'Đang lấy hàng',
  in_transit: 'Đang vận chuyển',
  delivered: 'Đã giao',
  failed: 'Giao không thành công',
  returning: 'Đang hoàn hàng',
  returned: 'Đã hoàn về',
  cancelled: 'Đã hủy',
};

const EVENT_REASON = (r: string) =>
  r
    .split(',')
    .map((x) => REVIEW_REASON[x] ?? { payment_confirmed: 'Đã nhận chuyển khoản', delivered: 'Đã giao thành công', picked_up: 'Khách đã nhận tại cửa hàng' }[x] ?? x)
    .join(', ');

type DialogKind = null | 'menu' | 'cancel' | 'payment' | 'shipment' | 'handover' | 'return' | 'reject' | 'receive' | { code: string };

export function OrderDetailPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ['order', id], queryFn: () => get<Order>(`/api/v1/orders/${id}`) });
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [busy, setBusy] = useState(false);

  if (order.isError) return <ErrorState error={order.error} onRetry={() => order.refetch()} />;
  if (!order.data) return <Skeleton className="h-64" />;
  const o = order.data;
  const refresh = async () => {
    await order.refetch();
    void qc.invalidateQueries({ queryKey: ['orders'] });
    void qc.invalidateQueries({ queryKey: ['order-list'] });
  };
  // Cashiers may confirm website orders but do not work deliveries (FR-ORD-03, SRS Appendix A).
  const works = can(me, 'online.manage');
  // Unconfirmed and store-pickup orders live on Đơn hàng; the rest are followed on Giao hàng.
  const onOrders = CONFIRMABLE.has(o.status) || o.delivery === 'pickup' || o.status === 'cancelled';
  const act = async (path: string, ok: string) => {
    setBusy(true);
    try {
      await post(`/api/v1/orders/${o.id}/${path}`);
      toast.success(ok);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const unpaidTransfer = o.paymentMethod === 'transfer' && !o.paidAt;
  const due = Math.max(0, o.totalVnd - o.depositVnd);
  const cancellable = ['new', 'pending_review', 'confirmed', 'packing'].includes(o.status);
  const returnable = o.status === 'shipping' || o.status === 'done';
  const openReturn = o.returns.find((r) => r.status === 'requested' || r.status === 'approved');
  const activeShipment = o.shipments.find((s) => !['cancelled', 'returned'].includes(s.status));

  // One primary action for the current status (Design §10.1).
  let primary: React.ReactNode = null;
  if (CONFIRMABLE.has(o.status)) {
    primary = unpaidTransfer ? (
      can(me, 'online.confirm_payment') && (
        <Button variant="primary" icon={CheckCircle} onClick={() => setDialog('payment')}>
          Xác nhận chuyển khoản
        </Button>
      )
    ) : (
      <Button variant="primary" icon={CheckCircle} loading={busy} onClick={() => act('confirm', `Đã xác nhận đơn ${o.docNo}.`)}>
        Xác nhận đơn
      </Button>
    );
  } else if (!works) {
    primary = null;
  } else if (o.status === 'confirmed') {
    primary = (
      <Button variant="primary" icon={Package} loading={busy} onClick={() => act('pack', 'Đã chuyển sang đóng gói.')}>
        Đóng gói
      </Button>
    );
  } else if (o.status === 'packing' && o.delivery === 'ship') {
    primary = (
      <Button variant="primary" icon={Truck} onClick={() => setDialog('shipment')}>
        Tạo vận đơn
      </Button>
    );
  } else if (o.status === 'packing' && o.delivery === 'pickup') {
    primary = o.readyAt ? (
      <Button variant="primary" icon={PackageCheck} onClick={() => setDialog('handover')}>
        Giao cho khách
      </Button>
    ) : (
      <Button
        variant="primary"
        icon={PackageCheck}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await post<{ pickupCode: string }>(`/api/v1/orders/${o.id}/pickup-ready`);
            setDialog({ code: r.pickupCode });
            await refresh();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Báo sẵn sàng nhận
      </Button>
    );
  } else if (o.status === 'return_requested') {
    primary = (
      <Button variant="primary" icon={CheckCircle} loading={busy} onClick={() => act('return-approve', 'Đã duyệt yêu cầu trả hàng.')}>
        Duyệt trả hàng
      </Button>
    );
  } else if (o.status === 'return_approved') {
    primary = (
      <Button variant="primary" icon={PackageCheck} onClick={() => setDialog('receive')}>
        Nhận hàng trả
      </Button>
    );
  } else if (o.status === 'shipping' && activeShipment?.carrier === 'manual') {
    primary = (
      <Button variant="primary" icon={CheckCircle} loading={busy} onClick={() => act('delivered', `Đơn ${o.docNo} đã hoàn tất.`)}>
        Đã giao xong
      </Button>
    );
  }

  return (
    <>
      <PageHeader
        back={{ to: onOrders ? '/sales' : '/orders', label: onOrders ? 'Đơn hàng' : 'Giao hàng' }}
        title={o.docNo}
        actions={primary}
        menu={works && (cancellable || returnable || o.status === 'return_requested') && <Button variant="ghost" icon={MoreHorizontal} aria-label="Thao tác khác" onClick={() => setDialog('menu')} />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <OrderStatusChip status={o.status} reasons={o.reviewReasons} />
        <PaymentChip method={o.paymentMethod} paidAt={o.paidAt} status={o.status} />
        <span className="text-sm text-ink-500">{formatDateTime(o.createdAt)}</span>
      </div>
      {o.status === 'cancelled' && o.cancelReason && (
        <div className="mb-4">
          <InlineAlert tone="info">Đã hủy: {o.cancelReason}</InlineAlert>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {activeShipment && (
            <div className="flex flex-col gap-2">
              <CopyCode label={activeShipment.carrier === 'ghn' ? 'Mã vận đơn GHN' : 'Mã vận đơn'} value={activeShipment.trackingNo} />
              <p className="text-sm text-ink-500">
                {SHIPMENT_STATUS[activeShipment.status] ?? activeShipment.status}
                {activeShipment.codVnd > 0 && ` · Thu hộ ${formatVnd(activeShipment.codVnd)}`}
                {activeShipment.feeVnd > 0 && ` · Phí GHN ${formatVnd(activeShipment.feeVnd)}`}
              </p>
            </div>
          )}
          {openReturn && (
            <InlineAlert tone="warning">
              Trả hàng: {openReturn.reason} · {openReturn.lines.reduce((a, l) => a + l.qty, 0)} sản phẩm · phí gửi trả: {openReturn.returnShippingPaidBy === 'store' ? 'cửa hàng chịu' : 'khách chịu'}
            </InlineAlert>
          )}
          <Card title="Sản phẩm">
            <ul className="divide-y divide-paper-300 text-sm">
              {o.lines.map((l) => (
                <li key={l.id} className="py-2">
                  <p className="font-medium">{l.description}</p>
                  <p className="code text-[13px] text-ink-500">{l.sku}</p>
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
          </Card>
          <Card title={o.delivery === 'ship' ? 'Giao hàng' : 'Nhận tại cửa hàng'}>
            <Facts
              items={[
                ['Người nhận', o.recipient.name],
                ['Điện thoại', <a href={`tel:${o.recipient.phone}`} className="text-navy-700 underline">{formatPhone(o.recipient.phone)}</a>],
                ...(o.delivery === 'ship' && o.address
                  ? ([['Địa chỉ', [o.address.line, o.address.wardName, o.address.provinceName].filter(Boolean).join(', ') || '—']] as [string, React.ReactNode][])
                  : ([['Sẵn sàng', o.readyAt ? formatDateTime(o.readyAt) : 'Chưa']] as [string, React.ReactNode][])),
              ]}
            />
          </Card>
          <Card title="Lịch sử">
            <StatusTimeline events={o.events} reasonLabel={EVENT_REASON} />
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Tổng cộng">
            <Facts
              items={[
                ['Tạm tính', <span className="num">{formatVnd(o.subtotalVnd)}</span>],
                ['Giảm giá', <span className="num">{o.discountVnd ? `−${formatVnd(o.discountVnd)}` : '0 ₫'}</span>],
                ['Phí giao hàng', <span className="num">{formatVnd(o.shippingVnd)}</span>],
                ...(o.couponCode ? ([['Mã giảm giá', <span className="code">{o.couponCode}</span>]] as [string, React.ReactNode][]) : []),
                ['Tổng', <span className="text-lg font-bold num">{formatVnd(o.totalVnd)}</span>],
                ['Trong đó VAT', <span className="num">{formatVnd(o.vatVnd)}</span>],
                ...(o.depositVnd > 0
                  ? ([
                      ['Đã đặt cọc', <span className="num">−{formatVnd(o.depositVnd)}</span>],
                      ['Còn phải thu', <span className="font-semibold num">{formatVnd(due)}</span>],
                    ] as [string, React.ReactNode][])
                  : []),
              ]}
            />
          </Card>
          <Card title="Thanh toán">
            <div className="flex flex-col gap-3 text-sm">
              <Facts
                items={[
                  ['Phương thức', o.paymentMethod === 'cod' ? 'Thu hộ (COD)' : 'Chuyển khoản'],
                  ['Trạng thái', <PaymentChip method={o.paymentMethod} paidAt={o.paidAt} status={o.status} />],
                  ...(o.paidAt ? ([['Thời điểm', formatDateTime(o.paidAt)]] as [string, React.ReactNode][]) : []),
                ]}
              />
              {o.paymentRef && unpaidTransfer && o.status !== 'cancelled' && <CopyCode label="Nội dung chuyển khoản" value={o.paymentRef} />}
            </div>
          </Card>
          {o.customer && (
            <Card title="Khách hàng" action={<Link to={`/customers/${o.customer.id}`} className="text-sm text-navy-700 underline">Xem hồ sơ</Link>}>
              <p className="text-sm font-medium">{o.customer.name}</p>
              <p className="text-sm text-ink-500">
                {o.customer.tierName ?? ''} · {formatNumber(o.customer.pointsBalance)} điểm
              </p>
            </Card>
          )}
          <Card title="Nguồn đơn">
            <Facts
              items={[
                ['Kênh', o.channelName ?? ORDER_SOURCE[o.source] ?? o.source],
                ...(o.sourceRef ? ([['Liên kết', /^https?:\/\//.test(o.sourceRef) ? <a href={o.sourceRef} target="_blank" rel="noreferrer" className="break-all text-navy-700 underline">{o.sourceRef}</a> : o.sourceRef]] as [string, React.ReactNode][]) : []),
                ...(o.note ? ([['Ghi chú', o.note]] as [string, React.ReactNode][]) : []),
              ]}
            />
          </Card>
        </div>
      </div>

      {dialog === 'menu' && (
        <Dialog title="Thao tác" size="sm" onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-2">
            {returnable && (
              <Button variant="secondary" full icon={Undo2} onClick={() => setDialog('return')}>
                Yêu cầu trả hàng
              </Button>
            )}
            {o.status === 'return_requested' && (
              <Button variant="secondary" full icon={XCircle} onClick={() => setDialog('reject')}>
                Từ chối trả hàng
              </Button>
            )}
            {cancellable && (
              <Button variant="destructive-outline" full icon={XCircle} onClick={() => setDialog('cancel')}>
                Hủy đơn
              </Button>
            )}
          </div>
        </Dialog>
      )}
      {dialog === 'return' && <ReturnRequestDialog order={o} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'reject' && <RejectReturnDialog order={o} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'receive' && openReturn && <ReceiveReturnDialog order={o} ret={openReturn} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'cancel' && <CancelDialog order={o} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'payment' && <PaymentDialog order={o} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'shipment' && <ShipmentDialog order={o} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'handover' && <HandoverDialog order={o} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog !== null && typeof dialog === 'object' && (
        <Dialog
          title="Mã nhận hàng"
          size="sm"
          onClose={() => setDialog(null)}
          footer={
            <Button variant="primary" onClick={() => setDialog(null)}>
              Đã ghi lại
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-700">Báo mã này cho khách qua điện thoại hoặc Zalo. Mã chỉ hiện một lần; khách đọc mã khi đến nhận hàng.</p>
            <CopyCode label="Mã nhận hàng" value={dialog.code} />
          </div>
        </Dialog>
      )}
    </>
  );
}

function CancelDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      title={`Hủy đơn ${order.docNo}?`}
      body={`Hàng đang giữ sẽ được trả lại kho. Không thể hoàn tác.${order.paidAt ? ' Đơn đã thanh toán: hãy hoàn tiền cho khách ngoài hệ thống.' : ''}`}
      confirm="Hủy đơn"
      destructive
      onClose={onClose}
      onConfirm={async () => {
        if (!reason.trim()) throw new Error('Cần nhập lý do hủy đơn.');
        await post(`/api/v1/orders/${order.id}/cancel`, { reason: reason.trim() });
        toast.success(`Đã hủy đơn ${order.docNo}.`);
        await onDone();
      }}
    >
      <TextArea label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} />
    </ConfirmDialog>
  );
}

function PaymentDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState<number | null>(null);
  return (
    <ConfirmDialog
      title="Xác nhận chuyển khoản"
      body={`Kiểm tra tài khoản ngân hàng: nội dung có mã ${order.paymentRef ?? ''} và số tiền ${formatVnd(Math.max(0, order.totalVnd - order.depositVnd))}.`}
      confirm="Đã nhận tiền"
      onClose={onClose}
      onConfirm={async () => {
        if (amount === null) throw new Error('Nhập số tiền đã nhận.');
        await post(`/api/v1/orders/${order.id}/confirm-payment`, { amountVnd: amount });
        toast.success('Đã xác nhận chuyển khoản.');
        await onDone();
      }}
    >
      <MoneyInput label="Số tiền đã nhận" value={amount} onChange={setAmount} autoFocus />
    </ConfirmDialog>
  );
}

/** GHN shipment, or a tracking number typed by hand when GHN is unavailable (FR-ORD-10). */
function ShipmentDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => Promise<void> }) {
  const [mode, setMode] = useState<'ghn' | 'manual'>('ghn');
  const [trackingNo, setTrackingNo] = useState('');
  const cod = order.paymentMethod === 'cod' ? Math.max(0, order.totalVnd - order.depositVnd) : 0;
  return (
    <ConfirmDialog
      title="Tạo vận đơn"
      body={`Hàng sẽ được trừ khỏi kho và đơn chuyển sang Đang giao. Thu hộ: ${formatVnd(cod)}.`}
      confirm={mode === 'ghn' ? 'Tạo vận đơn GHN' : 'Giao cho vận chuyển'}
      onClose={onClose}
      onConfirm={async () => {
        await post(`/api/v1/orders/${order.id}/shipment`, mode === 'ghn' ? { carrier: 'ghn' } : { carrier: 'manual', trackingNo: trackingNo.trim() });
        toast.success(mode === 'ghn' ? 'Đã tạo vận đơn GHN.' : 'Đã ghi vận đơn.');
        await onDone();
      }}
    >
      <div className="flex flex-col gap-2 text-sm" role="radiogroup" aria-label="Cách tạo vận đơn">
        <label className="inline-flex items-center gap-2">
          <input type="radio" className="size-4 accent-navy-700" checked={mode === 'ghn'} onChange={() => setMode('ghn')} /> Tạo trên GHN tự động
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="radio" className="size-4 accent-navy-700" checked={mode === 'manual'} onChange={() => setMode('manual')} /> Nhập mã vận đơn đã có
        </label>
      </div>
      {mode === 'manual' && <Field label="Mã vận đơn" required className="code" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value.toUpperCase())} autoFocus />}
    </ConfirmDialog>
  );
}

function ReturnRequestDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [paidBy, setPaidBy] = useState<'store' | 'customer'>('store');
  const [qty, setQty] = useState<Record<string, number>>(Object.fromEntries(order.lines.map((l) => [l.id, l.qty])));
  return (
    <ConfirmDialog
      title={`Trả hàng đơn ${order.docNo}`}
      confirm="Gửi yêu cầu"
      size="md"
      onClose={onClose}
      onConfirm={async () => {
        const lines = order.lines.filter((l) => (qty[l.id] ?? 0) > 0).map((l) => ({ orderLineId: l.id, qty: qty[l.id]! }));
        if (!lines.length) throw new Error('Chọn ít nhất một sản phẩm trả lại.');
        await post(`/api/v1/orders/${order.id}/return-request`, { reason: reason.trim(), lines, returnShippingPaidBy: paidBy });
        toast.success('Đã ghi yêu cầu trả hàng.');
        await onDone();
      }}
    >
      <ul className="divide-y divide-paper-300 text-sm">
        {order.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 flex-1">{l.description}</span>
            <input
              aria-label={`Số lượng trả ${l.description}`}
              inputMode="numeric"
              className="h-10 w-16 rounded-md border border-paper-500 text-center num"
              value={qty[l.id] ?? 0}
              onChange={(e) => setQty({ ...qty, [l.id]: Math.min(l.qty, Number(e.target.value.replace(/\D/g, '')) || 0) })}
            />
            <span className="w-10 text-ink-500 num">/ {l.qty}</span>
          </li>
        ))}
      </ul>
      <TextArea label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} />
      <SelectField label="Phí gửi trả" value={paidBy} onChange={(e) => setPaidBy(e.target.value as 'store' | 'customer')}>
        <option value="store">Cửa hàng chịu</option>
        <option value="customer">Khách chịu</option>
      </SelectField>
    </ConfirmDialog>
  );
}

function RejectReturnDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      title="Từ chối trả hàng?"
      body="Đơn sẽ trở lại trạng thái Hoàn tất."
      confirm="Từ chối"
      onClose={onClose}
      onConfirm={async () => {
        await post(`/api/v1/orders/${order.id}/return-reject`, { reason: reason.trim() });
        toast.success('Đã từ chối yêu cầu trả hàng.');
        await onDone();
      }}
    >
      <TextArea label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} />
    </ConfirmDialog>
  );
}

/** Goods back: inspect each line (back to stock or damaged, BR-04) and record the refund paid outside. */
function ReceiveReturnDialog({ order, ret, onClose, onDone }: { order: Order; ret: Order['returns'][number]; onClose: () => void; onDone: () => Promise<void> }) {
  const paid = order.paidAt ? order.totalVnd : order.depositVnd;
  const suggested = Math.min(
    paid,
    ret.lines.reduce((a, rl) => {
      const l = order.lines.find((x) => x.id === rl.orderLineId);
      return a + (l ? Math.round((l.totalVnd * rl.qty) / l.qty) : 0);
    }, 0),
  );
  const [restock, setRestock] = useState<Record<string, boolean>>(Object.fromEntries(ret.lines.map((l) => [l.orderLineId, true])));
  const [refund, setRefund] = useState<number | null>(suggested);
  const [ref, setRef] = useState('');
  return (
    <ConfirmDialog
      title="Nhận hàng trả"
      body={paid ? `Khách đã trả ${formatVnd(paid)}. Hoàn tiền cho khách ngoài hệ thống rồi ghi lại tại đây.` : 'Đơn chưa thu tiền nên không cần hoàn tiền.'}
      confirm="Xác nhận đã nhận"
      size="md"
      onClose={onClose}
      onConfirm={async () => {
        await post(`/api/v1/orders/${order.id}/return-receive`, {
          lines: ret.lines.map((l) => ({ orderLineId: l.orderLineId, restock: restock[l.orderLineId] ?? true })),
          refundVnd: refund ?? 0,
          refundRef: ref.trim() || null,
        });
        toast.success('Đã nhận hàng trả.');
        await onDone();
      }}
    >
      <ul className="divide-y divide-paper-300 text-sm">
        {ret.lines.map((rl) => {
          const l = order.lines.find((x) => x.id === rl.orderLineId);
          return (
            <li key={rl.orderLineId} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="min-w-0 flex-1">
                {l?.description} × {rl.qty}
              </span>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="size-5 accent-navy-700" checked={restock[rl.orderLineId] ?? true} onChange={(e) => setRestock({ ...restock, [rl.orderLineId]: e.target.checked })} />
                Nhập lại kho
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] text-ink-500">Bỏ chọn “Nhập lại kho” khi hàng hỏng: hàng không về kho.</p>
      {paid > 0 && (
        <>
          <MoneyInput label="Số tiền đã hoàn" value={refund} onChange={setRefund} />
          <Field label="Mã giao dịch hoàn tiền" value={ref} onChange={(e) => setRef(e.target.value)} />
        </>
      )}
    </ConfirmDialog>
  );
}

function HandoverDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => Promise<void> }) {
  const [code, setCode] = useState('');
  return (
    <ConfirmDialog
      title="Giao hàng cho khách"
      body={order.paymentMethod === 'cod' && !order.paidAt ? `Thu ${formatVnd(Math.max(0, order.totalVnd - order.depositVnd))} của khách, rồi nhập mã nhận hàng khách đọc.` : 'Nhập mã nhận hàng khách đọc.'}
      confirm="Giao hàng"
      onClose={onClose}
      onConfirm={async () => {
        await post(`/api/v1/orders/${order.id}/handover`, { code: code.trim() });
        toast.success(`Đơn ${order.docNo} đã hoàn tất.`);
        await onDone();
      }}
    >
      <Field label="Mã nhận hàng" required inputMode="numeric" maxLength={6} className="code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
    </ConfirmDialog>
  );
}
