import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, CheckCircle2, ChevronDown, ClipboardList, Download, MoreVertical, Plus, ScanBarcode, Search, Send, Upload, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog, DataTable, FilterMenu, SearchBox, TimeFilter, errText, timeLabel, timeRange, toast, useListParam, useParam, type Column } from '../components/data';
import { Button, Card, ErrorState, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { ApiError, get, post } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { can, useMe } from '../lib/session';
import { CameraScanner, Dialog } from '../pos/widgets';
import { COPY_STATUS } from './library';

/**
 * Library counts (FR-LIB-04, Design §13.8), modelled on Kiểm kho: scope by shelves only; copies marked
 * by scanning (accession barcode or ISBN), on screen (up to 50) or through the count sheet; blind mode
 * hides the system status; submit, approve (no copy changes) or cancel until approved.
 */

const STATUS: Record<string, { tone: Tone; label: string }> = {
  open: { tone: 'info', label: 'Đang đếm' },
  submitted: { tone: 'warning', label: 'Chờ duyệt' },
  approved: { tone: 'success', label: 'Đã duyệt' },
  cancelled: { tone: 'neutral', label: 'Đã hủy' },
};
const Chip = ({ status }: { status: string }) => <StatusChip tone={STATUS[status]?.tone ?? 'neutral'}>{STATUS[status]?.label ?? status}</StatusChip>;
const LANG: Record<string, string> = { vi: 'Tiếng Việt', en: 'Tiếng Anh' };

interface Scope {
  shelves: string[];
  /** Older counts only. */
  languages?: string[];
  categories?: string[];
}
interface CountRow {
  id: string;
  docNo: string;
  scope: Scope;
  blind: boolean;
  status: string;
  createdAt: string;
  createdBy: string | null;
  lines: number;
  found: number;
  checked: number;
}

const scopeLabel = (s: Scope) => {
  const parts = [s.shelves.length ? `Kệ ${s.shelves.join(', ')}` : 'Mọi kệ', ...(s.languages ?? []).map((l) => LANG[l] ?? l), ...(s.categories ?? [])];
  return parts.join(' · ');
};

export function LibraryCountsPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useParam('q');
  const [statuses, setStatuses] = useListParam('status');
  const [time, setTime] = useParam('time');
  const query = { q: q || undefined, status: statuses.join(',') || undefined, ...timeRange(time) };
  const filtered = !!(q || statuses.length || time);
  const list = useQuery({ queryKey: ['library-counts', query], queryFn: () => get<{ items: CountRow[] }>('/api/v1/library/counts', query) });
  const columns: Column<CountRow>[] = [
    { header: 'Số phiếu', cell: (r) => <span className="code">{r.docNo}</span> },
    { header: 'Ngày', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.createdAt) },
    { header: 'Phạm vi', cell: (r) => `${scopeLabel(r.scope)}${r.blind ? ' · đếm mù' : ''}` },
    { header: 'Người tạo', cell: (r) => r.createdBy ?? '—' },
    { header: 'Đã thấy', align: 'right', cell: (r) => `${formatNumber(r.found)}/${formatNumber(r.lines)}` },
    { header: 'Trạng thái', cell: (r) => <Chip status={r.status} /> },
  ];
  return (
    <>
      <PageHeader
        title="Kiểm kê thư viện"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Tạo phiếu kiểm kê
          </Button>
        }
      />
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
        onRow={(r) => navigate(`/library/counts/${r.id}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={filtered ? { icon: ClipboardList, title: 'Không có phiếu phù hợp', help: 'Thử bỏ bớt bộ lọc hoặc đổi từ khóa.' } : { icon: ClipboardList, title: 'Chưa có phiếu kiểm kê thư viện' }}
      />
      {creating && <CreateCount onClose={() => setCreating(false)} onCreated={(id) => navigate(`/library/counts/${id}`)} />}
    </>
  );
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Kệ: a dropdown of the shelves in use with square checkboxes, several at a time; none = every shelf (Design §13.8). */
function ShelfSelect({ options, value, onChange, loading }: { options: { shelf: string; copies: number }[]; value: string[]; onChange: (v: string[]) => void; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const summary = value.length === 0 ? 'Tất cả kệ' : value.length <= 3 ? value.join(', ') : `${value.length} kệ`;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] font-medium text-ink-700">Kệ</span>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className={clsx('flex h-10 w-full items-center justify-between gap-2 border border-paper-500 bg-white px-3 text-left text-sm pointer-coarse:h-11', open ? 'rounded-t-md border-navy-700' : 'rounded-md')}
      >
        <span className={clsx('min-w-0 truncate', value.length === 0 && 'text-ink-500')}>{summary}</span>
        <ChevronDown size={18} className={clsx('shrink-0 text-ink-500 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul role="listbox" aria-multiselectable="true" className="-mt-1 max-h-56 overflow-y-auto rounded-b-md border border-t-0 border-navy-700 bg-white">
          {options.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">{loading ? 'Đang tải…' : 'Chưa có bản sách nào được ghi kệ.'}</li>}
          {options.map((o) => (
            <li key={o.shelf}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm hover:bg-navy-50">
                <input type="checkbox" className="size-[18px] shrink-0 rounded-none accent-navy-700" checked={value.includes(o.shelf)} onChange={() => onChange(toggle(value, o.shelf))} />
                <span className="min-w-0 flex-1 font-medium">{o.shelf}</span>
                <span className="text-[13px] text-ink-500 num">{formatNumber(o.copies)} cuốn</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Scope: shelves only; none ticked = the whole library (FR-LIB-04, Design §13.8). */
function CreateCount({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [shelves, setShelves] = useState<string[]>([]);
  const [blind, setBlind] = useState(true);
  const opts = useQuery({ queryKey: ['library-count-scope'], queryFn: () => get<{ shelves: { shelf: string; copies: number }[] }>('/api/v1/library/counts/shelves') });
  return (
    <ConfirmDialog
      title="Tạo phiếu kiểm kê thư viện"
      confirm="Bắt đầu kiểm"
      onClose={onClose}
      onConfirm={async () => {
        const r = await post<{ id: string }>('/api/v1/library/counts', { shelves, blind });
        onCreated(r.id);
      }}
    >
      <div className="flex flex-col gap-4">
        <ShelfSelect options={opts.data?.shelves ?? []} value={shelves} onChange={setShelves} loading={opts.isLoading} />
        <label className="inline-flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-[18px] accent-navy-700" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
          <span>
            Đếm mù
            <span className="block text-[13px] text-ink-500">Người kiểm không thấy trạng thái của bản sách trên hệ thống.</span>
          </span>
        </label>
      </div>
    </ConfirmDialog>
  );
}

/** A bare progress bar. */
function Bar({ done, total }: { done: number; total: number }) {
  return (
    <span className="block h-2 w-full overflow-hidden rounded-full bg-paper-200" aria-hidden>
      <span className="block h-full bg-navy-700" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
    </span>
  );
}

/** A bar with “done/total” at its right. */
function Progress({ done, total }: { done: number; total: number }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-200" aria-hidden>
        <span className="block h-full bg-navy-700" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </span>
      <span className="shrink-0 text-sm text-ink-700 num">
        {formatNumber(done)}/{formatNumber(total)}
      </span>
    </span>
  );
}

/** Copies counted per shelf of the snapshot (checked = marked Có or Không thấy). */
function shelfProgress(lines: Line[]) {
  const map = new Map<string, { done: number; total: number }>();
  for (const l of lines) {
    if (!l.inScope) continue;
    const k = l.shelf ?? '—';
    const g = map.get(k) ?? { done: 0, total: 0 };
    g.total++;
    if (l.found !== null) g.done++;
    map.set(k, g);
  }
  return [...map].map(([shelf, g]) => ({ shelf, ...g })).sort((a, b) => a.shelf.localeCompare(b.shelf));
}

interface Line {
  copyId: string;
  barcode: string;
  title: string;
  code: string;
  inScope: boolean;
  shelf: string | null;
  found: boolean | null;
  status?: string;
  outcome?: string;
}
interface Detail extends Omit<CountRow, 'lines' | 'found' | 'checked'> {
  approvedAt: string | null;
  markLimit: number;
  summary: { lines: number; found: number; missing: number; unchecked: number; outOfScope: number };
  lines: Line[];
}

const OUTCOME: Record<string, { tone: Tone; label: string }> = {
  out_of_scope: { tone: 'warning', label: 'Ngoài phạm vi / sai kệ' },
  found_lost: { tone: 'warning', label: 'Đang báo Mất' },
  found_damaged: { tone: 'warning', label: 'Đang báo Hỏng' },
  found_on_loan: { tone: 'warning', label: 'Đang cho mượn' },
};

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function LibraryCountDetailPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const c = useQuery({ queryKey: ['library-count', id], queryFn: () => get<Detail>(`/api/v1/library/counts/${id}`) });
  const [confirm, setConfirm] = useState<null | 'submit' | 'approve' | 'cancel'>(null);
  const [menu, setMenu] = useState(false);
  const [byShelf, setByShelf] = useState(false);
  const [camera, setCamera] = useState(false);
  const [filter, setFilter] = useState('');
  const [scan, setScan] = useState('');
  const [scanMsg, setScanMsg] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sheetResult, setSheetResult] = useState<{ tone: 'success' | 'danger'; text: string; rows?: { row: number; barcode: string; message: string }[] } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (c.isError) return <ErrorState error={c.error} onRetry={() => c.refetch()} />;
  if (!c.data) return <Skeleton className="h-64" />;
  const x = c.data;
  const open = x.status === 'open';
  const markable = open && x.summary.lines <= x.markLimit;
  const showStatus = x.lines.some((l) => l.inScope && l.status !== undefined);
  const rows = x.lines.filter((l) => (filter === 'unchecked' ? l.inScope && l.found === null : filter === 'missing' ? l.inScope && l.found === false : filter === 'out' ? !l.inScope : true));

  // A scanner's Enter or a camera read records the copy at once: no “Ghi nhận” button (Design §13.8).
  const doScan = async (raw = scan) => {
    const code = raw.trim();
    if (!code) return;
    setScan('');
    try {
      const r = await post<{ barcode: string; title: string; inScope: boolean }>(`/api/v1/library/counts/${x.id}/scan`, { barcode: code });
      setScanMsg(r.inScope ? { tone: 'success', text: `Có: ${r.barcode} – ${r.title}` } : { tone: 'warning', text: `${r.barcode} – ${r.title} không thuộc phiếu này (ngoài phạm vi hoặc sai kệ).` });
      await c.refetch();
    } catch (e) {
      setScanMsg({ tone: 'danger', text: errText(e) });
    } finally {
      scanRef.current?.focus();
    }
  };

  const setFound = async (line: Line, found: boolean | null) => {
    try {
      await post(`/api/v1/library/counts/${x.id}/lines`, { copyId: line.copyId, found });
      await c.refetch();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const uploadSheet = async (file: File) => {
    setUploading(true);
    setSheetResult(null);
    const mime = file.name.toLowerCase().endsWith('.csv') ? 'text/csv' : XLSX;
    try {
      const res = await fetch(`/api/v1/library/counts/${x.id}/sheet`, { method: 'POST', credentials: 'same-origin', headers: { 'x-bms-request': '1', 'content-type': mime }, body: file });
      const body = (await res.json().catch(() => null)) as { updated?: number; checked?: number; error?: { message: string; details?: { rows?: { row: number; barcode: string; message: string }[] } } } | null;
      if (!res.ok) {
        setSheetResult({ tone: 'danger', text: body?.error?.message ?? 'Không đọc được tệp.', ...(body?.error?.details?.rows && { rows: body.error.details.rows }) });
        return;
      }
      setSheetResult({ tone: 'success', text: `Đã cập nhật ${formatNumber(body?.updated ?? 0)} kết quả. Đã kiểm ${formatNumber(body?.checked ?? 0)}/${formatNumber(x.summary.lines)} bản.` });
      await c.refetch();
    } catch (e) {
      setSheetResult({ tone: 'danger', text: e instanceof ApiError ? e.message : 'Mất kết nối. Hãy thử lại.' });
    } finally {
      setUploading(false);
    }
  };

  const resultCell = (l: Line) => {
    if (!l.inScope) {
      const o = OUTCOME[l.outcome ?? ''] ?? OUTCOME.out_of_scope!;
      return <StatusChip tone={o.tone}>{o.label}</StatusChip>;
    }
    if (markable) {
      // Two small toggles per row for counts of up to 50 copies (Design §13.8).
      const btn = (on: boolean, label: string, value: boolean) => (
        <button
          type="button"
          aria-pressed={on}
          onClick={() => void setFound(l, on ? null : value)}
          className={clsx('h-8 rounded-full border px-3 text-sm whitespace-nowrap', on ? (value ? 'border-success-700 bg-success-50 text-success-700' : 'border-danger-700 bg-danger-50 text-danger-700') : 'border-paper-500 bg-white')}
        >
          {label}
        </button>
      );
      return (
        <span className="inline-flex gap-2">
          {btn(l.found === true, 'Có', true)}
          {btn(l.found === false, 'Không thấy', false)}
        </span>
      );
    }
    return l.found === null ? <span className="text-ink-500">Chưa kiểm</span> : l.found ? <StatusChip tone="success">Có</StatusChip> : <StatusChip tone="danger">Không thấy</StatusChip>;
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/library/counts" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Kiểm kê thư viện
          </Link>
        }
        title={x.docNo}
        // Gửi duyệt, Duyệt and Hủy phiếu in a ⋮ menu on the title row (Design §13.8).
        menu={(open || x.status === 'submitted') && <Button variant="ghost" icon={MoreVertical} aria-label="Thao tác" title="Thao tác" onClick={() => setMenu(true)} />}
      />
      {!open && (
        <div className="mb-4">
          <Chip status={x.status} />
        </div>
      )}
      {/* One box: “Tiến độ”, the overall bar with its %, and per shelf when opened (Design §13.8). */}
      <div className="mb-4 rounded-lg border border-paper-300 bg-white shadow-sm">
        <button type="button" aria-expanded={byShelf} onClick={() => setByShelf((v) => !v)} className="flex w-full flex-col gap-2 px-4 py-3 text-left">
          <span className="flex w-full items-center justify-between gap-3">
            <span className="text-sm font-semibold text-ink-900">Tiến độ</span>
            <span className="flex items-center gap-1 text-sm font-semibold text-ink-900 num">
              {x.summary.lines ? Math.floor(((x.summary.lines - x.summary.unchecked) / x.summary.lines) * 100) : 0}%
              <ChevronDown size={18} className={clsx('shrink-0 text-ink-500 transition-transform', byShelf && 'rotate-180')} aria-hidden />
            </span>
          </span>
          <Bar done={x.summary.lines - x.summary.unchecked} total={x.summary.lines} />
        </button>
        {byShelf && (
          <ul className="flex flex-col gap-2 px-4 pb-3">
            {shelfProgress(x.lines).map((g) => (
              <li key={g.shelf} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 font-medium">{g.shelf}</span>
                <Progress done={g.done} total={g.total} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {!open && (
        <Card title="Báo cáo chênh lệch" className="mb-6">
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm num">
            <span>
              Không thấy <b className="text-danger-700">{formatNumber(x.summary.missing)}</b>
            </span>
            <span>
              Chưa kiểm <b>{formatNumber(x.summary.unchecked)}</b>
            </span>
            <span>
              Ngoài phạm vi / sai trạng thái <b className="text-warning-700">{formatNumber(x.summary.outOfScope)}</b>
            </span>
          </div>
          <p className="mt-2 text-[13px] text-ink-500">Duyệt phiếu chỉ chốt báo cáo; trạng thái và kệ của bản sách không đổi. Sửa từng bản trong Quản lý thư viện nếu cần.</p>
        </Card>
      )}

      {open && (
        <div className="mb-6">
          <div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void doScan();
              }}
            >
              <div className="relative min-w-0 flex-1">
              <Search size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />
              <input
                ref={scanRef}
                className="h-11 w-full rounded-md border border-paper-500 bg-white pr-3 pl-10 focus:border-navy-700"
                placeholder="Quét mã cá biệt hoặc ISBN"
                aria-label="Quét mã cá biệt hoặc ISBN"
                autoFocus
                value={scan}
                onChange={(e) => setScan(e.target.value)}
              />
              </div>
              <button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-navy-700 hover:bg-navy-50" aria-label="Quét mã bằng camera" title="Quét mã bằng camera" onClick={() => setCamera(true)}>
                <ScanBarcode size={26} aria-hidden />
              </button>
            </form>
            {camera && (
              <CameraScanner
                onCode={(code) => {
                  setCamera(false);
                  void doScan(code);
                }}
                onClose={() => setCamera(false)}
              />
            )}
            {scanMsg && (
              <div className="mt-3">
                <InlineAlert tone={scanMsg.tone}>{scanMsg.text}</InlineAlert>
              </div>
            )}
            {uploading && <p className="mt-3 text-sm text-ink-500">Đang tải lên phiếu đếm…</p>}
            {sheetResult && (
              <div className="mt-3">
                <InlineAlert tone={sheetResult.tone}>
                  {sheetResult.text}
                  {sheetResult.rows && (
                    <ul className="mt-1 list-disc pl-5">
                      {sheetResult.rows.map((r) => (
                        <li key={r.row}>
                          Dòng {r.row} {r.barcode && <span className="code">{r.barcode}</span>}: {r.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </InlineAlert>
              </div>
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
        </div>
      )}

      {/* “Danh sách kiểm kê” with the filter button on the same row (Design §13.8). */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900">Danh sách kiểm kê</h2>
        <FilterMenu
          groups={[
            {
              kind: 'single',
              label: 'Trạng thái',
              options: [
                { key: 'unchecked', label: `Chưa kiểm (${x.summary.unchecked})` },
                { key: 'missing', label: `Không thấy (${x.summary.missing})` },
                { key: 'out', label: `Ngoài phạm vi (${x.summary.outOfScope})` },
              ],
              value: filter,
              onChange: setFilter,
            },
          ]}
        />
      </div>
      <DataTable
        columns={[
          { header: 'Mã cá biệt', cell: (l: Line) => <span className="code">{l.barcode}</span> },
          { header: 'Tên sách', cell: (l) => l.title },
          { header: 'Kệ', cell: (l) => l.shelf ?? '—' },
          ...(showStatus ? [{ header: 'Trạng thái hệ thống', cell: (l: Line) => (l.status ? <StatusChip tone={COPY_STATUS[l.status]?.tone ?? 'neutral'}>{COPY_STATUS[l.status]?.label ?? l.status}</StatusChip> : '—') }] : []),
          { header: 'Kết quả', cell: resultCell },
        ]}
        rows={rows}
        rowKey={(l) => l.copyId}
        minWidth={640}
        empty={{ icon: ClipboardList, title: x.lines.length ? 'Không có dòng phù hợp' : 'Không có bản sách nào trong phạm vi này' }}
      />
      {menu && (
        <Dialog title="Thao tác" size="sm" onClose={() => setMenu(false)}>
          <div className="flex flex-col gap-2">
            {open && (
              <Button variant="primary" full icon={Send} onClick={() => (setMenu(false), setConfirm('submit'))}>
                Gửi duyệt
              </Button>
            )}
            {open && (
              <>
                <a className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-paper-500 bg-white px-4 text-sm font-medium hover:bg-navy-50" href={`/api/v1/library/counts/${x.id}/sheet?format=xlsx`} onClick={() => setMenu(false)}>
                  <Download size={18} aria-hidden /> Tải phiếu đếm (Excel)
                </a>
                <Button variant="secondary" full icon={Upload} disabled={uploading} onClick={() => (setMenu(false), fileRef.current?.click())}>
                  Tải lên phiếu đã đếm
                </Button>
              </>
            )}
            {x.status === 'submitted' && can(me, 'library.count_approve') && (
              <Button variant="primary" full icon={CheckCircle2} onClick={() => (setMenu(false), setConfirm('approve'))}>
                Duyệt
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
          title="Gửi phiếu kiểm kê để duyệt?"
          body={`Sau khi gửi, không thể thay đổi.${x.summary.unchecked ? ` Còn ${formatNumber(x.summary.unchecked)} bản chưa kiểm.` : ''}`}
          confirm="Gửi duyệt"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await post(`/api/v1/library/counts/${x.id}/submit`);
            toast.success('Đã gửi phiếu kiểm kê để duyệt.');
            await c.refetch();
          }}
        />
      )}
      {confirm === 'cancel' && (
        <ConfirmDialog
          title={`Hủy phiếu ${x.docNo}?`}
          body="Kết quả kiểm trong phiếu sẽ bị bỏ. Không hoàn tác được."
          confirm="Hủy phiếu"
          destructive
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await post(`/api/v1/library/counts/${x.id}/cancel`);
            toast.success('Đã hủy phiếu kiểm kê.');
            await c.refetch();
          }}
        />
      )}
      {confirm === 'approve' && (
        <ConfirmDialog
          title="Duyệt phiếu kiểm kê?"
          body="Duyệt chỉ chốt báo cáo chênh lệch. Không bản sách nào bị đổi trạng thái hay kệ."
          confirm="Duyệt"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await post(`/api/v1/library/counts/${x.id}/approve`);
            toast.success('Đã duyệt phiếu kiểm kê.');
            await c.refetch();
          }}
        />
      )}
    </>
  );
}
