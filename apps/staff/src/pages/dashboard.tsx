import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowUpRight, ListFilter } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Card, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { get } from '../lib/api';
import { formatDate, formatNumber, formatVnd, formatVndCompact } from '../lib/format';
import { t } from '../lib/i18n';
import { useMe } from '../lib/session';
import { type LibraryOverviewData } from './library';

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
  /** Overdue library loans, for users who lend (FR-RPT-01). */
  libraryOverview?: LibraryOverviewData;
  /** Units on hand by product type, for users who see stock (FR-RPT-01). */
  productMix?: { kind: MixKind; units: number }[];
  overdueLoans: { loanId: string; title: string; callNo: string | null; customerName: string; customerPhone: string | null; dueAt: string; daysLate: number }[];
}
// ---------------------------------------------------------------------------------------------
// Date ranges in store time (Design §12.5): presets plus a custom range, max 366 days (TDD §4.11).

type Preset = '7d' | '30d' | 'custom';
const PRESETS: Preset[] = ['7d', '30d', 'custom'];
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
      const parsed = saved ? (JSON.parse(saved) as RangeState) : null;
      // A preset saved before the list was trimmed falls back to the default.
      if (parsed && PRESETS.includes(parsed.preset)) return parsed;
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
/** The range as a card subtext: “30 ngày qua”, or the custom dates. */
const rangeSubtext = (r: RangeState) => (r.preset === 'custom' ? rangeLabel(r) : t(`dashboard.range.${r.preset}Past`));

/** Open state for a header popover: closes on Escape or a click outside. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
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
  return { open, setOpen, box };
}

const popoverPanel = 'absolute right-0 z-30 mt-2 w-[280px] max-w-[calc(100vw-2rem)] rounded-lg border border-paper-300 bg-white p-2 shadow-md';
const groupTitle = 'px-3 pt-2 pb-1 text-xs font-semibold text-ink-500';

/** Radio group: 7 ngày / 30 ngày apply at once, Tùy chọn applies its dates on “Áp dụng” (Design §12.5). */
function RangeSection({ value, onPick }: { value: RangeState; onPick: (r: RangeState) => void }) {
  // The radio choice is local: Tùy chọn only takes effect on “Áp dụng”.
  const [choice, setChoice] = useState<Preset>(value.preset);
  const [draft, setDraft] = useState({ from: value.from, to: value.to });
  const name = useId();
  const draftError = rangeError({ preset: 'custom', ...draft });
  const input = 'h-10 w-full rounded-md border border-paper-500 bg-white px-1.5 text-xs focus:border-navy-700 [&::-webkit-calendar-picker-indicator]:ml-0.5 [&::-webkit-calendar-picker-indicator]:w-3';
  return (
    <div role="radiogroup" aria-label={t('dashboard.range.label')}>
      {PRESETS.map((p) => (
        <label key={p} className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-sm hover:bg-navy-50">
          <input
            type="radio"
            name={name}
            className="size-4 accent-navy-700"
            checked={choice === p}
            onChange={() => {
              setChoice(p);
              if (p !== 'custom') onPick({ preset: p, ...presetRange(p, value) });
            }}
          />
          {t(`dashboard.range.${p}`)}
        </label>
      ))}
      {choice === 'custom' && (
        <div className="px-2 pt-1 pb-2">
          <div className="grid grid-cols-2 gap-1.5">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-700">
              {t('dashboard.range.from')}
              <input type="date" className={input} value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-700">
              {t('dashboard.range.to')}
              <input type="date" className={input} value={draft.to} min={draft.from || undefined} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
            </label>
          </div>
          {draftError && draft.from && draft.to && <p className="mt-2 text-xs text-danger-700">{draftError}</p>}
          <Button variant="primary" size="sm" full className="mt-3" disabled={!!draftError} onClick={() => onPick({ preset: 'custom', ...draft })}>
            {t('dashboard.range.apply')}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Revenue trend: shop and library (FR-RPT-01, Design §12.5)

type Series = 'sales' | 'library' | 'orders' | 'slips';
type SeriesState = Record<Series, boolean>;
const SERIES_GROUPS: { title: string; items: Series[] }[] = [
  { title: 'Doanh thu', items: ['sales', 'library'] },
  { title: 'Số đơn', items: ['orders', 'slips'] },
];
const SERIES: Record<Series, { label: string; color: string }> = {
  sales: { label: 'Bán hàng', color: 'var(--color-navy-700)' },
  library: { label: 'Thư viện', color: 'var(--color-olive-600)' },
  orders: { label: 'Đơn bán', color: 'var(--color-sea-500)' },
  slips: { label: 'Phiếu mượn', color: 'var(--color-chart-4)' },
};
const ALL_SERIES: SeriesState = { sales: true, library: true, orders: true, slips: true };

/** Which series are shown, kept for the browser session. */
function useSeries(): [SeriesState, (s: SeriesState) => void] {
  const key = 'dashboard.trend.series';
  const [state, setState] = useState<SeriesState>(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) return { ...ALL_SERIES, ...(JSON.parse(saved) as Partial<SeriesState>) };
    } catch {
      /* storage unavailable: show everything */
    }
    return ALL_SERIES;
  });
  const set = (s: SeriesState) => {
    setState(s);
    try {
      sessionStorage.setItem(key, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  };
  return [state, set];
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-3 text-sm hover:bg-navy-50">
      <input type="checkbox" className="size-4 accent-navy-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** “Lọc”: series to show (Doanh thu, Số đơn) and the time range; changes apply at once (Design §12.5). */
function TrendFilter({ series, onSeries, range, onRange }: { series: SeriesState; onSeries: (s: SeriesState) => void; range: RangeState; onRange: (r: RangeState) => void }) {
  const { open, setOpen, box } = usePopover();
  const panelId = useId();
  const filtered = Object.values(series).some((v) => !v);
  return (
    <div ref={box} className="relative">
      <Button size="sm" icon={ListFilter} aria-haspopup="dialog" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)} className="relative">
        {t('dashboard.filter')}
        {filtered && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white bg-navy-700" role="img" aria-label={t('dashboard.filter.active')} />}
      </Button>
      {open && (
        <div id={panelId} role="dialog" aria-label={t('dashboard.filter')} className={clsx(popoverPanel, 'max-h-[70vh] overflow-y-auto')}>
          {SERIES_GROUPS.map((g, gi) => {
            const on = g.items.filter((k) => series[k]).length;
            return (
              <div key={g.title} role="group" aria-labelledby={`${panelId}-${gi}`} className={clsx(gi > 0 && 'mt-1 border-t border-paper-300 pt-1')}>
                <p id={`${panelId}-${gi}`} className={groupTitle}>{g.title}</p>
                <Checkbox label="Tất cả" checked={on === g.items.length} onChange={(v) => onSeries({ ...series, ...Object.fromEntries(g.items.map((k) => [k, v])) })} />
                {g.items.map((k) => (
                  <Checkbox key={k} label={SERIES[k].label} checked={series[k]} onChange={(v) => onSeries({ ...series, [k]: v })} />
                ))}
              </div>
            );
          })}
          <div className="mt-1 border-t border-paper-300 pt-1">
            <p className={groupTitle}>Thời gian</p>
            <RangeSection value={range} onPick={onRange} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function greeting(name: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()));
  const key = h < 11 ? 'dashboard.greeting.morning' : h < 18 ? 'dashboard.greeting.afternoon' : 'dashboard.greeting.evening';
  return t(key, { name });
}

/**
 * One summary tile. Tiles are equal width at every size; text is sized to the tile (container query units)
 * so the row fits a phone. `compact` (if given) replaces the value below `sm`,
 * `unit` is a small muted suffix after the amount (“/đơn”, “cuốn”), and `to` makes the tile a link (Design §12.5).
 */
function Kpi({ label, value, compact, unit, to, tone }: { label: string; value: string | undefined; compact?: string | undefined; unit?: string; to?: string; tone?: string | undefined }) {
  const body = (
    <>
      <p className="text-[clamp(11px,9.5cqi,14px)] leading-[1.4] text-ink-500">{label}</p>
      {value === undefined ? (
        <Skeleton className="mt-1 h-[1.4em] w-14 text-[clamp(11px,13cqi,20px)]" />
      ) : (
        <p className={clsx('mt-1 truncate text-[clamp(11px,13cqi,20px)] leading-[1.4] font-semibold num', tone ?? 'text-ink-900')}>
          {compact && compact !== value ? (
            <>
              <span className="sm:hidden" aria-hidden>{compact}</span>
              <span className="max-sm:sr-only">{value}</span>
            </>
          ) : (
            value
          )}
          {unit && <span className={clsx('text-[max(10px,0.7em)] font-normal text-ink-500', unit.startsWith('/') ? 'ml-0.5' : 'ml-1')}>{unit}</span>}
        </p>
      )}
    </>
  );
  const box = '@container flex min-w-0 flex-col justify-between rounded-lg border border-navy-700/30 bg-white px-1.5 py-2.5 sm:p-4 xl:p-3';
  return to ? (
    <Link to={to} className={clsx(box, 'hover:border-navy-700')}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

const LIBRARY_PERIOD: Record<LibraryOverviewData['period'], string> = { day: 'Số liệu hôm nay', week: 'Số liệu tuần này', month: 'Số liệu tháng này' };

interface TrendRow {
  key: string;
  salesVnd: number;
  salesOrders: number;
  libraryVnd: number;
  librarySlips: number;
}

/** Every day (or month) in the range, so empty periods show as zero. */
function fillTrend(rows: TrendRow[], from: string, to: string, byMonth: boolean): TrendRow[] {
  const map = new Map(rows.map((r) => [r.key, r]));
  const zero = (key: string): TrendRow => ({ key, salesVnd: 0, salesOrders: 0, libraryVnd: 0, librarySlips: 0 });
  const out: TrendRow[] = [];
  if (byMonth) {
    for (let m = from.slice(0, 7); m <= to.slice(0, 7); ) {
      out.push(map.get(m) ?? zero(m));
      const [y, mo] = m.split('-').map(Number) as [number, number];
      m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
    }
  } else {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(map.get(d) ?? zero(d));
  }
  return out;
}

const periodLabel = (key: string) => (key.length === 7 ? `${key.slice(5)}/${key.slice(0, 4)}` : formatDate(key));

/** A bar segment with only its top corners rounded. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Stacked Bán hàng / Thư viện bars (left axis) with Đơn bán / Phiếu mượn lines (right axis), Design §12.5. */
/** Live pixel size of an element, so the chart can draw at its real size (Design §12.5). */
function useElementSize() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e!.contentRect.width), h: Math.round(e!.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

function TrendChart({ data, show }: { data: TrendRow[]; show: SeriesState }) {
  const [plotRef, size] = useElementSize();
  const bars = (['sales', 'library'] as const).filter((k) => show[k]);
  const lines = (['orders', 'slips'] as const).filter((k) => show[k]);
  if (!bars.length && !lines.length) return <p className="text-ink-500">{t('dashboard.trend.pickOne')}</p>;
  const amount = (d: TrendRow, k: 'sales' | 'library') => (k === 'sales' ? d.salesVnd : d.libraryVnd);
  const count = (d: TrendRow, k: 'orders' | 'slips') => (k === 'orders' ? d.salesOrders : d.librarySlips);
  const stack = (d: TrendRow) => bars.reduce((a, k) => a + amount(d, k), 0);
  if (!data.some((d) => stack(d) || lines.some((k) => count(d, k)))) return <p className="text-ink-500">{t('dashboard.noData')}</p>;
  const maxV = Math.max(...data.map(stack), 1);
  // An even maximum keeps the middle gridline label a whole number of orders.
  const maxO = Math.max(2, Math.ceil(Math.max(...data.flatMap((d) => lines.map((k) => count(d, k))), 0) / 2) * 2);
  const padL = bars.length ? 64 : 12;
  const padR = lines.length ? 36 : 12;
  // Drawn in real pixels: the plot fills its box (min 224 px high), so axis text keeps its size.
  const w = size.w || 640;
  const h = (size.h || 224) - 24;
  const top = 12;
  const plotW = w - padL - padR;
  const bw = plotW / data.length;
  const y = (v: number, max: number) => h - (v / max) * (h - top);
  const cx = (i: number) => padL + i * bw + bw / 2;
  const tip = (d: TrendRow) =>
    [
      periodLabel(d.key),
      ...bars.map((k) => `${SERIES[k].label}: ${formatVnd(amount(d, k))}`),
      ...(bars.length > 1 ? [`Tổng: ${formatVnd(stack(d))}`] : []),
      ...lines.map((k) => `${SERIES[k].label}: ${formatNumber(count(d, k))}`),
    ].join('\n');
  return (
    <figure className="flex flex-1 flex-col">
      <div ref={plotRef} className="relative min-h-56 flex-1 xl:max-h-[420px] xl:min-h-40">
      <svg viewBox={`0 0 ${w} ${h + 24}`} width={w} height={h + 24} className="absolute inset-0 size-full" role="img" aria-label={`${t('dashboard.trend')}: ${data.map((d) => tip(d).replaceAll('\n', ', ')).join('; ')}`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={w - padR} y1={y(f, 1)} y2={y(f, 1)} stroke="var(--color-paper-300)" strokeDasharray={f ? '3 3' : undefined} />
            {!!bars.length && (
              <text x={padL - 6} y={y(f, 1) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-500)" className="num">
                {formatVndCompact(Math.round(f * maxV))}
              </text>
            )}
            {!!lines.length && (
              <text x={w - padR + 6} y={y(f, 1) + 4} fontSize="11" fill="var(--color-ink-500)" className="num">
                {formatNumber(Math.round(f * maxO))}
              </text>
            )}
          </g>
        ))}
        {data.map((d, i) => {
          let base = h;
          const segs = bars.map((k) => ({ k, v: amount(d, k) })).filter((s) => s.v > 0);
          const x = padL + i * bw + bw * 0.15;
          const bwid = bw * 0.7;
          return (
            <g key={d.key}>
              {segs.map((s, si) => {
                const sh = h - y(s.v, maxV);
                base -= sh;
                return si === segs.length - 1 ? (
                  <path key={s.k} d={topRounded(x, base, bwid, sh, 3)} fill={SERIES[s.k].color} />
                ) : (
                  <rect key={s.k} x={x} y={base} width={bwid} height={sh} fill={SERIES[s.k].color} />
                );
              })}
            </g>
          );
        })}
        {lines.map((k) => (
          <g key={k}>
            <path d={data.map((d, i) => `${i ? 'L' : 'M'}${cx(i)},${y(count(d, k), maxO)}`).join(' ')} fill="none" stroke={SERIES[k].color} strokeWidth="2" strokeLinejoin="round" />
            {data.length <= 92 && data.map((d, i) => <circle key={d.key} cx={cx(i)} cy={y(count(d, k), maxO)} r="2.5" fill={SERIES[k].color} />)}
          </g>
        ))}
        {/* Full-height hover targets carry the per-period tooltip. */}
        {data.map((d, i) => (
          <rect key={d.key} x={padL + i * bw} y={top} width={bw} height={h - top} fill="transparent">
            <title>{tip(d)}</title>
          </rect>
        ))}
        <text x={padL} y={h + 18} fontSize="12" fill="var(--color-ink-500)">
          {periodLabel(data[0]!.key)}
        </text>
        <text x={w - padR} y={h + 18} fontSize="12" textAnchor="end" fill="var(--color-ink-500)">
          {periodLabel(data[data.length - 1]!.key)}
        </text>
      </svg>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700">
        {bars.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: SERIES[k].color }} aria-hidden /> {SERIES[k].label}
          </span>
        ))}
        {lines.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: SERIES[k].color }} aria-hidden /> {SERIES[k].label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function TrendCard() {
  const [range, setRange] = useRange('trend', '30d');
  const [series, setSeries] = useSeries();
  const err = rangeError(range);
  const byMonth = !err && daysBetween(range.from, range.to) > 92;
  const groupBy = byMonth ? 'month' : 'day';
  const q = useQuery({
    queryKey: ['dashboard', 'trend', groupBy, range.from, range.to],
    queryFn: () => get<{ rows: TrendRow[] }>(`/api/v1/reports/trend?groupBy=${groupBy}&from=${range.from}&to=${range.to}`),
    enabled: !err,
  });
  return (
    <Card
      title={t('dashboard.trend')}
      subtitle={rangeSubtext(range)}
      className="col-span-12 flex flex-col xl:col-span-7"
      action={<TrendFilter series={series} onSeries={setSeries} range={range} onRange={setRange} />}
    >
      {err ? (
        <p className="text-ink-500">{err}</p>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <TrendChart data={fillTrend(q.data.rows, range.from, range.to, byMonth)} show={series} />
      ) : (
        <Skeleton className="h-56" />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
const th = 'pb-2 text-left text-xs font-medium text-ink-500';

// Tổng quan tồn kho: units on hand by product type (FR-RPT-01, Design §12.5)

type MixKind = 'book' | 'stationery' | 'other';
const MIX: Record<MixKind, { label: string; color: string }> = {
  book: { label: 'Sách', color: 'var(--color-chart-1)' },
  stationery: { label: 'Văn phòng phẩm', color: 'var(--color-chart-2)' },
  other: { label: 'Khác', color: 'var(--color-chart-3)' },
};

/** Donut with 2 px gaps and rounded ends; segments shorter than the ring width keep square ends. */
function Donut({ data, total }: { data: { kind: MixKind; units: number }[]; total: number }) {
  const size = 168;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = data.filter((d) => d.units > 0);
  const gap = shown.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <div className="relative size-36 shrink-0 sm:size-42">
      <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90" aria-hidden>
        {shown.map((d) => {
          const arc = (d.units / total) * c;
          const round = shown.length > 1 && arc - gap > stroke;
          // Round caps add half the ring width at each end, so the drawn dash is shortened to match.
          const dash = shown.length === 1 ? c : Math.max(round ? arc - gap - stroke : arc - gap, 0.5);
          const start = offset + (round ? stroke / 2 : 0) + gap / 2;
          offset += arc;
          return (
            <circle
              key={d.kind}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={MIX[d.kind].color}
              strokeWidth={stroke}
              strokeLinecap={round ? 'round' : 'butt'}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-start}
            >
              <title>{`${MIX[d.kind].label}: ${formatNumber(d.units)} · ${Math.round((d.units / total) * 100)}%`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl leading-7 font-semibold num text-ink-900 sm:text-2xl sm:leading-8">{formatNumber(total)}</span>
        <span className="text-xs text-ink-500">sản phẩm</span>
      </div>
    </div>
  );
}

function ProductMixCard({ data, className }: { data: { kind: MixKind; units: number }[]; className: string }) {
  const navigate = useNavigate();
  const total = data.reduce((a, d) => a + d.units, 0);
  return (
    <Card
      title="Tổng quan tồn kho"
      className={className}
      headerNowrap
      action={
        <Button variant="tonal" size="sm" className="size-8 shrink-0 px-0! pointer-coarse:size-11" aria-label="Chi tiết" title="Chi tiết" onClick={() => navigate('/products')}>
          <ArrowUpRight size={18} strokeWidth={2.5} className="shrink-0" aria-hidden />
        </Button>
      }
    >
      {total ? (
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-5">
          <Donut data={data} total={total} />
          <ul className="flex min-w-max flex-1 flex-col gap-3" aria-label="Số lượng tồn kho theo loại">
            {data.map((d) => (
              <li key={d.kind} className="flex items-center gap-2.5 text-sm">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: MIX[d.kind].color }} aria-hidden />
                <span className="flex-1 whitespace-nowrap pr-4 text-ink-700">{MIX[d.kind].label}</span>
                <span className="num text-ink-500">{formatNumber(d.units)}</span>
                <span className="w-11 text-right num font-semibold text-ink-900">{Math.round((d.units / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-ink-500">{t('dashboard.noData')}</p>
      )}
    </Card>
  );
}

/** Tổng quan thư viện on the dashboard: built like Tổng quan cửa hàng, three tiles (Design §12.5, FR-LIB-15a). */
function LibraryCard({ data, overdue }: { data: LibraryOverviewData; overdue: Dashboard['overdueLoans'] }) {
  const navigate = useNavigate();
  return (
    <Card title="Tổng quan thư viện" subtitle={LIBRARY_PERIOD[data.period]} className="max-sm:px-2 xl:flex-1 xl:p-4">
      <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
        <Kpi label="Doanh thu" value={formatVnd(data.collectedVnd)} compact={formatVndCompact(data.collectedVnd)} to={`/library?tab=all&time=${data.from}..${data.to}`} />
        <Kpi label="Đang mượn" value={formatNumber(data.onLoan)} unit="cuốn" to="/library" />
        <Kpi label="Quá hạn" value={formatNumber(data.overdue)} unit="cuốn" to="/library?tab=overdue" tone={data.overdue ? 'text-danger-700' : undefined} />
      </div>
      {!!overdue.length && (
        <>
          <h3 className="mt-6 mb-2 text-sm font-semibold">Sách mượn quá hạn</h3>
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="border-b border-paper-300">
                <th scope="col" className={th}>Sách</th>
                <th scope="col" className={th}>Người mượn</th>
                <th scope="col" className={`${th} w-24 text-right`}>Trễ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-300">
              {overdue.map((l) => (
                <tr key={l.loanId}>
                  <td className="truncate py-2">{l.title}</td>
                  <td className="truncate py-2">{l.customerName}</td>
                  <td className="py-2 text-right num text-danger-700">{formatNumber(l.daysLate)} ngày</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex justify-end">
            <Button variant="tonal" size="sm" onClick={() => navigate('/library?tab=overdue')}>
              {t('dashboard.viewDetails')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/api/v1/reports/dashboard'), refetchInterval: 60_000 });
  const today = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const d = q.data?.today;

  return (
    <>
      <PageHeader title={greeting(me?.displayName ?? '')} breadcrumb={today.charAt(0).toUpperCase() + today.slice(1)} />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 flex flex-col gap-6 xl:col-span-5">
          <Card title={t('dashboard.summary')} subtitle={t('dashboard.summary.today')} className="max-sm:px-2 xl:flex-1 xl:p-4">
            <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
              <Kpi label={t('dashboard.kpi.revenue')} value={d && formatVnd(d.grossVnd)} compact={d && formatVndCompact(d.grossVnd)} />
              <Kpi label={t('dashboard.kpi.orders')} value={d && formatNumber(d.orders)} />
              <Kpi label={t('dashboard.kpi.basket')} value={d && formatVnd(d.averageBasketVnd)} compact={d && formatVndCompact(d.averageBasketVnd)} unit={t('dashboard.kpi.perOrder')} />
            </div>
          </Card>
          {q.data?.libraryOverview && <LibraryCard data={q.data.libraryOverview} overdue={q.data.overdueLoans} />}
          </div>
          <TrendCard />
          {q.data?.productMix && <ProductMixCard data={q.data.productMix} className="col-span-12 xl:col-span-4 xl:p-4" />}
          <Card title={t('dashboard.bestsellers')} className="col-span-12 xl:col-span-4 xl:p-4">
            {q.data?.bestsellers.length ? (
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-paper-300">
                    <th scope="col" className={`${th} w-8`}>#</th>
                    <th scope="col" className={th}>{t('dashboard.col.product')}</th>
                    <th scope="col" className={`${th} w-32 xl:hidden`}>{t('dashboard.col.sku')}</th>
                    <th scope="col" className={`${th} w-16 text-right`}>{t('dashboard.col.sold')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-300">
                  {q.data.bestsellers.map((b, i) => (
                    <tr key={b.variantId}>
                      <td className="py-2 text-ink-500 num">{i + 1}</td>
                      <td className="truncate py-2" title={b.title}>{b.title}</td>
                      <td className="code truncate py-2 text-xs text-ink-500 xl:hidden">{b.sku}</td>
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
            <Card title={t('dashboard.lowStock')} className="col-span-12 xl:col-span-4 xl:p-4">
              {q.data.lowStock.length ? (
                <>
                  <table className="w-full table-fixed text-sm">
                    <thead>
                      <tr className="border-b border-paper-300">
                        <th scope="col" className={th}>{t('dashboard.col.product')}</th>
                        <th scope="col" className={`${th} w-32 xl:hidden`}>{t('dashboard.col.sku')}</th>
                        <th scope="col" className={`${th} w-28 text-right`}>{t('dashboard.col.stock')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-paper-300">
                      {q.data.lowStock.map((l) => (
                        <tr key={l.variantId}>
                          <td className="truncate py-2" title={l.title}>{l.title}</td>
                          <td className="code truncate py-2 text-xs text-ink-500 xl:hidden">{l.sku}</td>
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
