import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { get } from '../lib/api';
import { formatDate, formatNumber, formatVnd, formatVndCompact } from '../lib/format';
import { t } from '../lib/i18n';
import { useMe } from '../lib/session';

/** Dashboard (FR-RPT-01, Design §12.5): figures, charts and lists only — no alert tiles. */

interface Totals {
  grossVnd: number;
  returnsVnd: number;
  netVnd: number;
  orders: number;
  averageBasketVnd: number;
}
interface Dashboard {
  today: Totals;
  week: Totals;
  month: Totals;
  trend: { day: string; grossVnd: number }[];
  salesByChannel: { channel: string; grossVnd: number }[];
  bestsellers: { variantId: string; sku: string; title: string; units: number; grossVnd: number }[];
  lowStock?: { variantId: string; sku: string; title: string; available: number; minStock: number }[];
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

function greeting(name: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()));
  const key = h < 11 ? 'dashboard.greeting.morning' : h < 18 ? 'dashboard.greeting.afternoon' : 'dashboard.greeting.evening';
  return t(key, { name });
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-paper-300 bg-white p-4 sm:p-6">
      <p className="text-[13px] text-ink-500">{label}</p>
      <p className="mt-1 text-[28px] leading-9 font-semibold num text-ink-900">{value}</p>
      {sub && <p className="mt-1 text-[13px] text-ink-500 num">{sub}</p>}
    </div>
  );
}

/** Revenue trend: bars in navy with a direct label on the latest day (Design §4.7). */
function TrendChart({ data }: { data: Dashboard['trend'] }) {
  if (!data.length) return <p className="text-ink-500">{t('dashboard.noData')}</p>;
  const max = Math.max(...data.map((d) => d.grossVnd), 1);
  const w = 600;
  const h = 160;
  const bw = w / data.length;
  const last = data[data.length - 1]!;
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h + 20}`} className="h-48 w-full" role="img" aria-label={`${t('dashboard.trend')}: ${data.map((d) => `${formatDate(d.day)} ${formatVnd(d.grossVnd)}`).join('; ')}`}>
        <line x1="0" x2={w} y1={h} y2={h} stroke="var(--color-paper-300)" />
        {data.map((d, i) => {
          const bh = (d.grossVnd / max) * (h - 16);
          return <rect key={d.day} x={i * bw + bw * 0.15} y={h - bh} width={bw * 0.7} height={bh} rx="2" fill="var(--color-navy-700)" />;
        })}
        <text x={w - 4} y={12} textAnchor="end" fontSize="12" fill="var(--color-ink-900)" className="num">
          {formatVndCompact(last.grossVnd)}
        </text>
        <text x="0" y={h + 16} fontSize="12" fill="var(--color-ink-500)">
          {formatDate(data[0]!.day)}
        </text>
        <text x={w} y={h + 16} fontSize="12" textAnchor="end" fill="var(--color-ink-500)">
          {formatDate(last.day)}
        </text>
      </svg>
    </figure>
  );
}

function ChannelBars({ data }: { data: Dashboard['salesByChannel'] }) {
  const total = data.reduce((a, d) => a + d.grossVnd, 0);
  if (!total) return <p className="text-ink-500">{t('dashboard.noData')}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {data.map((d) => (
        <li key={d.channel}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-ink-700">{CHANNEL_LABEL[d.channel] ?? d.channel}</span>
            <span className="num text-ink-900">
              {formatVnd(d.grossVnd)} · {Math.round((d.grossVnd / total) * 100)}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-paper-200">
            <div className="h-2 rounded-full" style={{ width: `${(d.grossVnd / total) * 100}%`, background: CHANNEL_COLOR[d.channel] ?? 'var(--color-paper-500)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DashboardPage() {
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/api/v1/reports/dashboard'), refetchInterval: 60_000 });
  const today = new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());

  return (
    <>
      <PageHeader title={greeting(me?.displayName ?? '')} breadcrumb={today.charAt(0).toUpperCase() + today.slice(1)} />
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="grid grid-cols-12 gap-6">
          {(['today', 'week', 'month'] as const).map((period) => (
            <div key={period} className="col-span-12 md:col-span-6 xl:col-span-4">
              {q.data ? (
                <Kpi
                  label={`${t('dashboard.revenue')} · ${t(`dashboard.${period}`)}`}
                  value={formatVnd(q.data[period].grossVnd)}
                  sub={`${t('dashboard.ordersCount', { n: formatNumber(q.data[period].orders) })} · ${t('dashboard.basket')} ${formatVnd(q.data[period].averageBasketVnd)}`}
                />
              ) : (
                <Skeleton className="h-[124px]" />
              )}
            </div>
          ))}
          <Card title={t('dashboard.trend')} className="col-span-12 xl:col-span-8">
            {q.data ? <TrendChart data={q.data.trend} /> : <Skeleton className="h-48" />}
          </Card>
          <Card title={t('dashboard.byChannel')} className="col-span-12 xl:col-span-4">
            {q.data ? <ChannelBars data={q.data.salesByChannel} /> : <Skeleton className="h-48" />}
          </Card>
          <Card title={t('dashboard.bestsellers')} className="col-span-12 lg:col-span-6">
            {q.data?.bestsellers.length ? (
              <ol className="divide-y divide-paper-300">
                {q.data.bestsellers.map((b, i) => (
                  <li key={b.variantId} className="flex items-center gap-3 py-2">
                    <span className="w-5 text-ink-500 num">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{b.title}</span>
                    <span className="code text-xs text-ink-500">{b.sku}</span>
                    <span className="w-16 text-right num">{formatNumber(b.units)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-ink-500">{q.data ? t('dashboard.noData') : ''}</p>
            )}
          </Card>
          {q.data?.lowStock && (
            <Card title={t('dashboard.lowStock')} className="col-span-12 lg:col-span-6" action={<Link className="text-sm text-navy-700 underline-offset-2 hover:underline" to="/products?stock=low">{t('products.title')}</Link>}>
              {q.data.lowStock.length ? (
                <ul className="divide-y divide-paper-300">
                  {q.data.lowStock.map((l) => (
                    <li key={l.variantId} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 truncate">{l.title}</span>
                      <span className="code text-xs text-ink-500">{l.sku}</span>
                      <span className="w-20 text-right num text-warning-700">
                        {formatNumber(l.available)} / {formatNumber(l.minStock)}
                      </span>
                    </li>
                  ))}
                </ul>
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
