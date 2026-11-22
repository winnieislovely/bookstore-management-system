import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ClipboardList, Download, MoreVertical, Plus, ScanBarcode, Send, Upload, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ConfirmDialog, DataTable, errText, FilterMenu, SearchBox, TimeFilter, timeLabel, timeRange, toast, useListParam, useParam, type Column } from '../components/data';
import { Button, ErrorState, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { ApiError, get, post } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { can, useMe } from '../lib/session';
import { CompactMultiSelect } from '../components/compact-select';
import { Dialog } from '../pos/widgets';
import { ScanSession, type ScanOutcome } from '../components/scanSession';

/**
 * Stock counts (FR-INV-06, Design §13.8): scope by product type and category; counted quantities
 * typed on screen (up to 50 products) or via the Excel/CSV count sheet; no scanning; blind mode
 * hides expected quantities; cancellable until approved.
 */

const STATUS: Record<string, { tone: Tone; label: string }> = {
  open: { tone: 'info', label: 'Đang đếm' },
  submitted: { tone: 'warning', label: 'Chờ duyệt' },
  approved: { tone: 'success', label: 'Đã duyệt' },
  cancelled: { tone: 'neutral', label: 'Đã hủy' },
};
const Chip = ({ status }: { status: string }) => <StatusChip tone={STATUS[status]?.tone ?? 'neutral'}>{STATUS[status]?.label ?? status}</StatusChip>;

/** Counts above this many products are entered through the count sheet only (FR-INV-06). */
const SHEET_REQUIRED_ABOVE = 50;

const KINDS: [string, string][] = [
  ['book', 'Sách'],
  ['stationery', 'Văn phòng phẩm'],
  ['other', 'Sản phẩm khác'],
];
const KIND_LABEL = Object.fromEntries(KINDS) as Record<string, string>;

interface CountRow {
  id: string;
  docNo: string;
  scope: { kind: string; itemKinds?: string[]; categoryIds?: string[] };
  blind: boolean;
  status: string;
  createdAt: string;
  createdBy: string | null;
  lines: number;
  counted: number;
}
const SCOPE: Record<string, string> = { full: 'Toàn bộ', category: 'Theo danh mục', variants: 'Sản phẩm chọn' };
const scopeLabel = (s: CountRow['scope']) =>
  s.kind === 'types' ? `${(s.itemKinds ?? []).map((k) => KIND_LABEL[k] ?? k).join(', ')}${s.categoryIds?.length ? ' · theo danh mục' : ''}` : (SCOPE[s.kind] ?? s.kind);

export function CountsPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useParam('q');
  const [statuses, setStatuses] = useListParam('status');
  const [time, setTime] = useParam('time');
  const query = { q: q || undefined, status: statuses.join(',') || undefined, ...timeRange(time) };
  const filtered = !!(q || statuses.length || time);
  const list = useQuery({ queryKey: ['counts', query], queryFn: () => get<{ items: CountRow[] }>('/api/v1/inventory/counts', query) });
  const columns: Column<CountRow>[] = [
    { header: 'Số phiếu', cell: (r) => <span className="code">{r.docNo}</span> },
    { header: 'Ngày', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.createdAt) },
    { header: 'Phạm vi', cell: (r) => `${scopeLabel(r.scope)}${r.blind ? ' · đếm mù' : ''}` },
    { header: 'Người tạo', cell: (r) => r.createdBy ?? '—' },
    { header: 'Đã đếm', align: 'right', cell: (r) => `${formatNumber(r.counted)}/${formatNumber(r.lines)}` },
    { header: 'Trạng thái', cell: (r) => <Chip status={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Kiểm kho"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Tạo phiếu kiểm
          </Button>
        }
      />
      {/* Search and filters (Design §13.8) */}
      <div className="mb-4 flex items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm số phiếu hoặc người tạo…" />
        <FilterMenu
          groups={[
            { kind: 'custom', label: 'Thời gian', summary: timeLabel(time), active: !!time, onClear: () => setTime(''), content: <TimeFilter value={time} onChange={setTime} /> },
            { label: 'Trạng thái', options: Object.entries(STATUS).map(([key, s]) => ({ key, label: s.label })), values: statuses, onChange: setStatuses },
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        onRow={(r) => navigate(`/counts/${r.id}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={filtered ? { icon: ClipboardList, title: 'Không có phiếu phù hợp', help: 'Thử bỏ bớt bộ lọc hoặc đổi từ khóa.' } : { icon: ClipboardList, title: 'Chưa có phiếu kiểm kho' }}
      />
      {creating && <CreateCount onClose={() => setCreating(false)} onCreated={(id) => navigate(`/counts/${id}`)} />}
    </>
  );
}

/** Scope = product types only, all by default (SRS FR-INV-06, Design §13.8). */
function CreateCount({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [kinds, setKinds] = useState<string[]>(['book', 'stationery', 'other']);
  const [blind, setBlind] = useState(true);
  return (
    <ConfirmDialog
      title="Tạo phiếu kiểm kho"
      confirm="Bắt đầu đếm"
      onClose={onClose}
      onConfirm={async () => {
        if (!kinds.length) throw new Error('Chọn ít nhất một loại sản phẩm.');
        const r = await post<{ id: string }>('/api/v1/inventory/counts', { scope: { kind: 'types', itemKinds: kinds }, blind });
        onCreated(r.id);
      }}
    >
      <div className="flex flex-col gap-4">
        {/* Loại sản phẩm: label left, a multi-tick dropdown right, all by default (Design §13.8). */}
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="text-ink-700">Loại sản phẩm</span>
          <CompactMultiSelect label="Loại sản phẩm" className="w-56 max-w-[60%]" values={kinds} options={KINDS} onChange={setKinds} />
        </div>
        <label className="inline-flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-[18px] accent-navy-700" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
          <span>
            Đếm mù
            <span className="block text-[13px] text-ink-500">Người đếm không thấy số tồn trên hệ thống.</span>
          </span>
        </label>
      </div>
    </ConfirmDialog>
  );
}

interface CountDetail extends CountRow {
  lines: never;
  approvedAt: string | null;
}
interface CountLine {
  variantId: string;
  sku: string;
  title: string;
  counted: number | null;
  expected?: number;
  variance?: number | null;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface ScanResult {
  variantId: string;
  sku: string;
  title: string;
  counted: number;
}

/** The count of the product just scanned, correctable at once (“Sửa”), e.g. after scanning one of 40 alike. */
function QtyFix({ counted, onSet }: { counted: number; onSet: (qty: number) => Promise<number> }) {
  const [value, setValue] = useState(String(counted));
  const [now, setNow] = useState(counted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qty = Number(value);
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-700"
      onSubmit={async (e) => {
        e.preventDefault();
        if (value === '' || qty === now) return;
        setBusy(true);
        setError(null);
        try {
          setNow(await onSet(qty));
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="flex items-center gap-2">
        Số đếm
        <input className="h-9 w-20 rounded-md border border-paper-500 bg-white px-2 text-right num text-ink-900 max-sm:text-base" inputMode="numeric" aria-label="Số đếm" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} />
      </label>
      <Button type="submit" variant="secondary" size="sm" disabled={busy || value === '' || qty === now}>
        Sửa
      </Button>
      {error && <span className="w-full text-danger-700">{error}</span>}
    </form>
  );
}

export function CountDetailPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const c = useQuery({ queryKey: ['count', id], queryFn: () => get<Omit<CountDetail, 'lines'> & { lines: CountLine[] }>(`/api/v1/inventory/counts/${id}`) });
  const [confirm, setConfirm] = useState<null | 'submit' | 'approve' | 'cancel'>(null);
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);
  const [scanMsg, setScanMsg] = useState<ScanOutcome | null>(null);
  // Latest scan handler for the keyboard listener below (set once the count is loaded).
  const scanCode = useRef<(code: string) => void>(() => undefined);
  const counting = c.data?.status === 'open' && !camera;
  /**
   * A hand scanner (Bluetooth or USB) types like a keyboard: a burst of keys ending in Enter. It works
   * anywhere on the page – there is no search field (Design §13.8); slow typing is not taken as a scan.
   */
  useEffect(() => {
    if (!counting) return;
    let buf = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const now = performance.now();
      if (now - last > 100) buf = '';
      last = now;
      if (e.key === 'Enter') {
        if (buf.length >= 4) {
          e.preventDefault();
          scanCode.current(buf);
        }
        buf = '';
      } else if (e.key.length === 1) {
        buf += e.key;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [counting]);
  const [uploading, setUploading] = useState(false);
  const [sheetResult, setSheetResult] = useState<{ tone: 'success' | 'danger'; text: string; rows?: { row: number; sku: string; message: string }[] } | null>(null);

  if (c.isError) return <ErrorState error={c.error} onRetry={() => c.refetch()} />;
  if (!c.data) return <Skeleton className="h-64" />;
  const x = c.data;
  const open = x.status === 'open';
  const sheetOnly = x.lines.length > SHEET_REQUIRED_ABOVE;
  const showExpected = x.lines.some((l) => l.expected !== undefined);
  const counted = x.lines.filter((l) => l.counted !== null).length;
  const rows = x.lines.filter((l) => (filter === 'uncounted' ? l.counted === null : filter === 'variance' ? !!l.variance : true));

  const setCount = async (line: CountLine, text: string) => {
    const qty = Number(text.replace(/\D/g, ''));
    if (text.trim() === '' || qty === line.counted) return;
    try {
      await post(`/api/v1/inventory/counts/${x.id}/lines`, { variantId: line.variantId, qty, mode: 'set' });
      await c.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  /** One scan: one more of the product, with its count correctable at once (Design §13.8). */
  const record = async (code: string): Promise<ScanOutcome> => {
    try {
      const r = await post<ScanResult>(`/api/v1/inventory/counts/${x.id}/scan`, { code });
      void c.refetch();
      return {
        tone: 'success',
        title: 'Đã đếm',
        lines: [`${r.sku} – ${r.title}`],
        extra: (
          <QtyFix
            key={`${r.variantId}-${r.counted}`}
            counted={r.counted}
            onSet={async (qty) => {
              const s = await post<ScanResult>(`/api/v1/inventory/counts/${x.id}/scan`, { code: r.sku, qty });
              void c.refetch();
              return s.counted;
            }}
          />
        ),
      };
    } catch (e) {
      const code409 = e instanceof ApiError && e.status === 409;
      return { tone: code409 ? 'warning' : 'danger', title: code409 ? 'Không có trong phiếu' : 'Không đếm được', lines: [errText(e)] };
    }
  };
  scanCode.current = (code) => void record(code.trim()).then(setScanMsg);

  const uploadSheet = async (file: File) => {
    setUploading(true);
    setSheetResult(null);
    const mime = file.name.toLowerCase().endsWith('.csv') ? 'text/csv' : XLSX;
    try {
      const res = await fetch(`/api/v1/inventory/counts/${x.id}/sheet`, { method: 'POST', credentials: 'same-origin', headers: { 'x-bms-request': '1', 'content-type': mime }, body: file });
      const body = (await res.json().catch(() => null)) as { updated?: number; counted?: number; error?: { code: string; message: string; details?: { rows?: { row: number; sku: string; message: string }[] } } } | null;
      if (!res.ok) {
        setSheetResult({ tone: 'danger', text: body?.error?.message ?? 'Không đọc được tệp.', ...(body?.error?.details?.rows && { rows: body.error.details.rows }) });
        return;
      }
      setSheetResult({ tone: 'success', text: `Đã cập nhật ${formatNumber(body?.updated ?? 0)} số đếm. Đã đếm ${formatNumber(body?.counted ?? 0)}/${formatNumber(x.lines.length)} sản phẩm.` });
      await c.refetch();
    } catch (e) {
      setSheetResult({ tone: 'danger', text: e instanceof ApiError ? e.message : 'Mất kết nối. Hãy thử lại.' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <PageHeader
        back={{ to: '/counts', label: 'Kiểm kho' }}
        title={x.docNo}
        // Every action in a ⋮ menu on the title row, like the library count (Design §13.8).
        menu={(open || x.status === 'submitted') && <Button variant="ghost" icon={MoreVertical} aria-label="Thao tác" title="Thao tác" onClick={() => setMenu(true)} />}
      />
      {!open && (
        <div className="mb-4">
          <Chip status={x.status} />
        </div>
      )}
      {/* One box: “Tiến độ”, the percentage counted and the bar; the camera scan button beside it (Design §13.8). */}
      <div className="mb-4 flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-paper-300 bg-white px-4 py-3 shadow-sm">
        <span className="flex items-center justify-between gap-3 text-sm font-semibold text-ink-900">
          Tiến độ
          <span className="num">{x.lines.length ? Math.floor((counted / x.lines.length) * 100) : 0}%</span>
        </span>
        <span className="block h-2 w-full overflow-hidden rounded-full bg-paper-200" aria-hidden>
          <span className="block h-full bg-navy-700" style={{ width: `${x.lines.length ? (counted / x.lines.length) * 100 : 0}%` }} />
        </span>
      </div>
      {open && (
        <button type="button" className="inline-flex size-12 shrink-0 items-center justify-center rounded-md text-navy-700 hover:bg-navy-50" aria-label="Quét mã bằng camera" title="Quét mã bằng camera" onClick={() => setCamera(true)}>
          <ScanBarcode size={28} aria-hidden />
        </button>
      )}
      </div>

      {open && (
        <div className="mb-6 flex flex-col gap-3 empty:hidden">
          {/* Continuous camera session: Tiếp tục after each product, Xong to finish (Design §13.8). */}
          {camera && (
            <ScanSession
              label="Quét mã sản phẩm"
              prompt="Đưa ISBN hoặc mã vạch sản phẩm vào khung"
              onScan={record}
              progress={`Đã đếm ${formatNumber(counted)}/${formatNumber(x.lines.length)}`}
              onClose={() => {
                setCamera(false);
                setScanMsg(null);
              }}
            />
          )}
          {scanMsg && (
            <InlineAlert tone={scanMsg.tone}>
              <span className="font-semibold">{scanMsg.title}</span>
              {scanMsg.lines?.map((l) => <span key={l}> – {l}</span>)}
              {scanMsg.extra}
            </InlineAlert>
          )}
          {sheetOnly && <InlineAlert tone="info">Phiếu có {formatNumber(x.lines.length)} sản phẩm (trên {SHEET_REQUIRED_ABOVE}): quét mã để đếm, hoặc tải phiếu đếm từ menu ⋮, điền cột “Đếm được” rồi tải lên lại.</InlineAlert>}
          {uploading && <p className="text-sm text-ink-500">Đang tải lên phiếu đếm…</p>}
          {sheetResult && (
            <InlineAlert tone={sheetResult.tone}>
              {sheetResult.text}
              {sheetResult.rows && (
                <ul className="mt-1 list-disc pl-5">
                  {sheetResult.rows.map((r) => (
                    <li key={r.row}>
                      Dòng {r.row} {r.sku && <span className="code">{r.sku}</span>}: {r.message}
                    </li>
                  ))}
                </ul>
              )}
            </InlineAlert>
          )}
          {/* Picked from the ⋮ menu (“Tải lên phiếu đã đếm”). */}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void uploadSheet(f);
            }}
          />
        </div>
      )}

      {/* “Danh sách kiểm kho” with the filter button on the same row (Design §13.8). */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900">Danh sách kiểm kho</h2>
        <FilterMenu
          groups={[
            {
              kind: 'single',
              label: 'Trạng thái',
              options: [
                { key: 'uncounted', label: `Chưa đếm (${x.lines.length - counted})` },
                ...(showExpected ? [{ key: 'variance', label: `Có chênh lệch (${x.lines.filter((l) => !!l.variance).length})` }] : []),
              ],
              value: filter,
              onChange: setFilter,
            },
          ]}
        />
      </div>
      <DataTable
        columns={[
          { header: 'SKU', cell: (l: CountLine) => <span className="code">{l.sku}</span> },
          { header: 'Sản phẩm', cell: (l) => l.title },
          ...(showExpected ? [{ header: 'Hệ thống', align: 'right' as const, cell: (l: CountLine) => formatNumber(l.expected ?? 0) }] : []),
          {
            header: 'Đếm được',
            align: 'right',
            cell: (l) =>
              // Typed on screen for counts of up to 50 products (FR-INV-06).
              open && !sheetOnly ? (
                <input
                  key={`${l.variantId}-${l.counted}`}
                  className="h-9 w-20 rounded-md border border-paper-500 text-right text-sm num px-2"
                  inputMode="numeric"
                  aria-label={`Số đếm ${l.sku}`}
                  defaultValue={l.counted ?? ''}
                  placeholder="—"
                  onBlur={(e) => void setCount(l, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : l.counted === null ? (
                <span className="text-ink-500">—</span>
              ) : (
                formatNumber(l.counted)
              ),
          },
          ...(showExpected
            ? [{ header: 'Chênh lệch', align: 'right' as const, cell: (l: CountLine) => (l.variance == null ? '' : <span className={l.variance < 0 ? 'text-danger-700' : l.variance > 0 ? 'text-warning-700' : 'text-success-700'}>{l.variance > 0 ? '+' : ''}{formatNumber(l.variance)}</span>) }]
            : []),
        ]}
        rows={rows}
        rowKey={(l) => l.variantId}
        minWidth={560}
        empty={{ icon: ClipboardList, title: 'Không có dòng phù hợp' }}
      />
      {menu && (
        <Dialog title="Thao tác" size="sm" onClose={() => setMenu(false)}>
          <div className="flex flex-col gap-2">
            {open && (
              <>
                <Button variant="primary" full icon={Send} onClick={() => (setMenu(false), setConfirm('submit'))}>
                  Gửi duyệt
                </Button>
                <a className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-paper-500 bg-white px-4 text-sm font-medium hover:bg-navy-50" href={`/api/v1/inventory/counts/${x.id}/sheet?format=xlsx`} onClick={() => setMenu(false)}>
                  <Download size={18} aria-hidden /> Tải phiếu đếm (Excel)
                </a>
                <Button variant="secondary" full icon={Upload} disabled={uploading} onClick={() => (setMenu(false), fileRef.current?.click())}>
                  Tải lên phiếu đã đếm
                </Button>
              </>
            )}
            {x.status === 'submitted' && can(me, 'inventory.count_approve') && (
              <Button variant="primary" full icon={CheckCircle2} onClick={() => (setMenu(false), setConfirm('approve'))}>
                Duyệt và ghi chênh lệch
              </Button>
            )}
            <Button variant="destructive-outline" full icon={XCircle} onClick={() => (setMenu(false), setConfirm('cancel'))}>
              Hủy phiếu
            </Button>
          </div>
        </Dialog>
      )}
      {confirm === 'submit' && (
        <ConfirmDialog
          title="Gửi phiếu kiểm để duyệt?"
          body={`Sau khi gửi, không thể thay đổi.${counted < x.lines.length ? ` Còn ${formatNumber(x.lines.length - counted)} sản phẩm chưa đếm; khi duyệt, các sản phẩm này giữ nguyên tồn.` : ''}`}
          confirm="Gửi duyệt"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await post(`/api/v1/inventory/counts/${x.id}/submit`);
            toast.success('Đã gửi phiếu kiểm để duyệt.');
            await c.refetch();
          }}
        />
      )}
      {confirm === 'cancel' && (
        <ConfirmDialog
          title={`Hủy phiếu ${x.docNo}?`}
          body="Số đếm trong phiếu sẽ không được ghi vào tồn kho. Không hoàn tác được."
          confirm="Hủy phiếu"
          destructive
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await post(`/api/v1/inventory/counts/${x.id}/cancel`);
            toast.success('Đã hủy phiếu kiểm.');
            await c.refetch();
          }}
        />
      )}
      {confirm === 'approve' && (
        <ConfirmDialog
          title="Duyệt phiếu kiểm?"
          body="Mọi chênh lệch sẽ được ghi vào tồn kho theo lý do Kiểm kho. Không hoàn tác được."
          confirm="Duyệt"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            const r = await post<{ posted: number }>(`/api/v1/inventory/counts/${x.id}/approve`);
            toast.success(`Đã duyệt; ghi ${r.posted} dòng chênh lệch.`);
            await c.refetch();
          }}
        />
      )}
    </>
  );
}
