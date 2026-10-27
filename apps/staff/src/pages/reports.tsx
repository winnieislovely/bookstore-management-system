import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { useState } from 'react';
import { FilterMenu, SelectField, TimeFilter, timeDays, timeLabel, toast, useParam } from '../components/data';
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { get, post } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, formatVnd, formatVndCompact } from '../lib/format';
import { can, useMe } from '../lib/session';

/** Reports (FR-RPT-02..05, FR-RPT-10, Design §12.6): one page per area, a report dropdown; chart, table with totals, Excel export. */

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
  { key: 'sales-category', label: 'Theo danh mục', report: 'sales', params: { groupBy: 'category' }, range: true },
  { key: 'sales-payment', label: 'Theo phương thức', report: 'sales', params: { groupBy: 'payment' }, range: true },
  { key: 'sales-customer', label: 'Theo khách hàng', report: 'sales', params: { groupBy: 'customer' }, range: true },
];

// Purchasing reports sit with inventory (Design §12.6): only stock-ins remain.
const INVENTORY: ReportDef[] = [
  { key: 'inv-stock', label: 'Tồn kho hiện tại', report: 'inventory', params: { view: 'stock' }, range: false },
  { key: 'inv-movements', label: 'Nhập – xuất – tồn', report: 'inventory', params: { view: 'movements' }, range: true },
  { key: 'inv-slow', label: 'Hàng bán chậm (90 ngày)', report: 'inventory', params: { view: 'slow' }, range: false },
  { key: 'inv-counts', label: 'Chênh lệch kiểm kho', report: 'inventory', params: { view: 'counts' }, range: true },
  { key: 'inv-consignment', label: 'Hàng ký gửi', report: 'inventory', params: { view: 'consignment' }, range: false },
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

/** Simple bar chart of the first money column (Design §4.7 data-viz palette, navy series). */
function Bars({ table }: { table: Table }) {
  const col = table.columns.find((c) => c.type === 'vnd');
  const label = table.columns[0];
  if (!col || !label || table.rows.length < 2) return null;
  // At most 93 days or 13 months (period report), so every row gets a bar.
  const rows = table.rows;
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

export const SalesReportsPage = () => <ReportsPage title="Báo cáo doanh thu" reports={SALES} defaultTime="30d" />;
export const InventoryReportsPage = () => <ReportsPage title="Báo cáo kho & nhập hàng" reports={INVENTORY} />;
export const TaxReportsPage = () => <ReportsPage title="Báo cáo thuế & kiểm toán" reports={TAX} />;

function ReportsPage({ title, reports, defaultTime = 'thisMonth' }: { title: string; reports: ReportDef[]; defaultTime?: string }) {
  const { data: me } = useMe();
  const available = reports.filter((r) => !r.permission || can(me, r.permission));
  const [key, setKey] = useParam('report', available[0]!.key);
  const def = available.find((r) => r.key === key) ?? available[0]!;
  // Reports always need a range: the list time filter without “Tất cả”.
  const [time, setTime] = useParam('time', defaultTime);
  const [from, to] = timeDays(time) ?? timeDays(defaultTime)!;
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
      <PageHeader
        title={title}
        actions={
          can(me, 'report.export') && (
            <Button variant="secondary" icon={Download} loading={exporting} onClick={() => void exportExcel()}>
              Xuất Excel
            </Button>
          )
        }
      />
      <div className="mb-6 flex items-end gap-3">
        <SelectField label="Báo cáo" className="w-full max-w-sm" value={def.key} onChange={(e) => setKey(e.target.value)}>
          {available.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </SelectField>
        {def.range && (
          <FilterMenu
            groups={[{ kind: 'custom', label: 'Thời gian', summary: timeLabel(time), active: time !== defaultTime, onClear: () => setTime(defaultTime), content: <TimeFilter value={time} onChange={setTime} allowAll={false} /> }]}
          />
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
          {def.period && <Bars table={t.data} />}
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
