import { useQuery } from '@tanstack/react-query';
import { foldText } from '@bookstore/domain';
import { BadgePercent, Pause, Play, Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import { DataTable, FilterMenu, SearchBox, SelectField, TimeFilter, timeLabel, timeRange, toast, useListParam, useParam, type Column } from '../components/data';
import { Button, Field, InlineAlert, PageHeader, StatusChip, type Tone } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { formatDateTime, formatNumber, formatVnd } from '../lib/format';
import { Dialog } from '../pos/widgets';

/** Promotions (FR-PRM-01..06, Design §11.2 Promotion). Each save is a new version. */

type RuleType = 'percent' | 'fixed' | 'buy_x_get_y' | 'bundle_price' | 'gift';
type ScopeKind = 'order' | 'product' | 'category' | 'publisher' | 'brand' | 'tier';

interface Rule {
  type: RuleType | 'free_shipping';
  percentBp?: number;
  amountVnd?: number;
  buyQty?: number;
  getQty?: number;
  getDiscountBp?: number;
  bundleQty?: number;
  bundlePriceVnd?: number;
  giftVariantId?: string;
  giftQty?: number;
  scope: { kind: ScopeKind | 'event_ticket'; variantIds?: string[]; categoryIds?: string[]; publisherIds?: string[]; brandIds?: string[]; tierCodes?: string[] };
  conditions: { minOrderVnd?: number; channels?: string[]; couponCode?: string; perCustomerLimit?: number; totalLimit?: number };
  priority: number;
  stackable: boolean;
}

interface Promotion {
  id: string;
  name: string;
  state: 'scheduled' | 'running' | 'paused' | 'expired';
  rule: Rule;
  startsAt: string;
  endsAt: string | null;
  version: number;
}

const STATE: Record<Promotion['state'], { tone: Tone; label: string }> = {
  scheduled: { tone: 'info', label: 'Đã lên lịch' },
  running: { tone: 'success', label: 'Đang chạy' },
  paused: { tone: 'warning', label: 'Tạm dừng' },
  expired: { tone: 'neutral', label: 'Hết hạn' },
};

const TYPE_LABEL: Record<string, string> = {
  percent: 'Giảm theo %',
  fixed: 'Giảm số tiền',
  buy_x_get_y: 'Mua X tặng Y',
  bundle_price: 'Đồng giá combo',
  gift: 'Tặng quà',
  free_shipping: 'Miễn phí giao hàng',
};
const SCOPE_LABEL: Record<string, string> = { order: 'Cả đơn', product: 'Sản phẩm', category: 'Danh mục', publisher: 'Nhà xuất bản', brand: 'Thương hiệu', tier: 'Hạng thành viên', event_ticket: 'Vé sự kiện' };
const TIERS = [
  { code: 'standard', name: 'Thường' },
  { code: 'silver', name: 'Bạc' },
  { code: 'gold', name: 'Vàng' },
];

function summary(r: Rule): string {
  switch (r.type) {
    case 'percent':
      return `Giảm ${(r.percentBp ?? 0) / 100}%`;
    case 'fixed':
      return `Giảm ${formatVnd(r.amountVnd ?? 0)}`;
    case 'buy_x_get_y':
      return `Mua ${r.buyQty} tặng ${r.getQty}${r.getDiscountBp && r.getDiscountBp < 10000 ? ` (giảm ${r.getDiscountBp / 100}%)` : ''}`;
    case 'bundle_price':
      return `${r.bundleQty} sản phẩm giá ${formatVnd(r.bundlePriceVnd ?? 0)}`;
    case 'gift':
      return `Tặng ${r.giftQty ?? 1} quà`;
    default:
      return TYPE_LABEL[r.type] ?? r.type;
  }
}

/** Run period [startsAt, endsAt or open] overlaps the filter range. */
const overlaps = (p: Promotion, from?: string, to?: string) => (!to || new Date(p.startsAt) <= new Date(to)) && (!from || !p.endsAt || new Date(p.endsAt) >= new Date(from));

export function PromotionsPage() {
  const list = useQuery({ queryKey: ['promotions'], queryFn: () => get<{ items: Promotion[] }>('/api/v1/promotions') });
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [q, setQ] = useParam('q');
  const [time, setTime] = useParam('time');
  const [states, setStates] = useListParam('state');
  // The list is small and unpaged, so search and filters run here (Design §12.1).
  const term = foldText(q).trim();
  const range = timeRange(time);
  const rows = list.data?.items.filter(
    (p) => (!term || foldText(`${p.name} ${p.rule.conditions.couponCode ?? ''}`).includes(term)) && (!states.length || states.includes(p.state)) && overlaps(p, range.from, range.to),
  );
  const filtered = !!(term || time || states.length);
  const columns: Column<Promotion>[] = [
    { header: 'Mã', className: 'whitespace-nowrap', cell: (p) => (p.rule.conditions.couponCode ? <span className="code">{p.rule.conditions.couponCode}</span> : <span className="text-ink-500">—</span>) },
    { header: 'Chương trình', cell: (p) => <span className="font-medium">{p.name}</span> },
    { header: 'Ưu đãi', cell: (p) => summary(p.rule) },
    { header: 'Áp dụng', cell: (p) => SCOPE_LABEL[p.rule.scope.kind] },
    { header: 'Thời gian', className: 'whitespace-nowrap', cell: (p) => <span className="text-[13px]">{formatDateTime(p.startsAt)}<br />{p.endsAt ? `→ ${formatDateTime(p.endsAt)}` : 'Không hết hạn'}</span> },
    { header: 'Trạng thái', cell: (p) => <StatusChip tone={STATE[p.state].tone}>{STATE[p.state].label}</StatusChip> },
  ];
  return (
    <>
      <PageHeader
        title="Khuyến mãi"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            Tạo khuyến mãi
          </Button>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm theo tên hoặc mã chương trình…" />
        <FilterMenu
          groups={[
            { kind: 'custom', label: 'Thời gian', summary: timeLabel(time), active: !!time, onClear: () => setTime(''), content: <TimeFilter value={time} onChange={setTime} /> },
            { label: 'Trạng thái', options: (Object.keys(STATE) as Promotion['state'][]).map((k) => ({ key: k, label: STATE[k].label })), values: states, onChange: setStates },
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(p) => p.id}
        onRow={(p) => setEditing(p)}
        error={list.error}
        onRetry={() => list.refetch()}
        minWidth={760}
        empty={
          filtered
            ? { icon: BadgePercent, title: 'Không có chương trình phù hợp', help: 'Thử bỏ bớt bộ lọc hoặc đổi từ khóa.' }
            : { icon: BadgePercent, title: 'Chưa có chương trình khuyến mãi', help: 'Tạo chương trình giảm giá, mua X tặng Y, đồng giá hoặc mã giảm giá.' }
        }
      />
      {editing && <PromotionForm promotion={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => list.refetch()} />}
    </>
  );
}

const toLocal = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(/\D/g, '')));
const nameOf = (i18n: { vi?: { name?: string }; en?: { name?: string } }) => i18n.vi?.name || i18n.en?.name || '';

interface Option {
  id: string;
  label: string;
}

function useScopeOptions(kind: ScopeKind) {
  return useQuery({
    queryKey: ['scope-options', kind],
    enabled: ['category', 'publisher', 'brand'].includes(kind),
    queryFn: async (): Promise<Option[]> => {
      const path = { category: 'categories', publisher: 'publishers', brand: 'brands' }[kind as 'category'];
      const r = await get<{ items: { id: string; i18n: { vi?: { name?: string }; en?: { name?: string } } }[] }>(`/api/v1/catalog/${path}`);
      return r.items.map((x) => ({ id: x.id, label: nameOf(x.i18n) }));
    },
  });
}

/** Product picker: search the catalogue, keep chosen variants as chips. */
function ProductPicker({ value, labels, onChange, single }: { value: string[]; labels: Record<string, string>; onChange: (ids: string[], labels: Record<string, string>) => void; single?: boolean }) {
  const [q, setQ] = useState('');
  const found = useQuery({
    queryKey: ['promo-products', q],
    enabled: q.trim().length >= 2,
    queryFn: () => get<{ items: { variantId: string; title: string; titleVi: string | null; sku: string }[] }>('/api/v1/catalog/items', { q, limit: 10 }),
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {value.map((id) => (
          <span key={id} className="inline-flex h-8 items-center gap-1 rounded-full bg-navy-100 pr-1 pl-3 text-sm text-navy-700">
            {labels[id] ?? id.slice(0, 8)}
            <button type="button" className="inline-flex size-6 items-center justify-center rounded-full hover:bg-white" aria-label="Bỏ" onClick={() => onChange(value.filter((x) => x !== id), labels)}>
              <X size={14} aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <Field label={single ? 'Sản phẩm quà tặng' : 'Thêm sản phẩm'} leadingIcon={Search} placeholder="Tìm tên hoặc SKU" value={q} onChange={(e) => setQ(e.target.value)} />
      {found.data && q.trim().length >= 2 && (
        <ul className="max-h-48 divide-y divide-paper-300 overflow-y-auto rounded-md border border-paper-300">
          {found.data.items.map((r) => (
            <li key={r.variantId}>
              <button
                type="button"
                className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-navy-50"
                onClick={() => {
                  const label = `${r.titleVi || r.title} · ${r.sku}`;
                  onChange(single ? [r.variantId] : [...new Set([...value, r.variantId])], { ...labels, [r.variantId]: label });
                  setQ('');
                }}
              >
                <span>{r.titleVi || r.title}</span>
                <span className="code text-ink-500">{r.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Status and pause/resume, inside the editor rather than on list rows (Design §12.1, FR-PRM-04). */
function StatusRow({ promotion, onChanged }: { promotion: Promotion; onChanged: () => void }) {
  const [state, setState] = useState(promotion.state);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await post(`/api/v1/promotions/${promotion.id}/${state === 'paused' ? 'resume' : 'pause'}`);
      toast.success(state === 'paused' ? `Đã chạy lại “${promotion.name}”.` : `Đã tạm dừng “${promotion.name}”.`);
      // Resumed: scheduled until it starts (expired programs never show the button).
      setState(state === 'paused' ? (new Date(promotion.startsAt) > new Date() ? 'scheduled' : 'running') : 'paused');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-paper-300 bg-paper-200 px-4 py-3">
      <span className="inline-flex items-center gap-2 text-sm text-ink-700">
        Trạng thái <StatusChip tone={STATE[state].tone}>{STATE[state].label}</StatusChip>
      </span>
      {state !== 'expired' && (
        <Button size="sm" variant="secondary" icon={state === 'paused' ? Play : Pause} loading={busy} onClick={toggle}>
          {state === 'paused' ? 'Chạy lại' : 'Tạm dừng'}
        </Button>
      )}
    </div>
  );
}

function PromotionForm({ promotion, onClose, onSaved }: { promotion: Promotion | null; onClose: () => void; onSaved: () => void }) {
  const r = promotion?.rule;
  const [name, setName] = useState(promotion?.name ?? '');
  const [type, setType] = useState<RuleType>((r?.type as RuleType) ?? 'percent');
  const [percent, setPercent] = useState(r?.percentBp ? String(r.percentBp / 100) : '10');
  const [amount, setAmount] = useState(String(r?.amountVnd ?? ''));
  const [buyQty, setBuyQty] = useState(String(r?.buyQty ?? 2));
  const [getQty, setGetQty] = useState(String(r?.getQty ?? 1));
  const [getPct, setGetPct] = useState(String((r?.getDiscountBp ?? 10000) / 100));
  const [bundleQty, setBundleQty] = useState(String(r?.bundleQty ?? 3));
  const [bundlePrice, setBundlePrice] = useState(String(r?.bundlePriceVnd ?? ''));
  const [gift, setGift] = useState<string[]>(r?.giftVariantId ? [r.giftVariantId] : []);
  const [giftQty, setGiftQty] = useState(String(r?.giftQty ?? 1));
  const [scope, setScope] = useState<ScopeKind>((r?.scope.kind as ScopeKind) ?? 'order');
  const [ids, setIds] = useState<string[]>(r?.scope.variantIds ?? r?.scope.categoryIds ?? r?.scope.publisherIds ?? r?.scope.brandIds ?? r?.scope.tierCodes ?? []);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [minOrder, setMinOrder] = useState(String(r?.conditions.minOrderVnd ?? ''));
  const [coupon, setCoupon] = useState(r?.conditions.couponCode ?? '');
  const [perCustomer, setPerCustomer] = useState(String(r?.conditions.perCustomerLimit ?? ''));
  const [total, setTotal] = useState(String(r?.conditions.totalLimit ?? ''));
  const [channels, setChannels] = useState<string[]>(r?.conditions.channels ?? []);
  const [priority, setPriority] = useState(String(r?.priority ?? 0));
  const [stackable, setStackable] = useState(r?.stackable ?? false);
  const [startsAt, setStartsAt] = useState(toLocal(promotion?.startsAt ?? new Date().toISOString()));
  const [endsAt, setEndsAt] = useState(toLocal(promotion?.endsAt));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = useScopeOptions(scope);

  const build = (): Rule => {
    const scopeObj: Rule['scope'] =
      scope === 'order'
        ? { kind: 'order' }
        : { kind: scope, [{ product: 'variantIds', category: 'categoryIds', publisher: 'publisherIds', brand: 'brandIds', tier: 'tierCodes' }[scope]]: ids };
    const conditions: Rule['conditions'] = {
      ...(num(minOrder) !== undefined && { minOrderVnd: num(minOrder)! }),
      ...(coupon.trim() && { couponCode: coupon.trim().toUpperCase() }),
      ...(num(perCustomer) && { perCustomerLimit: num(perCustomer)! }),
      ...(num(total) && { totalLimit: num(total)! }),
      ...(channels.length && { channels }),
    };
    const base = { scope: scopeObj, conditions, priority: Number(priority) || 0, stackable };
    switch (type) {
      case 'percent':
        return { type, percentBp: Math.round(Number(percent.replace(',', '.')) * 100), ...base };
      case 'fixed':
        return { type, amountVnd: num(amount) ?? 0, ...base };
      case 'buy_x_get_y':
        return { type, buyQty: Number(buyQty), getQty: Number(getQty), getDiscountBp: Math.round(Number(getPct) * 100), ...base };
      case 'bundle_price':
        return { type, bundleQty: Number(bundleQty), bundlePriceVnd: num(bundlePrice) ?? 0, ...base };
      case 'gift':
        return { type, giftVariantId: gift[0] ?? '', giftQty: Number(giftQty) || 1, ...base };
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (scope !== 'order' && !ids.length) throw new Error('Hãy chọn ít nhất một mục áp dụng.');
      if (type === 'gift' && !gift.length) throw new Error('Hãy chọn sản phẩm quà tặng.');
      const body = { name: name.trim(), rule: build(), startsAt: fromLocal(startsAt), endsAt: fromLocal(endsAt) };
      if (promotion) await patch(`/api/v1/promotions/${promotion.id}`, { ...body, version: promotion.version });
      else await post('/api/v1/promotions', body);
      toast.success(promotion ? 'Đã lưu phiên bản mới của khuyến mãi.' : 'Đã tạo khuyến mãi.');
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={promotion ? 'Sửa khuyến mãi' : 'Tạo khuyến mãi'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || !startsAt} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {promotion && <StatusRow promotion={promotion} onChanged={onSaved} />}
        {promotion && <InlineAlert tone="info">Lưu sẽ tạo phiên bản mới. Các đơn đã bán vẫn giữ phiên bản cũ.</InlineAlert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Tên chương trình" required value={name} onChange={(e) => setName(e.target.value)} className="sm:col-span-2" autoFocus />
          <SelectField label="Loại ưu đãi" value={type} onChange={(e) => setType(e.target.value as RuleType)}>
            {(['percent', 'fixed', 'buy_x_get_y', 'bundle_price', 'gift'] as const).map((k) => (
              <option key={k} value={k}>
                {TYPE_LABEL[k]}
              </option>
            ))}
          </SelectField>
          {type === 'percent' && <Field label="Phần trăm giảm" required suffix="%" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />}
          {type === 'fixed' && <Field label="Số tiền giảm (một lần mỗi đơn)" required suffix="₫" inputMode="numeric" value={amount ? formatNumber(num(amount) ?? 0) : ''} onChange={(e) => setAmount(e.target.value)} />}
          {type === 'buy_x_get_y' && (
            <div className="grid grid-cols-3 gap-2">
              <Field label="Mua" inputMode="numeric" value={buyQty} onChange={(e) => setBuyQty(e.target.value)} />
              <Field label="Tặng" inputMode="numeric" value={getQty} onChange={(e) => setGetQty(e.target.value)} />
              <Field label="Giảm phần tặng" suffix="%" inputMode="numeric" value={getPct} onChange={(e) => setGetPct(e.target.value)} />
            </div>
          )}
          {type === 'bundle_price' && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Số sản phẩm" inputMode="numeric" value={bundleQty} onChange={(e) => setBundleQty(e.target.value)} />
              <Field label="Giá combo" suffix="₫" inputMode="numeric" value={bundlePrice ? formatNumber(num(bundlePrice) ?? 0) : ''} onChange={(e) => setBundlePrice(e.target.value)} />
            </div>
          )}
          {type === 'gift' && <Field label="Số lượng quà" inputMode="numeric" value={giftQty} onChange={(e) => setGiftQty(e.target.value)} />}
          {type === 'gift' && (
            <div className="sm:col-span-2">
              <ProductPicker value={gift} labels={labels} single onChange={(v, l) => (setGift(v), setLabels(l))} />
            </div>
          )}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-semibold">Áp dụng cho</legend>
          <SelectField
            label="Phạm vi"
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as ScopeKind);
              setIds([]);
            }}
          >
            {(['order', 'product', 'category', 'publisher', 'brand', 'tier'] as const).map((k) => (
              <option key={k} value={k}>
                {SCOPE_LABEL[k]}
              </option>
            ))}
          </SelectField>
          {scope === 'product' && <ProductPicker value={ids} labels={labels} onChange={(v, l) => (setIds(v), setLabels(l))} />}
          {(scope === 'category' || scope === 'publisher' || scope === 'brand' || scope === 'tier') && (
            <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
              {(scope === 'tier' ? TIERS.map((x) => ({ id: x.code, label: x.name })) : (options.data ?? [])).map((o) => {
                const on = ids.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setIds(on ? ids.filter((x) => x !== o.id) : [...ids, o.id])}
                    className={on ? 'h-8 rounded-full border border-navy-700 bg-navy-100 px-3 text-sm text-navy-700' : 'h-8 rounded-full border border-paper-500 bg-white px-3 text-sm hover:bg-navy-50'}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Điều kiện</legend>
          <Field label="Mã giảm giá (để trống nếu tự áp dụng)" className="code" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
          <Field label="Đơn tối thiểu" suffix="₫" inputMode="numeric" value={minOrder ? formatNumber(num(minOrder) ?? 0) : ''} onChange={(e) => setMinOrder(e.target.value)} />
          <Field label="Giới hạn mỗi khách" inputMode="numeric" value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} />
          <Field label="Tổng lượt dùng" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value)} />
          <div className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[13px] font-medium text-ink-700">Kênh bán (để trống = tất cả)</span>
            <div className="flex flex-wrap gap-4">
              {[
                ['counter', 'Tại quầy'],
                ['website', 'Website'],
                ['social', 'Mạng xã hội'],
              ].map(([k, label]) => (
                <label key={k} className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-5" checked={channels.includes(k!)} onChange={(e) => setChannels(e.target.checked ? [...channels, k!] : channels.filter((c) => c !== k))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">Thời gian và ưu tiên</legend>
          <Field label="Bắt đầu" type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          <Field label="Kết thúc (để trống = không hết hạn)" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          <Field label="Độ ưu tiên (cao áp dụng trước)" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
          <label className="inline-flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="size-5" checked={stackable} onChange={(e) => setStackable(e.target.checked)} />
            Cộng dồn với khuyến mãi khác
          </label>
        </fieldset>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}
