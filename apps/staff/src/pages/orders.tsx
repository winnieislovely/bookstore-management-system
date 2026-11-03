import { ORDER_SOURCES } from '@bookstore/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Calculator, CheckCircle, HandCoins, MoreHorizontal, Package, PackageCheck, Plus, RadioTower, RefreshCw, Store, Trash2, Truck, Undo2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog, DataTable, Facts, FilterMenu, Pager, SearchBox, SelectField, SelectionBar, TextArea, TimeFilter, timeLabel, timeRange, toast, useDebounced, useListParam, useParam, type Column } from '../components/data';
import { Combobox, CopyCode, ORDER_SOURCE, ORDER_STATUS, OrderStatusChip, PaymentChip, REVIEW_REASON, StatusTimeline, type TimelineEntry } from '../components/order-ui';
import { ProductSearch, hitTitle, type ProductHit } from '../components/product-search';
import { Button, Card, ErrorState, Field, InlineAlert, PageHeader, Skeleton } from '../components/ui';
import { ApiError, api, get, post } from '../lib/api';
import { formatDateTime, formatNumber, formatPhone, formatRelative, formatVnd } from '../lib/format';
import { can, useMe } from '../lib/session';
import { Dialog, MoneyInput } from '../pos/widgets';

/** Orders & delivery – “Giao hàng” (FR-ORD-01..13, FR-SOC-03, Design §12.9, §12.3, §12.4). */

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

const STATUS_KEYS = Object.keys(ORDER_STATUS);
const CONFIRMABLE = new Set(['new', 'pending_review']);

export function OrdersPage() {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const [q, setQ] = useParam('q');
  const [status, setStatus] = useListParam('status');
  const [source, setSource] = useListParam('source');
  const [time, setTime] = useParam('time');
  const [page, setPage] = useParam('page', '1');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const qc = useQueryClient();
  const query = { q: q || undefined, status: status.join(',') || undefined, source: source.join(',') || undefined, ...timeRange(time), page: Number(page), limit: 40 };
  // The list refreshes itself while open (20-second polling, TDD §4.5 fallback; FR-ORD-03).
  const list = useQuery({
    queryKey: ['orders', query],
    queryFn: () => get<{ items: OrderRow[]; total: number; counts: Record<string, number> }>('/api/v1/orders', query),
    refetchInterval: 20_000,
  });
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const rows = list.data?.items;
  const picked = (rows ?? []).filter((r) => selected.has(r.id));
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
    { header: 'Thời gian', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.createdAt) },
  ];
  const counts = list.data?.counts ?? {};

  const bulkConfirm = async () => {
    setBulkBusy(true);
    try {
      const r = await post<{ confirmed: number; results: { id: string; ok: boolean; message?: string }[] }>('/api/v1/orders/bulk-confirm', { ids: picked.map((p) => p.id) });
      const failed = r.results.filter((x) => !x.ok);
      if (r.confirmed) toast.success(`Đã xác nhận ${r.confirmed} đơn.`);
      for (const f of failed.slice(0, 3)) toast.error(f.message ?? 'Không xác nhận được.');
      setSelected(new Set(failed.map((f) => f.id)));
      await qc.invalidateQueries({ queryKey: ['orders'] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Giao hàng"
        subtitle={
          list.dataUpdatedAt ? (
            <span className="inline-flex items-center gap-1">
              <RefreshCw size={14} aria-hidden /> Cập nhật {formatRelative(new Date(list.dataUpdatedAt))}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button variant="secondary" icon={HandCoins} onClick={() => navigate('/orders/cod')}>
              Đối soát COD
            </Button>
            <Button variant="secondary" icon={RadioTower} onClick={() => navigate('/orders/channels')}>
              Kênh bán
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => navigate('/orders/new')}>
              Tạo đơn
            </Button>
          </>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm mã đơn, người nhận, SĐT, mã vận đơn…" />
        <FilterMenu
          groups={[
            { label: 'Trạng thái', options: STATUS_KEYS.map((k) => ({ key: k, label: ORDER_STATUS[k]!.label, count: counts[k] ?? 0 })), values: status, onChange: setStatus },
            { label: 'Kênh', options: ORDER_SOURCES.map((k) => ({ key: k, label: ORDER_SOURCE[k]! })), values: source, onChange: setSource },
            { kind: 'custom', label: 'Thời gian', summary: timeLabel(time), active: !!time, onClear: () => setTime(''), content: <TimeFilter value={time} onChange={setTime} /> },
          ]}
        />
      </div>
      {picked.length > 0 && (
        <SelectionBar
          items={picked.map((p) => ({ key: p.id, label: p.recipient.name, code: p.docNo }))}
          onRemove={(k) => setSelected(new Set([...selected].filter((x) => x !== k)))}
          onClear={() => setSelected(new Set())}
          actions={
            <Button size="sm" variant="primary" icon={CheckCircle} loading={bulkBusy} disabled={!picked.some((p) => CONFIRMABLE.has(p.status))} onClick={bulkConfirm}>
              Xác nhận đơn
            </Button>
          }
        />
      )}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRow={(r) => navigate(`/orders/${r.id}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        minWidth={980}
        {...(can(me, 'online.manage') && { selection: { selected, onChange: setSelected } })}
        empty={{ icon: Truck, title: q || status.length || source.length || time ? 'Không có đơn phù hợp' : 'Chưa có đơn online nào', help: 'Đơn từ website, mạng xã hội và điện thoại sẽ hiện ở đây.' }}
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
  discountOn: boolean;
  discountVnd: number | null;
}
interface Quote {
  subtotalVnd: number;
  discountVnd: number;
  shippingVnd: number;
  shippingDiscountVnd: number;
  totalVnd: number;
  pointsToEarn: number;
  approvalsRequired: unknown[];
  issues: { code: string }[];
}
interface Channel {
  id: string;
  name: string;
  kind: string;
  active: boolean;
}
interface CustomerHit {
  id: string;
  name: string;
  phoneE164: string | null;
  tierName?: string | null;
  pointsBalance: number;
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
  const [f, setF] = useState({
    source: 'facebook',
    channelId: '',
    phone: '',
    name: '',
    delivery: 'ship' as 'ship' | 'pickup',
    provinceId: null as number | null,
    wardCode: '',
    line: '',
    paymentMethod: 'cod' as 'cod' | 'transfer',
    shippingVnd: 0 as number | null,
    couponCode: '',
    note: '',
  });
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channels = useQuery({ queryKey: ['channels', 'active'], queryFn: () => get<{ items: Channel[] }>('/api/v1/channels', { active: 'true' }) });
  const provinces = useProvinces();
  const wards = useWards(f.provinceId);
  const kindChannels = (channels.data?.items ?? []).filter((c) => c.kind === f.source);

  // Find the customer by phone (FR-SOC-03, Design §10.3 “Phone”).
  const phoneDigits = useDebounced(f.phone.replace(/\D/g, ''), 400);
  const match = useQuery({
    queryKey: ['customer-by-phone', phoneDigits],
    enabled: phoneDigits.length >= 9,
    queryFn: async () => (await get<{ items: CustomerHit[] }>('/api/v1/customers', { q: phoneDigits, limit: 5 })).items.find((c) => c.phoneE164?.endsWith(phoneDigits.slice(-9))) ?? null,
  });
  useEffect(() => {
    if (match.data && !f.name) setF((x) => ({ ...x, name: match.data!.name }));
  }, [match.data, f.name]);

  const body = useMemo(
    () => ({
      source: f.source,
      ...(match.data && { customerId: match.data.id }),
      lines: lines.map((l) => ({ variantId: l.hit.variantId, qty: l.qty, ...(l.discountVnd ? { manualDiscount: { kind: 'amount', vnd: l.discountVnd * l.qty } } : {}) })),
      shippingVnd: f.delivery === 'ship' ? (f.shippingVnd ?? 0) : 0,
      couponCode: f.couponCode.trim() || null,
    }),
    [f.source, f.delivery, f.shippingVnd, f.couponCode, lines, match.data],
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
      if (i < 0) return [...ls, { hit: h, qty: 1, discountOn: false, discountVnd: null }];
      return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
    });

  const save = async () => {
    setError(null);
    if (!lines.length) return setError('Đơn chưa có sản phẩm.');
    if (!f.phone.trim() || !f.name.trim()) return setError('Cần nhập số điện thoại và tên người nhận.');
    setBusy(true);
    try {
      const r = await api<{ id: string; docNo: string }>('POST', '/api/v1/orders', {
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: {
          ...body,
          channelId: f.channelId || null,
          recipient: { name: f.name.trim(), phone: f.phone.trim() },
          delivery: f.delivery,
          address: f.delivery === 'ship' ? { ...(f.provinceId !== null && { provinceId: f.provinceId }), ...(f.wardCode && { wardCode: f.wardCode }), line: f.line.trim() } : null,
          paymentMethod: f.paymentMethod,
          note: f.note.trim() || null,
        },
      });
      toast.success(`Đã tạo đơn ${r.docNo}.`);
      void qc.invalidateQueries({ queryKey: ['orders'] });
      navigate(`/orders/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'approval_required' ? 'Giảm giá vượt hạn mức của bạn. Hãy giảm bớt hoặc nhờ quản lý tạo đơn.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const q = quote.data;
  return (
    <div className="pb-20">
      <PageHeader
        breadcrumb={
          <Link to="/orders" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Giao hàng
          </Link>
        }
        title="Tạo đơn"
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Products first (Design §12.4); each line: name, price, stock on their own lines, discount behind a toggle. */}
          <Card title="Sản phẩm">
            <ProductSearch onPick={add} placeholder="Nhập SKU / tên sản phẩm" scanIcon={false} />
            {lines.length > 0 && (
              <ul className="mt-4 divide-y divide-paper-300">
                {lines.map((l, i) => {
                  const update = (patch: Partial<Line>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <li key={l.hit.variantId} className="flex flex-col gap-3 py-3 text-sm">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{hitTitle(l.hit)}</p>
                          <p className="text-ink-700 num">{formatVnd(l.hit.priceVnd)}</p>
                          <p className="text-[13px] text-ink-500">Tồn: {formatNumber(l.hit.available)}</p>
                        </div>
                        <input
                          aria-label={`Số lượng ${hitTitle(l.hit)}`}
                          inputMode="numeric"
                          className="h-10 w-16 rounded-md border border-paper-500 text-center num"
                          value={l.qty}
                          onChange={(e) => update({ qty: Math.max(1, Number(e.target.value.replace(/D/g, '')) || 1) })}
                        />
                        <Button variant="ghost" icon={Trash2} aria-label={`Xóa ${hitTitle(l.hit)}`} onClick={() => setLines(lines.filter((_, j) => j !== i))} />
                      </div>
                      <label className="inline-flex w-fit cursor-pointer items-center gap-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={l.discountOn}
                          onClick={() => update({ discountOn: !l.discountOn, discountVnd: l.discountOn ? null : l.discountVnd })}
                          className={clsx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors', l.discountOn ? 'bg-navy-700' : 'bg-ink-300')}
                        >
                          <span className={clsx('inline-block size-4 rounded-full bg-white shadow-sm transition-transform', l.discountOn ? 'translate-x-[18px]' : 'translate-x-0.5')} />
                        </button>
                        Giảm giá
                      </label>
                      {l.discountOn && (
                        <div className="max-w-60">
                          <MoneyInput label="Giảm mỗi sản phẩm" value={l.discountVnd} onChange={(v) => update({ discountVnd: v })} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Nguồn đơn">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              ) : (
                <div className="max-sm:hidden" />
              )}
            </div>
          </Card>

          <Card title="Khách hàng">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Số điện thoại" required inputMode="tel" value={f.phone} onChange={set('phone')} />
              <Field label="Tên người nhận" required value={f.name} onChange={set('name')} />
            </div>
            {match.data && (
              <p className="mt-3 text-sm text-ink-700">
                Đã có khách hàng: <span className="font-semibold">{match.data.name}</span>
                {match.data.tierName && ` · ${match.data.tierName}`} · {formatNumber(match.data.pointsBalance)} điểm
              </p>
            )}
            {!match.data && phoneDigits.length >= 9 && match.isFetched && <p className="mt-3 text-sm text-ink-500">Khách mới – hồ sơ được tạo khi lưu đơn.</p>}
          </Card>

          <Card title="Giao hàng">
            <div className="mb-4 flex gap-2" role="radiogroup" aria-label="Hình thức nhận hàng">
              {(
                [
                  ['ship', 'Giao tận nơi', Truck],
                  ['pickup', 'Nhận tại cửa hàng', Store],
                ] as const
              ).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.delivery === k}
                  onClick={() => setF({ ...f, delivery: k })}
                  className={clsx('inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm', f.delivery === k ? 'border-navy-700 bg-navy-50 font-semibold text-navy-700' : 'border-paper-500')}
                >
                  <Icon size={18} aria-hidden /> {label}
                </button>
              ))}
            </div>
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
            {f.delivery === 'pickup' && <p className="text-sm text-ink-700">Khách nhận tại cửa hàng bằng mã nhận hàng khi đơn đã sẵn sàng.</p>}
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
                  <p className="text-[13px] text-ink-500" aria-live="polite">
                    {feeManual
                      ? 'Phí nhập tay.'
                      : !feeKey
                        ? 'Tự tính theo GHN khi đã chọn phường/xã và sản phẩm.'
                        : fee.isFetching
                          ? 'Đang tính phí GHN…'
                          : fee.isError
                            ? (fee.error as Error).message
                            : 'Phí GHN, tự cập nhật khi đổi địa chỉ hoặc sản phẩm.'}
                  </p>
                  {feeManual && feeKey && (
                    <Button variant="tonal" size="sm" icon={Calculator} onClick={() => setFeeManual(false)}>
                      Tính lại theo GHN
                    </Button>
                  )}
                </div>
              )}
              <Field label="Mã giảm giá" value={f.couponCode} onChange={set('couponCode')} className="code" />
              <TextArea label="Ghi chú nội bộ" value={f.note} onChange={set('note')} />
            </div>
          </Card>
          <Card title="Tổng cộng">
            {q ? (
              <Facts
                items={[
                  ['Tạm tính', <span className="num">{formatVnd(q.subtotalVnd)}</span>],
                  ['Giảm giá', <span className="num">{q.discountVnd ? `−${formatVnd(q.discountVnd)}` : '0 ₫'}</span>],
                  ['Phí giao hàng', <span className="num">{formatVnd(q.shippingVnd - q.shippingDiscountVnd)}</span>],
                  ['Tổng', <span className="text-lg font-bold num">{formatVnd(q.totalVnd)}</span>],
                ]}
              />
            ) : (
              <p className="text-sm text-ink-500">{lines.length ? 'Đang tính…' : 'Thêm sản phẩm để tính tiền.'}</p>
            )}
            {q?.issues.some((i) => i.code.startsWith('coupon')) && (
              <div className="mt-3">
                <InlineAlert tone="warning">Mã giảm giá không dùng được cho đơn này.</InlineAlert>
              </div>
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
        <Button variant="primary" icon={Plus} loading={busy} onClick={save}>
          Tạo đơn
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
  };
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
        breadcrumb={
          <Link to="/orders" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Giao hàng
          </Link>
        }
        title={o.docNo}
        actions={primary}
        menu={(cancellable || returnable || o.status === 'return_requested') && <Button variant="ghost" icon={MoreHorizontal} aria-label="Thao tác khác" onClick={() => setDialog('menu')} />}
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
