import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, CheckCircle2, ClipboardList, Download, Plus, Send, Upload, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog, DataTable, FilterMenu, SearchBox, TimeFilter, errText, timeLabel, timeRange, toast, useListParam, useParam, type Column } from '../components/data';
import { Button, Card, ErrorState, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { ApiError, get, post } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { can, useMe } from '../lib/session';
import { COPY_STATUS } from './library';

/**
 * Library counts (FR-LIB-04, Design §13.8), modelled on Kiểm kho: scope by shelves, language and
 * category; copies marked by scanning, on screen (up to 50) or through the count sheet; blind mode
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
  languages: string[];
  categories: string[];
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
  const parts = [s.shelves.length ? `Kệ ${s.shelves.join(', ')}` : 'Mọi kệ', ...s.languages.map((l) => LANG[l] ?? l), ...s.categories];
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

const chip = (on: boolean) => clsx('h-8 rounded-full border px-3 text-sm', on ? 'border-navy-700 bg-navy-100 text-navy-700' : 'border-paper-500');
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Scope: shelves, optionally narrowed by language and category; empty = the whole library (Design §13.8). */
function CreateCount({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [shelves, setShelves] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [blind, setBlind] = useState(true);
  const opts = useQuery({ queryKey: ['library-count-scope'], queryFn: () => get<{ shelves: { shelf: string; copies: number }[]; categories: string[] }>('/api/v1/library/counts/shelves') });
  return (
    <ConfirmDialog
      title="Tạo phiếu kiểm kê thư viện"
      confirm="Bắt đầu kiểm"
      onClose={onClose}
      onConfirm={async () => {
        const r = await post<{ id: string }>('/api/v1/library/counts', { shelves, languages, categories, blind });
        onCreated(r.id);
      }}
    >
      <div className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-700">Kệ</legend>
          <p className="mb-2 text-[13px] text-ink-500">Để trống để kiểm mọi kệ.</p>
          {opts.data?.shelves.length ? (
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {opts.data.shelves.map((s) => (
                <button key={s.shelf} type="button" aria-pressed={shelves.includes(s.shelf)} onClick={() => setShelves(toggle(shelves, s.shelf))} className={chip(shelves.includes(s.shelf))}>
                  {s.shelf} <span className="text-ink-500 num">({s.copies})</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-500">{opts.isLoading ? 'Đang tải…' : 'Chưa có bản sách nào được ghi kệ.'}</p>
          )}
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-ink-700">Ngôn ngữ</legend>
          <div className="flex gap-2">
            {Object.entries(LANG).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={languages.includes(k)} onClick={() => setLanguages(toggle(languages, k))} className={chip(languages.includes(k))}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        {!!opts.data?.categories.length && (
          <fieldset>
            <legend className="mb-1 text-[13px] font-medium text-ink-700">Thể loại</legend>
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {opts.data.categories.map((c) => (
                <button key={c} type="button" aria-pressed={categories.includes(c)} onClick={() => setCategories(toggle(categories, c))} className={chip(categories.includes(c))}>
                  {c}
                </button>
              ))}
            </div>
          </fieldset>
        )}
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
  const [filter, setFilter] = useState<'all' | 'unchecked' | 'missing' | 'out'>('all');
  const [scan, setScan] = useState('');
  const [scanMsg, setScanMsg] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sheetResult, setSheetResult] = useState<{ tone: 'success' | 'danger'; text: string; rows?: { row: number; barcode: string; message: string }[] } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  if (c.isError) return <ErrorState error={c.error} onRetry={() => c.refetch()} />;
  if (!c.data) return <Skeleton className="h-64" />;
  const x = c.data;
  const open = x.status === 'open';
  const markable = open && x.summary.lines <= x.markLimit;
  const showStatus = x.lines.some((l) => l.inScope && l.status !== undefined);
  const rows = x.lines.filter((l) => (filter === 'unchecked' ? l.inScope && l.found === null : filter === 'missing' ? l.inScope && l.found === false : filter === 'out' ? !l.inScope : true));

  const doScan = async () => {
    const code = scan.trim();
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
        actions={
          <>
            {(open || x.status === 'submitted') && (
              <Button variant="destructive-outline" icon={XCircle} onClick={() => setConfirm('cancel')}>
                Hủy phiếu
              </Button>
            )}
            {open && (
              <Button variant="primary" icon={Send} onClick={() => setConfirm('submit')}>
                Gửi duyệt
              </Button>
            )}
            {x.status === 'submitted' && can(me, 'library.count_approve') && (
              <Button variant="primary" icon={CheckCircle2} onClick={() => setConfirm('approve')}>
                Duyệt
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Chip status={x.status} />
        <span className="text-sm text-ink-700 num">
          Đã thấy {formatNumber(x.summary.found)}/{formatNumber(x.summary.lines)}
        </span>
        <div className="h-2 w-48 overflow-hidden rounded-full bg-paper-200" aria-hidden>
          <div className="h-full bg-navy-700" style={{ width: `${x.summary.lines ? ((x.summary.lines - x.summary.unchecked) / x.summary.lines) * 100 : 0}%` }} />
        </div>
        <span className="text-sm text-ink-500">{scopeLabel(x.scope)}</span>
        {x.blind && <StatusChip tone="neutral">Đếm mù</StatusChip>}
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
          <p className="mt-2 text-[13px] text-ink-500">Duyệt phiếu chỉ chốt báo cáo; trạng thái và kệ của bản sách không đổi. Sửa từng bản trong Quản lý đầu sách nếu cần.</p>
        </Card>
      )}

      {open && (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Quét mã">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void doScan();
              }}
            >
              <input
                ref={scanRef}
                className="h-11 min-w-0 flex-1 rounded-md border border-paper-500 bg-white px-3 focus:border-navy-700"
                placeholder="Quét mã bản sách"
                aria-label="Quét mã bản sách"
                autoFocus
                value={scan}
                onChange={(e) => setScan(e.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={!scan.trim()}>
                Ghi nhận
              </Button>
            </form>
            {scanMsg && (
              <div className="mt-3">
                <InlineAlert tone={scanMsg.tone}>{scanMsg.text}</InlineAlert>
              </div>
            )}
          </Card>
          <Card title="Phiếu đếm">
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ink-700">
                {markable ? 'Đánh dấu Có / Không thấy ngay trong bảng, hoặc tải phiếu đếm về điền cột “Có mặt” (1 hoặc 0) rồi tải lên lại.' : `Phiếu có ${formatNumber(x.summary.lines)} bản (trên ${x.markLimit}): quét mã, hoặc tải phiếu đếm về điền cột “Có mặt” rồi tải lên lại.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <a className="inline-flex h-9 items-center gap-2 rounded-full border border-paper-500 px-4 text-sm font-medium hover:bg-navy-50" href={`/api/v1/library/counts/${x.id}/sheet?format=xlsx`}>
                  <Download size={18} aria-hidden /> Tải phiếu đếm (Excel)
                </a>
                <a className="inline-flex h-9 items-center gap-2 rounded-full border border-paper-500 px-4 text-sm font-medium hover:bg-navy-50" href={`/api/v1/library/counts/${x.id}/sheet?format=csv`}>
                  <Download size={18} aria-hidden /> CSV
                </a>
                <label className={clsx('inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-navy-700 px-4 text-sm font-medium text-white hover:bg-navy-800', uploading && 'opacity-60')}>
                  <Upload size={18} aria-hidden /> {uploading ? 'Đang tải lên…' : 'Tải lên phiếu đã đếm'}
                  <input
                    type="file"
                    accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void uploadSheet(f);
                    }}
                  />
                </label>
              </div>
              {sheetResult && (
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
              )}
            </div>
          </Card>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ['all', 'Tất cả'],
            ['unchecked', `Chưa kiểm (${x.summary.unchecked})`],
            ['missing', `Không thấy (${x.summary.missing})`],
            ['out', `Ngoài phạm vi (${x.summary.outOfScope})`],
          ] as [typeof filter, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={clsx('h-8 rounded-full border px-3 text-sm num', filter === k ? 'border-navy-700 bg-navy-100 text-navy-700' : 'border-paper-500 bg-white')}>
            {label}
          </button>
        ))}
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
