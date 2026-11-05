import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { clsx } from 'clsx';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { FilterMenu, TimeFilter, timeDays, timeLabel, toast, useParam } from '../components/data';
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { get, post } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, formatVnd, formatVndCompact } from '../lib/format';
import { can, useMe } from '../lib/session';

/** Reports (FR-RPT-02..05, FR-RPT-10, Design §12.6): one page per area, every report a section with its own filter and Excel export; chart, table with totals. */

type ColumnType = 'text' | 'vnd' | 'int' | 'date' | 'datetime' | 'percent';
interface Table {
  title: string;
  from: string | null;
  to: string | null;
  columns: { key: string; label: string; type: ColumnType }[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}

interface ReportDef {
  key: string;
  label: string;
  report: 'sales' | 'inventory' | 'tax' | 'purchasing';
  params: Record<string, string>;
  range: boolean;
  /** By day, or by month when the range is longer than 92 days (Design §12.6). */
  period?: boolean;
  permission?: string;
}

const SALES: ReportDef[] = [
  { key: 'sales-period', label: 'Theo thời gian', report: 'sales', params: {}, range: true, period: true },
  { key: 'sales-item', label: 'Theo sản phẩm', report: 'sales', params: { groupBy: 'item' }, range: true },
  { key: 'sales-customer', label: 'Theo khách hàng', report: 'sales', params: { groupBy: 'customer' }, range: true },
  // By channel moved here from the dashboard (FR-RPT-02, FR-SOC-02).
  { key: 'sales-channel', label: 'Theo kênh', report: 'sales', params: { groupBy: 'channel' }, range: true },
];

// Purchasing reports sit with inventory (Design §12.6): only stock-ins remain.
const INVENTORY: ReportDef[] = [
  { key: 'inv-stock', label: 'Tồn kho hiện tại', report: 'inventory', params: { view: 'stock' }, range: false },
  { key: 'inv-movements', label: 'Nhập – xuất – tồn', report: 'inventory', params: { view: 'movements' }, range: true },
  { key: 'pur-stockins', label: 'Phiếu nhập hàng', report: 'purchasing', params: { view: 'stock_ins' }, range: true },
];

const TAX: ReportDef[] = [
  { key: 'tax-vat', label: 'Thuế GTGT đầu ra', report: 'tax', params: { view: 'vat' }, range: true },
  { key: 'tax-einvoices', label: 'Hóa đơn điện tử', report: 'tax', params: { view: 'einvoices' }, range: true },
  { key: 'tax-shifts', label: 'Ca làm và chênh lệch tiền', report: 'tax', params: { view: 'shifts' }, range: true },
];


function cell(type: ColumnType, v: unknown) {
  if (v == null || v === '') return '—';
  switch (type) {
    case 'vnd':
      return formatVnd(Number(v));
    case 'int':
      return formatNumber(Number(v));
    case 'percent':
      return `${(Number(v) / 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`;
    case 'date':
      return formatDate(String(v));
    case 'datetime':
      return formatDateTime(String(v));
    default:
      // Months come as YYYY-MM (sortable); shown as MM/YYYY.
      return String(v).replace(/^(\d{4})-(\d{2})$/, '$2/$1');
  }
}

const DAY_MS = 86_400_000;
const addDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};
const periodShort = (key: string) => (key.length === 7 ? `${key.slice(5)}/${key.slice(0, 4)}` : `${key.slice(8)}/${key.slice(5, 7)}`);
const periodLong = (key: string) => (key.length === 7 ? `Tháng ${key.slice(5)}/${key.slice(0, 4)}` : formatDate(key));

/** Every day (or month) of the range, zero where nothing sold, so gaps are not hidden. */
function fillPeriods(table: Table, byMonth: boolean): { key: string; value: number }[] {
  const map = new Map(table.rows.map((r) => [String(r.key), Number(r.grossVnd ?? 0)]));
  const out: { key: string; value: number }[] = [];
  if (!table.from || !table.to) return out;
  if (byMonth) for (let m = table.from.slice(0, 7); m <= table.to.slice(0, 7); m = nextMonth(m)) out.push({ key: m, value: map.get(m) ?? 0 });
  else for (let d = table.from; d <= table.to; d = addDay(d)) out.push({ key: d, value: map.get(d) ?? 0 });
  return out;
}

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const CHART_KINDS = [
  ['bar', 'Cột'],
  ['line', 'Đường'],
] as const;

/** Revenue over time as columns or a line, chosen in the card header (Design §12.6). */
function RevenueChart({ table, byMonth }: { table: Table; byMonth: boolean }) {
  const [kind, setKind] = useParam('chart', 'bar');
  const data = fillPeriods(table, byMonth);
  if (data.length < 2) return null;
  const toggle = (
    <div role="radiogroup" aria-label="Kiểu biểu đồ" className="inline-flex rounded-full border border-paper-500 p-0.5 text-sm">
      {CHART_KINDS.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={kind === k}
          onClick={() => setKind(k)}
          className={clsx('h-8 rounded-full px-3 font-medium', kind === k ? 'bg-navy-700 text-white' : 'text-ink-700 hover:bg-navy-50')}
        >
          {label}
        </button>
      ))}
    </div>
  );
  return (
    <Card title="Doanh thu" action={toggle}>
      {kind === 'line' ? <LineChart data={data} /> : <ColumnChart data={data} />}
    </Card>
  );
}

function ColumnChart({ data }: { data: { key: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex h-48 items-end justify-around gap-0.5" role="img" aria-label={`Biểu đồ cột doanh thu: ${data.map((d) => `${periodLong(d.key)} ${formatVnd(d.value)}`).join('; ')}`}>
      {data.map((d) => (
        <div key={d.key} className="group relative flex h-full max-w-6 flex-1 flex-col justify-end">
          <div className="rounded-t bg-navy-700" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }} />
          <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-ink-900 px-2 py-1 text-center text-xs whitespace-nowrap text-white group-hover:block">
            <strong className="block text-sm num">{formatVnd(d.value)}</strong>
            {periodLong(d.key)}
          </span>
        </div>
      ))}
    </div>
  );
}

function LineChart({ data }: { data: { key: string; value: number }[] }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const h = 220;
  // Room for labels up to “999.000 ₫” (larger amounts switch to “tr ₫”).
  const padL = 84;
  const padR = 12;
  const top = 12;
  const bottom = 24;
  const w = Math.max(width, 240);
  const plotW = w - padL - padR;
  const plotH = h - top - bottom;
  const max = Math.max(...data.map((d) => d.value), 1);
  const last = data.length - 1;
  const x = (i: number) => padL + (i / last) * plotW;
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(last).toFixed(1)},${top + plotH} L${padL},${top + plotH} Z`;
  const clamp = (i: number) => Math.max(0, Math.min(last, i));
  const pick = (clientX: number, rect: DOMRect) => setActive(clamp(Math.round(((clientX - rect.left - padL) / plotW) * last)));
  const a = active === null ? null : data[active]!;
  return (
    <div ref={box} className="relative">
      {width > 0 && (
        <svg
          width={w}
          height={h}
          role="img"
          tabIndex={0}
          aria-label={`Biểu đồ đường doanh thu: ${data.map((d) => `${periodLong(d.key)} ${formatVnd(d.value)}`).join('; ')}`}
          className="block touch-none outline-none focus-visible:ring-2 focus-visible:ring-navy-700"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const step = e.key === 'ArrowRight' ? 1 : -1;
            setActive((i) => clamp(i === null ? (step > 0 ? 0 : last) : i + step));
          }}
        >
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={padL} x2={w - padR} y1={y(f * max)} y2={y(f * max)} stroke="var(--color-paper-300)" strokeWidth="1" />
              <text x={padL - 8} y={y(f * max) + 4} textAnchor="end" fontSize="12" fill="var(--color-ink-500)" className="num">
                {formatVndCompact(Math.round(f * max))}
              </text>
            </g>
          ))}
          <path d={area} fill="var(--color-navy-700)" fillOpacity="0.06" />
          <path d={line} fill="none" stroke="var(--color-navy-700)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {[0, Math.floor(last / 2), last].map((i, n) => (
            <text key={n} x={x(i)} y={h - 6} fontSize="12" textAnchor={n === 0 ? 'start' : n === 2 ? 'end' : 'middle'} fill="var(--color-ink-500)">
              {periodShort(data[i]!.key)}
            </text>
          ))}
          {a && (
            <g pointerEvents="none">
              <line x1={x(active!)} x2={x(active!)} y1={top} y2={top + plotH} stroke="var(--color-ink-500)" strokeWidth="1" />
              <circle cx={x(active!)} cy={y(a.value)} r="4" fill="var(--color-navy-700)" stroke="#fff" strokeWidth="2" />
            </g>
          )}
        </svg>
      )}
      {a && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-ink-900 px-3 py-1.5 text-center text-xs whitespace-nowrap text-white shadow-md"
          style={{ left: Math.min(Math.max(x(active!), 64), w - 64), top: y(a.value) - 10 }}
        >
          <strong className="block text-sm num">{formatVnd(a.value)}</strong>
          {periodLong(a.key)}
        </div>
      )}
    </div>
  );
}

export const SalesReportsPage = () => <SectionsPage title="Báo cáo doanh thu" reports={SALES} />;
export const InventoryReportsPage = () => <SectionsPage title="Báo cáo kho & nhập hàng" reports={INVENTORY} />;
export const TaxReportsPage = () => <SectionsPage title="Báo cáo thuế & kiểm toán" reports={TAX} />;

/** All reports of an area on one page, each with its own filter and export (Design §12.6). */
function SectionsPage({ title, reports }: { title: string; reports: ReportDef[] }) {
  const { data: me } = useMe();
  const available = reports.filter((r) => !r.permission || can(me, r.permission));
  return (
    <>
      <PageHeader title={title} />
      {/* Sections parted by a thin rule (Design §12.6). */}
      <div className="flex flex-col divide-y divide-paper-300">
        {available.map((def) => (
          <section key={def.key} aria-labelledby={`${def.key}-title`} className="py-8 first:pt-0 last:pb-0">
            <ReportView def={def} timeParam={`time-${def.key.slice(def.key.indexOf('-') + 1)}`} lead={<h2 id={`${def.key}-title`} className="mr-auto text-lg font-semibold text-ink-900">{def.label}</h2>} />
          </section>
        ))}
      </div>
    </>
  );
}
const DEFAULT_TIME = '30d';

/** Toolbar (title, Bộ lọc, Xuất Excel), period line, chart and table for one report. */
function ReportView({ def, timeParam, lead }: { def: ReportDef; timeParam: string; lead: ReactNode }) {
  const { data: me } = useMe();
  // Reports always need a range: the list time filter without “Tất cả”, last 30 days by default.
  const [time, setTime] = useParam(timeParam, DEFAULT_TIME);
  const [from, to] = timeDays(time) ?? timeDays(DEFAULT_TIME)!;
  const [exporting, setExporting] = useState(false);
  const longRange = Date.parse(to) - Date.parse(from) > 92 * 86_400_000;
  const params = { ...def.params, ...(def.period && { groupBy: longRange ? 'month' : 'day' }), ...(def.range && { from, to }) };
  const t = useQuery({ queryKey: ['report', def.report, params], queryFn: () => get<Table>(`/api/v1/reports/${def.report}`, params) });

  const exportExcel = async () => {
    setExporting(true);
    try {
      const r = await post<{ url: string }>(`/api/v1/reports/${def.report}/export`, { format: 'xlsx', params });
      window.location.href = r.url;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {lead}
        {def.range && (
          <FilterMenu
            groups={[{ kind: 'custom', label: 'Thời gian', summary: timeLabel(time), active: time !== DEFAULT_TIME, onClear: () => setTime(DEFAULT_TIME), content: <TimeFilter value={time} onChange={setTime} allowAll={false} /> }]}
          />
        )}
        {can(me, 'report.export') && (
          <Button variant="secondary" icon={Download} loading={exporting} onClick={() => void exportExcel()}>
            Xuất Excel
          </Button>
        )}
      </div>
      {t.isError ? (
        <ErrorState error={t.error} onRetry={() => t.refetch()} />
      ) : !t.data ? (
        <Skeleton className="h-64" />
      ) : t.data.rows.length === 0 ? (
        <EmptyState icon={BarChart3} title="Không có dữ liệu trong khoảng này" />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Only the period: the dropdown or section title already names the report (Design §12.6). */}
          {t.data.from && (
            <p className="text-sm text-ink-500">
              Từ {formatDate(t.data.from)} đến {formatDate(t.data.to)}
            </p>
          )}
          {def.period && <RevenueChart table={t.data} byMonth={longRange} />}
          <div className="overflow-hidden rounded-lg border border-paper-300 bg-white">
            <div className="max-h-[640px] overflow-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="sticky top-0 bg-paper-200 text-[13px] font-semibold text-ink-700">
                  <tr className="h-11">
                    {t.data.columns.map((c) => (
                      <th key={c.key} className={c.type === 'text' || c.type === 'date' || c.type === 'datetime' ? 'px-4 text-left' : 'px-4 text-right'}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-300">
                  {t.data.rows.map((r, i) => (
                    <tr key={i} className="h-11 hover:bg-navy-50">
                      {t.data!.columns.map((c) => (
                        <td key={c.key} className={c.type === 'text' || c.type === 'date' || c.type === 'datetime' ? 'px-4' : 'px-4 text-right num'}>
                          {cell(c.type, r[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {t.data.totals && (
                    <tr className="h-11 bg-paper-200 font-semibold">
                      {t.data.columns.map((c, i) => (
                        <td key={c.key} className={i === 0 || c.type === 'text' ? 'px-4' : 'px-4 text-right num'}>
                          {i === 0 ? 'Tổng' : t.data!.totals![c.key] == null ? '' : cell(c.type, t.data!.totals![c.key])}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
