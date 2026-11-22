import { ChevronDown, Download } from 'lucide-react';
import { useState } from 'react';
import { TimeFilter, timeDays, timeLabel } from '../components/data';
import { Button, EmptyState, InlineAlert, PageHeader } from '../components/ui';
import { post } from '../lib/api';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';

/**
 * Reports (FR-RPT-02..05, FR-RPT-10, Design §12.6): each page lists its reports by name; tapping one opens a
 * dialog with the date range and Xuất Excel. The report tables are not shown on screen.
 */

interface ReportDef {
  key: string;
  label: string;
  /** One line under the name and in the dialog. */
  help: string;
  report: 'sales' | 'inventory' | 'tax' | 'purchasing';
  params: Record<string, string>;
  range: boolean;
  /** By day, or by month when the range is longer than 92 days (Design §12.6). */
  period?: boolean;
}

const SALES: ReportDef[] = [
  { key: 'sales-period', label: 'Theo thời gian', help: 'Doanh thu theo ngày, hoặc theo tháng khi khoảng dài hơn 92 ngày.', report: 'sales', params: {}, range: true, period: true },
  { key: 'sales-item', label: 'Theo sản phẩm', help: 'Số lượng bán, doanh thu, giảm giá và trả hàng của từng sản phẩm.', report: 'sales', params: { groupBy: 'item' }, range: true },
  { key: 'sales-customer', label: 'Theo khách hàng', help: 'Số đơn và doanh thu của từng khách hàng.', report: 'sales', params: { groupBy: 'customer' }, range: true },
  // By channel moved here from the dashboard (FR-RPT-02, FR-SOC-02).
  { key: 'sales-channel', label: 'Theo kênh', help: 'Doanh thu tại quầy và theo từng nguồn đơn online.', report: 'sales', params: { groupBy: 'channel' }, range: true },
];

// Purchasing reports sit with inventory (Design §12.6): only stock-ins remain.
const INVENTORY: ReportDef[] = [
  { key: 'inv-stock', label: 'Tồn kho hiện tại', help: 'Tồn, đang giữ và có thể bán của từng sản phẩm tại lúc xuất.', report: 'inventory', params: { view: 'stock' }, range: false },
  { key: 'inv-movements', label: 'Nhập – xuất – tồn', help: 'Số lượng nhập và xuất theo từng loại phát sinh.', report: 'inventory', params: { view: 'movements' }, range: true },
  { key: 'pur-stockins', label: 'Phiếu nhập hàng', help: 'Số phiếu và số lượng nhập theo từng nhà cung cấp.', report: 'purchasing', params: { view: 'stock_ins' }, range: true },
];

const TAX: ReportDef[] = [
  { key: 'tax-vat', label: 'Thuế GTGT đầu ra', help: 'Doanh thu và thuế GTGT theo từng thuế suất.', report: 'tax', params: { view: 'vat' }, range: true },
  { key: 'tax-einvoices', label: 'Hóa đơn điện tử', help: 'Bảng kê hóa đơn điện tử: số hóa đơn, người mua, tiền và thuế.', report: 'tax', params: { view: 'einvoices' }, range: true },
  { key: 'tax-shifts', label: 'Ca làm và chênh lệch tiền', help: 'Tiền đầu ca, dự kiến, thực đếm và chênh lệch của từng ca.', report: 'tax', params: { view: 'shifts' }, range: true },
];

export const SalesReportsPage = () => <ReportListPage title="Báo cáo doanh thu" reports={SALES} />;
export const InventoryReportsPage = () => <ReportListPage title="Báo cáo kho & nhập hàng" reports={INVENTORY} />;
export const TaxReportsPage = () => <ReportListPage title="Báo cáo thuế & kiểm toán" reports={TAX} />;

/** The reports of an area as rows; each opens its export dialog (Design §12.6). */
function ReportListPage({ title, reports }: { title: string; reports: ReportDef[] }) {
  const { data: me } = useMe();
  const [open, setOpen] = useState<ReportDef | null>(null);
  return (
    <>
      <PageHeader title={title} />
      {can(me, 'report.export') ? (
        <ul className="divide-y divide-paper-300 overflow-hidden rounded-lg border border-paper-300 bg-white shadow-sm">
          {reports.map((def) => (
            <li key={def.key}>
              <button type="button" className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left hover:bg-navy-50" onClick={() => setOpen(def)}>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink-900">{def.label}</span>
                  <span className="block text-sm text-ink-500">{def.help}</span>
                </span>
                <Download size={18} className="shrink-0 text-ink-500" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={Download} title="Bạn chưa có quyền xuất báo cáo." />
      )}
      {open && <ExportDialog def={open} onClose={() => setOpen(null)} />}
    </>
  );
}

const DEFAULT_TIME = '30d';

/** Thời gian (no “Tất cả”, 30 ngày qua by default), then Hủy / Xuất Excel (Design §12.6). */
function ExportDialog({ def, onClose }: { def: ReportDef; onClose: () => void }) {
  const [time, setTime] = useState(DEFAULT_TIME);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportExcel = async () => {
    const [from, to] = timeDays(time) ?? timeDays(DEFAULT_TIME)!;
    const longRange = Date.parse(to) - Date.parse(from) > 92 * 86_400_000;
    const params = { ...def.params, ...(def.period && { groupBy: longRange ? 'month' : 'day' }), ...(def.range && { from, to }) };
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ url: string }>(`/api/v1/reports/${def.report}/export`, { format: 'xlsx', params });
      window.location.href = r.url;
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={def.label}
      size="sm"
      onClose={onClose}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" full onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" full icon={Download} loading={busy} onClick={() => void exportExcel()}>
            Xuất Excel
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-ink-700">{def.help}</p>
        {def.range ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              aria-expanded={picking}
              onClick={() => setPicking((v) => !v)}
              className="flex h-10 items-center justify-between gap-3 rounded-md border border-paper-500 bg-white px-3 text-left"
            >
              <span className="text-ink-700">Thời gian</span>
              <span className="flex items-center gap-1 font-medium text-ink-900">
                {timeLabel(time)}
                <ChevronDown size={16} className={picking ? 'rotate-180 text-ink-500' : 'text-ink-500'} aria-hidden />
              </span>
            </button>
            {picking && <TimeFilter value={time} onChange={setTime} allowAll={false} />}
          </div>
        ) : (
          <p className="text-ink-500">Tệp chứa số tồn tại thời điểm xuất.</p>
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}
