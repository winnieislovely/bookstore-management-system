import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { useState } from 'react';
import { SelectField, toast, useParam } from '../components/data';
import { Button, Card, EmptyState, ErrorState, Field, PageHeader, Skeleton } from '../components/ui';
import { get, post } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, formatVnd, formatVndCompact, storeToday } from '../lib/format';
import { can, useMe } from '../lib/session';

/** Reports (FR-RPT-02..05, FR-RPT-10, Design §12.6): filter bar, summary, chart, table, export. */

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
  permission?: string;
}

const REPORTS: ReportDef[] = [
  { key: 'sales-day', label: 'Doanh thu theo ngày', report: 'sales', params: { groupBy: 'day' }, range: true },
  { key: 'sales-month', label: 'Doanh thu theo tháng', report: 'sales', params: { groupBy: 'month' }, range: true },
  { key: 'sales-item', label: 'Doanh thu theo sản phẩm', report: 'sales', params: { groupBy: 'item' }, range: true },
  { key: 'sales-category', label: 'Doanh thu theo danh mục', report: 'sales', params: { groupBy: 'category' }, range: true },
  { key: 'sales-cashier', label: 'Doanh thu theo thu ngân', report: 'sales', params: { groupBy: 'cashier' }, range: true },
  { key: 'sales-payment', label: 'Doanh thu theo phương thức', report: 'sales', params: { groupBy: 'payment' }, range: true },
  { key: 'sales-customer', label: 'Doanh thu theo khách hàng', report: 'sales', params: { groupBy: 'customer' }, range: true },
  { key: 'inv-stock', label: 'Tồn kho hiện tại', report: 'inventory', params: { view: 'stock' }, range: false },
  { key: 'inv-movements', label: 'Nhập – xuất – tồn', report: 'inventory', params: { view: 'movements' }, range: true },
  { key: 'inv-slow', label: 'Hàng bán chậm (90 ngày)', report: 'inventory', params: { view: 'slow' }, range: false },
  { key: 'inv-counts', label: 'Chênh lệch kiểm kho', report: 'inventory', params: { view: 'counts' }, range: true },
  { key: 'inv-consignment', label: 'Hàng ký gửi', report: 'inventory', params: { view: 'consignment' }, range: false },
  { key: 'pur-stockins', label: 'Phiếu nhập hàng', report: 'purchasing', params: { view: 'stock_ins' }, range: true },
  { key: 'pur-payables', label: 'Công nợ nhà cung cấp', report: 'purchasing', params: { view: 'payables' }, range: false, permission: 'purchasing.payables' },
  { key: 'tax-vat', label: 'Thuế GTGT đầu ra', report: 'tax', params: { view: 'vat' }, range: true },
  { key: 'tax-einvoices', label: 'Hóa đơn điện tử', report: 'tax', params: { view: 'einvoices' }, range: true },
  { key: 'tax-shifts', label: 'Ca làm và chênh lệch tiền', report: 'tax', params: { view: 'shifts' }, range: true },
];

const monthStart = () => `${storeToday().slice(0, 8)}01`;

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
      return String(v);
  }
}

/** Simple bar chart of the first money column (Design §4.7 data-viz palette, navy series). */
function Bars({ table }: { table: Table }) {
  const col = table.columns.find((c) => c.type === 'vnd');
  const label = table.columns[0];
  if (!col || !label || table.rows.length < 2) return null;
  const rows = table.rows.slice(0, 31);
  const max = Math.max(...rows.map((r) => Number(r[col.key] ?? 0)), 1);
  return (
    <Card title={col.label}>
      <div className="flex h-48 items-end gap-1" role="img" aria-label={`Biểu đồ ${col.label}`}>
        {rows.map((r, i) => {
          const v = Number(r[col.key] ?? 0);
          return (
            <div key={i} className="group relative flex h-full flex-1 flex-col justify-end">
              <div className="rounded-t-sm bg-navy-700" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0 }} />
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink-900 px-2 py-1 text-xs text-white group-hover:block">
                {String(r[label.key])}: {formatVndCompact(v)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function ReportsPage() {
  const { data: me } = useMe();
  const available = REPORTS.filter((r) => !r.permission || can(me, r.permission));
  const [key, setKey] = useParam('report', available[0]!.key);
  const def = available.find((r) => r.key === key) ?? available[0]!;
  const [from, setFrom] = useParam('from', monthStart());
  const [to, setTo] = useParam('to', storeToday());
  const [exporting, setExporting] = useState(false);
  const params = { ...def.params, ...(def.range && { from, to }) };
  const t = useQuery({ queryKey: ['report', def.report, params], queryFn: () => get<Table>(`/api/v1/reports/${def.report}`, params) });

  const exportAs = async (format: 'xlsx' | 'csv') => {
    setExporting(true);
    try {
      const r = await post<{ url: string }>(`/api/v1/reports/${def.report}/export`, { format, params });
      window.location.href = r.url;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Báo cáo"
        actions={
          can(me, 'report.export') && (
            <>
              <Button variant="secondary" icon={Download} loading={exporting} onClick={() => void exportAs('xlsx')}>
                Xuất Excel
              </Button>
              <Button variant="ghost" onClick={() => void exportAs('csv')}>
                CSV
              </Button>
            </>
          )
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-[minmax(0,2fr)_1fr_1fr]">
        <SelectField label="Báo cáo" value={def.key} onChange={(e) => setKey(e.target.value)}>
          {available.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </SelectField>
        {def.range && (
          <>
            <Field label="Từ ngày" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Field label="Đến ngày" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
      </div>
      {t.isError ? (
        <ErrorState error={t.error} onRetry={() => t.refetch()} />
      ) : !t.data ? (
        <Skeleton className="h-64" />
      ) : t.data.rows.length === 0 ? (
        <EmptyState icon={BarChart3} title="Không có dữ liệu trong khoảng này" />
      ) : (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-ink-500">
            {t.data.title}
            {t.data.from && ` · Từ ${formatDate(t.data.from)} đến ${formatDate(t.data.to)}`}
          </p>
          {t.data.totals && (
            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {t.data.columns
                .filter((c) => t.data!.totals![c.key] != null && c.type !== 'text' && c.type !== 'date')
                .slice(0, 4)
                .map((c) => (
                  <div key={c.key} className="rounded-lg border border-paper-300 bg-white p-4">
                    <p className="text-[13px] text-ink-500">{c.label}</p>
                    <p className="font-display text-[26px] leading-8 font-semibold text-navy-700 num">{c.type === 'vnd' ? formatVndCompact(Number(t.data!.totals![c.key])) : cell(c.type, t.data!.totals![c.key])}</p>
                  </div>
                ))}
            </div>
          )}
          {(def.params.groupBy === 'day' || def.params.groupBy === 'month') && <Bars table={t.data} />}
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
