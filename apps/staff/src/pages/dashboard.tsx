import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Check, ListFilter } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, Card, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { get } from '../lib/api';
import { formatDate, formatNumber, formatVnd, formatVndCompact } from '../lib/format';
import { t } from '../lib/i18n';
import { useMe } from '../lib/session';

/** Dashboard (FR-RPT-01, Design §12.5): today's figures, range-filtered charts and lists — no alert tiles. */

interface Totals {
  grossVnd: number;
  returnsVnd: number;
  netVnd: number;
  orders: number;
  averageBasketVnd: number;
}
interface Dashboard {
  today: Totals;
  bestsellers: { variantId: string; sku: string; title: string; units: number; grossVnd: number }[];
  lowStock?: { variantId: string; sku: string; title: string; available: number; minStock: number }[];
}
interface SalesRow {
  key: string;
  orders: number;
  grossVnd: number;
}

const CHANNEL_LABEL: Record<string, string> = { counter: 'Tại quầy', website: 'Website', facebook: 'Facebook', zalo: 'Zalo', instagram: 'Instagram', tiktok: 'TikTok' };
/** Fixed channel colours for charts only (Design §4.7). */
const CHANNEL_COLOR: Record<string, string> = {
  counter: 'var(--color-navy-700)',
  website: 'var(--color-sea-500)',
  facebook: 'var(--color-olive-600)',
  zalo: 'var(--color-chart-4)',
  instagram: 'var(--color-sky-300)',
  tiktok: 'var(--color-ink-700)',
};

// ---------------------------------------------------------------------------------------------
// Date ranges in store time (Design §12.5): presets plus a custom range, max 366 days (TDD §4.11).

type Preset = '7d' | '30d' | 'thisMonth' | 'lastMonth' | '90d' | 'thisYear' | 'custom';
const PRESETS: Preset[] = ['7d', '30d', 'thisMonth', 'lastMonth', '90d', 'thisYear', 'custom'];
interface RangeState {
  preset: Preset;
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;
const storeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => iso(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

function presetRange(preset: Preset, custom: { from: string; to: string }): { from: string; to: string } {
  const today = storeToday();
  switch (preset) {
    case '7d':
      return { from: addDays(today, -6), to: today };
    case '30d':
      return { from: addDays(today, -29), to: today };
    case '90d':
      return { from: addDays(today, -89), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 8)}01`, to: today };
    case 'lastMonth': {
      const lastDay = addDays(`${today.slice(0, 8)}01`, -1);
      return { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
    }
    case 'thisYear':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'custom':
      return custom;
  }
}

/** Per-card range, kept for the browser session. */
function useRange(card: string, initial: Preset): [RangeState, (r: RangeState) => void] {
  const key = `dashboard.range.${card}`;
  const [state, setState] = useState<RangeState>(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) return JSON.parse(saved) as RangeState;
    } catch {
      /* storage unavailable: fall back to the default */
    }
    return { preset: initial, ...presetRange(initial, { from: '', to: '' }) };
  });
  const set = (r: RangeState) => {
    setState(r);
    try {
      sessionStorage.setItem(key, JSON.stringify(r));
    } catch {
      /* ignore */
    }
  };
  return [state, set];
}

function rangeError(r: RangeState): string | null {
  if (!r.from || !r.to) return t('dashboard.range.pick');
  if (r.to < r.from) return t('dashboard.range.order');
  if (daysBetween(r.from, r.to) > 366) return t('dashboard.range.tooLong');
  return null;
}

const shortDate = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const rangeLabel = (r: RangeState) => (r.preset === 'custom' ? `${shortDate(r.from)} – ${formatDate(r.to)}` : t(`dashboard.range.${r.preset}`));

/** Filter pill that opens a range popover: presets apply at once, a custom range on “Áp dụng” (Design §12.5). */
function RangeFilter({ value, onChange }: { value: RangeState; onChange: (r: RangeState) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: value.from, to: value.to });
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const draftError = rangeError({ preset: 'custom', ...draft });
  const input = 'h-10 w-full rounded-md border border-paper-500 bg-white px-3 text-sm focus:border-navy-700 max-sm:text-base';

  return (
    <div ref={box} className="relative">
      <Button
        size="sm"
        icon={ListFilter}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${t('dashboard.range.label')}: ${rangeLabel(value)}`}
        onClick={() => {
          setDraft({ from: value.from, to: value.to });
          setOpen(!open);
        }}
      >
        {rangeLabel(value)}
      </Button>
      {open && (
        <div id={panelId} role="dialog" aria-label={t('dashboard.range.label')} className="absolute right-0 z-30 mt-2 w-[280px] max-w-[calc(100vw-2rem)] rounded-lg border border-paper-300 bg-white p-2 shadow-md">
          <ul>
            {PRESETS.filter((p) => p !== 'custom').map((p) => (
              <li key={p}>
                <button
                  type="button"
                  className={clsx('flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm hover:bg-navy-50', value.preset === p && 'font-semibold text-navy-700')}
                  aria-pressed={value.preset === p}
                  onClick={() => {
                    onChange({ preset: p, ...presetRange(p, value) });
                    setOpen(false);
                  }}
                >
                  {t(`dashboard.range.${p}`)}
                  {value.preset === p && <Check size={16} aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 border-t border-paper-300 px-3 pt-3 pb-2">
            <p className="mb-2 text-xs font-semibold text-ink-500">{t('dashboard.range.custom')}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-ink-700">
                {t('dashboard.range.from')}
                <input type="date" className={input} value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-700">
                {t('dashboard.range.to')}
                <input type="date" className={input} value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
              </label>
            </div>
            {draftError && draft.from && draft.to && <p className="mt-2 text-xs text-danger-700">{draftError}</p>}
            <Button
              variant="primary"
              size="sm"
              full
              className="mt-3"
              disabled={!!draftError}
              onClick={() => {
                onChange({ preset: 'custom', ...draft });
                setOpen(false);
              }}
            >
              {t('dashboard.range.apply')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function salesQuery(groupBy: string, r: RangeState) {
  return { queryKey: ['dashboard', 'sales', groupBy, r.from, r.to], queryFn: () => get<{ rows: SalesRow[] }>(`/api/v1/reports/sales?groupBy=${groupBy}&from=${r.from}&to=${r.to}`) };
}

// ---------------------------------------------------------------------------------------------

function greeting(name: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()));
  const key = h < 11 ? 'dashboard.greeting.morning' : h < 18 ? 'dashboard.greeting.afternoon' : 'dashboard.greeting.evening';
  return t(key, { name });
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-paper-300 bg-white p-4 sm:p-6">
      <p className="text-[13px] text-ink-500">{label}</p>
      <p className="mt-1 text-2xl leading-8 font-semibold num text-ink-900">{value}</p>
    </div>
  );
}

/** Every day (or month) in the range, so empty periods show as zero. */
function fillPeriods(rows: SalesRow[], from: string, to: string, byMonth: boolean): SalesRow[] {
  const map = new Map(rows.map((r) => [r.key, r]));
  const out: SalesRow[] = [];
  if (byMonth) {
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
      out.push(map.get(m) ?? { key: m, orders: 0, grossVnd: 0 });
      const [y, mo] = m.split('-').map(Number) as [number, number];
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
  } else {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(map.get(d) ?? { key: d, orders: 0, grossVnd: 0 });
  }
  return out;
}

const periodLabel = (key: string) => (key.length === 7 ? `${key.slice(5)}/${key.slice(0, 4)}` : formatDate(key));

/** Revenue trend: navy bars (revenue, left axis) with a sea line for order count (right axis), Design §12.5. */
function TrendChart({ data }: { data: SalesRow[] }) {
  if (!data.some((d) => d.grossVnd || d.orders)) return <p className="text-ink-500">{t('dashboard.noData')}</p>;
  const maxV = Math.max(...data.map((d) => d.grossVnd), 1);
  const maxO = Math.max(...data.map((d) => d.orders), 1);
  const padL = 64;
  const padR = 36;
  const w = 640;
  const h = 180;
  const top = 12;
  const plotW = w - padL - padR;
  const bw = plotW / data.length;
  const y = (v: number, max: number) => h - (v / max) * (h - top);
  const cx = (i: number) => padL + i * bw + bw / 2;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${cx(i)},${y(d.orders, maxO)}`).join(' ');
  const last = data[data.length - 1]!;
  return (
    <figure>
      <svg
        viewBox={`0 0 ${w} ${h + 24}`}
        className="h-56 w-full"
        role="img"
        aria-label={`${t('dashboard.trend')}: ${data.map((d) => `${periodLabel(d.key)} ${formatVnd(d.grossVnd)}, ${t('dashboard.ordersCount', { n: formatNumber(d.orders) })}`).join('; ')}`}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={w - padR} y1={y(f * maxV, maxV)} y2={y(f * maxV, maxV)} stroke="var(--color-paper-300)" strokeDasharray={f ? '3 3' : undefined} />
            <text x={padL - 6} y={y(f * maxV, maxV) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-500)" className="num">
              {formatVndCompact(Math.round(f * maxV))}
            </text>
            <text x={w - padR + 6} y={y(f * maxO, maxO) + 4} fontSize="11" fill="var(--color-sea-700)" className="num">
              {formatNumber(Math.round(f * maxO))}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const bh = h - y(d.grossVnd, maxV);
          return (
            <rect key={d.key} x={padL + i * bw + bw * 0.15} y={h - bh} width={bw * 0.7} height={bh} rx="2" fill="var(--color-navy-700)">
              <title>{`${periodLabel(d.key)}: ${formatVnd(d.grossVnd)} · ${t('dashboard.ordersCount', { n: formatNumber(d.orders) })}`}</title>
            </rect>
          );
        })}
        <path d={line} fill="none" stroke="var(--color-sea-500)" strokeWidth="2" strokeLinejoin="round" />
        {data.length <= 92 && data.map((d, i) => <circle key={d.key} cx={cx(i)} cy={y(d.orders, maxO)} r="2.5" fill="var(--color-sea-500)" />)}
        <text x={padL} y={h + 18} fontSize="12" fill="var(--color-ink-500)">
          {periodLabel(data[0]!.key)}
        </text>
        <text x={w - padR} y={h + 18} fontSize="12" textAnchor="end" fill="var(--color-ink-500)">
          {periodLabel(last.key)}
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-ink-700">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-navy-700" aria-hidden /> {t('dashboard.revenue')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-sea-500" aria-hidden /> {t('dashboard.orders')}
        </span>
      </figcaption>
    </figure>
  );
}

function TrendCard() {
  const [range, setRange] = useRange('trend', '30d');
  const err = rangeError(range);
  const byMonth = !err && daysBetween(range.from, range.to) > 92;
  const q = useQuery({ ...salesQuery(byMonth ? 'month' : 'day', range), enabled: !err });
  return (
    <Card title={t('dashboard.trend')} className="col-span-12 xl:col-span-8" action={<RangeFilter value={range} onChange={setRange} />}>
      {err ? <p className="text-ink-500">{err}</p> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data ? <TrendChart data={fillPeriods(q.data.rows, range.from, range.to, byMonth)} /> : <Skeleton className="h-56" />}
    </Card>
  );
}

function ChannelBars({ data }: { data: SalesRow[] }) {
  const total = data.reduce((a, d) => a + d.grossVnd, 0);
  if (!total) return <p className="text-ink-500">{t('dashboard.noData')}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {data.map((d) => (
        <li key={d.key}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-ink-700">{CHANNEL_LABEL[d.key] ?? d.key}</span>
            <span className="num text-ink-900">
              {formatVnd(d.grossVnd)} · {Math.round((d.grossVnd / total) * 100)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-paper-200">
            <div className="h-2 rounded-full" style={{ width: `${(d.grossVnd / total) * 100}%`, background: CHANNEL_COLOR[d.key] ?? 'var(--color-paper-500)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ChannelCard() {
  const [range, setRange] = useRange('channel', 'thisMonth');
  const err = rangeError(range);
  const q = useQuery({ ...salesQuery('channel', range), enabled: !err });
  return (
    <Card title={t('dashboard.byChannel')} className="col-span-12 xl:col-span-4" action={<RangeFilter value={range} onChange={setRange} />}>
      {err ? <p className="text-ink-500">{err}</p> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : q.data ? <ChannelBars data={q.data.rows} /> : <Skeleton className="h-48" />}
    </Card>
  );
}

const th = 'pb-2 text-left text-xs font-medium text-ink-500';

export function DashboardPage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/api/v1/reports/dashboard'), refetchInterval: 60_000 });
  const today = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const kpis = q.data
    ? [
        { label: t('dashboard.kpi.revenue'), value: formatVnd(q.data.today.grossVnd) },
        { label: t('dashboard.kpi.orders'), value: formatNumber(q.data.today.orders) },
        { label: t('dashboard.basket'), value: formatVnd(q.data.today.averageBasketVnd) },
      ]
    : null;

  return (
    <>
      <PageHeader title={greeting(me?.displayName ?? '')} breadcrumb={today.charAt(0).toUpperCase() + today.slice(1)} />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className="col-span-12 md:col-span-6 xl:col-span-4">
              {kpis ? <Kpi {...kpis[i]!} /> : <Skeleton className="h-[100px]" />}
            </div>
          ))}
          <TrendCard />
          <ChannelCard />
          <Card title={t('dashboard.bestsellers')} className="col-span-12 lg:col-span-6">
            {q.data?.bestsellers.length ? (
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-paper-300">
                    <th scope="col" className={`${th} w-8`}>#</th>
                    <th scope="col" className={th}>{t('dashboard.col.product')}</th>
                    <th scope="col" className={`${th} w-32`}>{t('dashboard.col.sku')}</th>
                    <th scope="col" className={`${th} w-16 text-right`}>{t('dashboard.col.sold')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-300">
                  {q.data.bestsellers.map((b, i) => (
                    <tr key={b.variantId}>
                      <td className="py-2 text-ink-500 num">{i + 1}</td>
                      <td className="truncate py-2">{b.title}</td>
                      <td className="code truncate py-2 text-xs text-ink-500">{b.sku}</td>
                      <td className="py-2 text-right num">{formatNumber(b.units)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-ink-500">{q.data ? t('dashboard.noData') : ''}</p>
            )}
          </Card>
          {q.data?.lowStock && (
            <Card title={t('dashboard.lowStock')} className="col-span-12 lg:col-span-6">
              {q.data.lowStock.length ? (
                <>
                  <table className="w-full table-fixed text-sm">
                    <thead>
                      <tr className="border-b border-paper-300">
                        <th scope="col" className={th}>{t('dashboard.col.product')}</th>
                        <th scope="col" className={`${th} w-32`}>{t('dashboard.col.sku')}</th>
                        <th scope="col" className={`${th} w-28 text-right`}>{t('dashboard.col.stock')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-paper-300">
                      {q.data.lowStock.map((l) => (
                        <tr key={l.variantId}>
                          <td className="truncate py-2">{l.title}</td>
                          <td className="code truncate py-2 text-xs text-ink-500">{l.sku}</td>
                          <td className="py-2 text-right num text-warning-700">
                            {formatNumber(l.available)} / {formatNumber(l.minStock)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="mt-4 flex justify-end">
                    <Button variant="tonal" size="sm" onClick={() => navigate('/products?stock=low')}>
                      {t('dashboard.viewDetails')}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-ink-500">{t('dashboard.noData')}</p>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
