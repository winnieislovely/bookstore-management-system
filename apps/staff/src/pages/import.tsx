import { clsx } from 'clsx';
import { Check, Download, FileSpreadsheet, ImageOff, Undo2, Upload } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, SelectField, toast, useParam } from '../components/data';
import { Button, Card, InlineAlert, PageHeader, StatusChip } from '../components/ui';
import { ApiError, post } from '../lib/api';
import { formatNumber, formatVnd } from '../lib/format';
import { can, useMe } from '../lib/session';

/** Import wizard (FR-CAT-11, FR-PUR-14, FR-ADM-07, Design §12.10): Tải tệp → Kiểm tra → Xem trước → Nhập. */

type Kind = 'products' | 'stock_in' | 'customers';
const KIND_LABEL: Record<Kind, string> = { products: 'Sản phẩm (kèm tồn đầu kỳ)', stock_in: 'Phiếu nhập hàng', customers: 'Khách hàng (kèm điểm)' };
const STEPS = ['Tải tệp', 'Kiểm tra', 'Xem trước', 'Nhập'];

interface Issue {
  column: string;
  value: string;
  message: string;
}
interface Preview {
  jobId: string;
  kind: Kind;
  summary: { rows: number; errorRows: number; warningRows: number; newProducts: number; existingProducts: number; totalCostVnd: number; supplier: string | null; unmappedHeaders: string[]; missingColumns: string[] };
  rows: { rowNo: number; tag: 'new' | 'existing' | 'customer'; sku?: string; name?: string; errors: Issue[]; warnings: Issue[] }[];
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function uploadPreview(kind: Kind, file: File): Promise<Preview> {
  const mime = file.type || (file.name.endsWith('.csv') ? 'text/csv' : XLSX);
  const res = await fetch(`/api/v1/admin/import/${kind}/preview`, { method: 'POST', credentials: 'same-origin', headers: { 'x-bms-request': '1', 'content-type': mime }, body: file }).catch(() => {
    throw new ApiError(0, 'network_error', 'Mất kết nối. Hãy thử lại.');
  });
  const body = (await res.json()) as Preview & { error?: { code: string; message: string; details?: unknown } };
  if (!res.ok) throw new ApiError(res.status, body.error?.code ?? 'http_error', body.error?.message ?? '', body.error?.details);
  return body;
}

/** Standalone “Nhập dữ liệu” page: any import kind the user may run. */
export function ImportPage() {
  const { data: me } = useMe();
  const allowed = (['products', 'stock_in', 'customers'] as Kind[]).filter((k) => can(me, k === 'customers' ? 'data.import' : 'catalog.import'));
  const [kindParam, setKindParam] = useParam('kind', allowed[0] ?? 'products');
  const kind = (allowed.includes(kindParam as Kind) ? kindParam : allowed[0]) as Kind;
  return (
    <>
      <PageHeader title="Nhập dữ liệu" />
      <ImportWizard kind={kind} kinds={allowed} onKindChange={(k) => setKindParam(k)} />
    </>
  );
}

/**
 * The wizard itself. With `kinds`/`onKindChange` it offers a data-type choice; without, the kind is
 * fixed (e.g. products, inside a dialog on the Products page, Design §12.10).
 */
export function ImportWizard({ kind, kinds, onKindChange, onImported }: { kind: Kind; kinds?: Kind[]; onKindChange?: (k: Kind) => void; onImported?: () => void }) {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [rollback, setRollback] = useState(false);

  const restart = () => {
    setStep(0);
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const check = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setStep(1);
    try {
      const p = await uploadPreview(kind, file);
      setPreview(p);
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
      setStep(0);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    setError(null);
    setStep(3);
    try {
      const r = await post<Record<string, unknown>>(`/api/v1/admin/import/jobs/${preview!.jobId}/commit`);
      setResult(r);
      toast.success('Đã nhập dữ liệu.');
      onImported?.();
    } catch (e) {
      setError((e as Error).message);
      setStep(2);
    } finally {
      setBusy(false);
    }
  };

  const rows = preview ? (onlyErrors ? preview.rows.filter((r) => r.errors.length) : preview.rows) : [];
  const s = preview?.summary;

  return (
    <>
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Các bước">
        {STEPS.map((label, i) => (
          <li key={label} className={clsx('inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm', i === step ? 'bg-navy-700 text-white' : i < step ? 'bg-success-50 text-success-700' : 'bg-paper-200 text-ink-500')} aria-current={i === step ? 'step' : undefined}>
            {i < step ? <Check size={16} aria-hidden /> : <span className="num">{i + 1}</span>} {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <div className="flex max-w-xl flex-col gap-4">
            {kinds && onKindChange && (
              <SelectField label="Loại dữ liệu" value={kind} onChange={(e) => (onKindChange(e.target.value as Kind), restart())}>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </SelectField>
            )}
            <a className="inline-flex items-center gap-2 text-sm text-navy-700 underline" href={`/api/v1/admin/import/${kind}/template`}>
              <Download size={16} aria-hidden /> Tải file mẫu
            </a>
            {kind !== 'customers' && (
              <InlineAlert tone="info">
                Mẫu có cột SKU (bắt buộc) và ISBN (không bắt buộc) riêng. Ảnh không nhập qua Excel: sản phẩm mới được đánh dấu “Thiếu ảnh” để thêm ảnh sau.
              </InlineAlert>
            )}
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-paper-500 px-6 py-10 text-center hover:bg-navy-50">
              <FileSpreadsheet size={40} className="text-ink-300" aria-hidden />
              <span className="font-medium">{file ? file.name : 'Chọn tệp Excel (.xlsx) hoặc CSV'}</span>
              <span className="text-[13px] text-ink-500">Tối đa 10 MB, 20.000 dòng</span>
              <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            {error && <InlineAlert tone="danger">{error}</InlineAlert>}
            <Button variant="primary" icon={Upload} disabled={!file} loading={busy} onClick={check} className="self-start">
              Kiểm tra tệp
            </Button>
          </div>
        </Card>
      )}

      {step === 1 && <Card><p className="text-ink-700">Đang đọc và kiểm tra từng dòng…</p></Card>}

      {step >= 2 && preview && s && (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-base num">
              {kind === 'stock_in' && <>1 phiếu nhập · </>}
              {formatNumber(s.rows)} dòng
              {kind !== 'customers' && (
                <>
                  {' '}
                  · {formatNumber(s.newProducts)} sản phẩm mới · {formatNumber(s.existingProducts)} cộng tồn
                </>
              )}
              {kind === 'stock_in' && <> · tổng giá nhập {formatVnd(s.totalCostVnd)}</>}
              {s.supplier && <> · NCC {s.supplier}</>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {s.errorRows > 0 ? <StatusChip tone="danger">{formatNumber(s.errorRows)} dòng lỗi</StatusChip> : <StatusChip tone="success">Không có lỗi</StatusChip>}
              {s.warningRows > 0 && <StatusChip tone="warning">{formatNumber(s.warningRows)} dòng cần lưu ý</StatusChip>}
            </div>
            {s.unmappedHeaders.length > 0 && (
              <p className="mt-3 text-[13px] text-ink-500">
                Bỏ qua cột không nhận ra: {s.unmappedHeaders.join(', ')}
              </p>
            )}
          </Card>

          {result ? (
            <Card title="Đã nhập xong">
              <div className="flex flex-col gap-3">
                <p className="text-ink-700 num">
                  {Object.entries(result)
                    .filter(([k, v]) => typeof v === 'number' && k !== 'rows')
                    .map(([k, v]) => `${({ created: 'Tạo mới', openingUnits: 'Tồn đầu kỳ', newProducts: 'Sản phẩm mới', totalCostVnd: 'Tổng giá nhập', points: 'Điểm' } as Record<string, string>)[k] ?? k}: ${formatNumber(v as number)}`)
                    .join(' · ') || `${formatNumber(s.rows)} dòng đã nhập.`}
                  {typeof result.entryNo === 'string' && ` · Phiếu ${result.entryNo}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={restart}>
                    Nhập tệp khác
                  </Button>
                  {kind !== 'customers' && (
                    <Button variant="destructive-outline" icon={Undo2} onClick={() => setRollback(true)}>
                      Hoàn tác lượt nhập
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-5" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
                Chỉ hiện dòng lỗi
              </label>
              {s.errorRows > 0 && (
                <a className="inline-flex h-10 items-center gap-2 rounded-full border border-paper-500 px-4 text-sm hover:bg-navy-50" href={`/api/v1/admin/import/jobs/${preview.jobId}/errors`}>
                  <Download size={18} aria-hidden /> Tải báo cáo lỗi
                </a>
              )}
              <span className="flex-1" />
              <Button variant="secondary" onClick={restart}>
                Chọn tệp khác
              </Button>
              <Button variant="primary" loading={busy} disabled={s.errorRows > 0} onClick={commit}>
                {kind === 'stock_in' ? 'Xác nhận nhập hàng' : 'Nhập dữ liệu'}
              </Button>
            </div>
          )}
          {s.errorRows > 0 && !result && <InlineAlert tone="danger">Sửa các dòng lỗi trong tệp rồi tải lên lại. Lượt nhập ghi tất cả các dòng hoặc không dòng nào.</InlineAlert>}
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}

          <div className="overflow-hidden rounded-lg border border-paper-300 bg-white shadow-sm">
            <div className="max-h-[560px] overflow-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 bg-paper-200 text-[13px] font-semibold text-ink-700">
                  <tr className="h-11">
                    <th className="w-16 px-4 text-right">Dòng</th>
                    {kind !== 'customers' && <th className="px-4 text-left">SKU</th>}
                    <th className="px-4 text-left">Tên</th>
                    <th className="px-4 text-left">Loại</th>
                    <th className="px-4 text-left">Kiểm tra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper-300">
                  {rows.slice(0, 500).map((r) => (
                    <tr key={r.rowNo} className={r.errors.length ? 'bg-danger-50' : r.warnings.length ? 'bg-warning-50/50' : ''}>
                      <td className="px-4 py-2 text-right num">{r.rowNo}</td>
                      {kind !== 'customers' && <td className="px-4 py-2 code">{r.sku ?? ''}</td>}
                      <td className="px-4 py-2">{r.name ?? ''}</td>
                      <td className="px-4 py-2">{r.tag === 'new' ? <StatusChip tone="accent">Sản phẩm mới</StatusChip> : r.tag === 'existing' ? <StatusChip tone="neutral">Cộng tồn</StatusChip> : null}</td>
                      <td className="px-4 py-2">
                        {r.errors.map((e, i) => (
                          <p key={`e${i}`} className="text-danger-700">
                            {e.column}: {e.message} {e.value && <span className="code">“{e.value}”</span>}
                          </p>
                        ))}
                        {r.warnings.map((w, i) =>
                          w.message.startsWith('Thiếu ảnh') ? (
                            <StatusChip key={`w${i}`} tone="neutral" icon={ImageOff}>
                              Thiếu ảnh
                            </StatusChip>
                          ) : (
                            <p key={`w${i}`} className="text-warning-700">
                              {w.column}: {w.message}
                            </p>
                          ),
                        )}
                        {!r.errors.length && !r.warnings.length && <Check size={16} className="text-success-700" aria-label="Hợp lệ" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 500 && <p className="border-t border-paper-300 px-4 py-2 text-[13px] text-ink-500">Hiện 500 dòng đầu. Tải báo cáo lỗi để xem tất cả dòng lỗi.</p>}
          </div>
        </div>
      )}
      {rollback && preview && (
        <ConfirmDialog
          title="Hoàn tác lượt nhập?"
          body="Xóa các sản phẩm vừa tạo và trừ lại tồn đã cộng, nếu chưa có bán hàng hay chứng từ nào dùng đến chúng."
          confirm="Hoàn tác"
          destructive
          onClose={() => setRollback(false)}
          onConfirm={async () => {
            await post(`/api/v1/admin/import/jobs/${preview.jobId}/rollback`);
            toast.success('Đã hoàn tác lượt nhập.');
            restart();
          }}
        />
      )}
    </>
  );
}
