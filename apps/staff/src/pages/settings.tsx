import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2, Clock, DatabaseBackup, Plus, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DataTable, Facts, SelectField, Tabs, TextArea, toast, useParam } from '../components/data';
import { Button, Card, ErrorState, Field, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { get, post, put } from '../lib/api';
import { formatDateTime, formatNumber, formatRelative } from '../lib/format';
import { Dialog } from '../pos/widgets';

/** Settings (FR-ADM-04, FR-ADM-06, FR-ADM-10, TDD §11.5 health page). */

type Kind = 'text' | 'longtext' | 'int' | 'vnd' | 'percent' | 'bool' | 'enum' | 'secret';
interface Def {
  key: string;
  label: string;
  kind: Kind;
  helper?: string;
  options?: [string, string][];
}

/** Release R1 settings, grouped and labelled; later-release parameters keep their defaults. */
const GROUPS: [string, Def[]][] = [
  [
    'Thông tin cửa hàng',
    [
      { key: 'store.name', label: 'Tên cửa hàng', kind: 'text' },
      { key: 'store.address', label: 'Địa chỉ', kind: 'text' },
      { key: 'store.tax_code', label: 'Mã số thuế', kind: 'text' },
      { key: 'store.phone', label: 'Điện thoại', kind: 'text' },
    ],
  ],
  [
    'Bán hàng tại quầy',
    [
      { key: 'sale.return_window_days', label: 'Thời hạn đổi trả', kind: 'int', helper: 'ngày' },
      { key: 'sale.cashier_discount_max_bp', label: 'Thu ngân được giảm tối đa', kind: 'percent' },
      { key: 'shift.variance_alert_vnd', label: 'Báo chênh lệch ca khi vượt', kind: 'vnd' },
      { key: 'pos.einvoice_mode', label: 'Xuất hóa đơn điện tử', kind: 'enum', options: [['every_sale', 'Mọi đơn bán'], ['on_request', 'Khi khách yêu cầu']] },
      { key: 'pos.print_sales_slip', label: 'In phiếu bán hàng', kind: 'bool' },
      { key: 'pos.sales_slip_footer', label: 'Chân phiếu bán hàng', kind: 'longtext' },
      { key: 'pos.offline_lease_hours', label: 'Thời gian bán ngoại tuyến tối đa', kind: 'int', helper: 'giờ' },
      { key: 'pos.lock_minutes', label: 'Tự khóa màn hình sau', kind: 'int', helper: 'phút' },
      { key: 'session.idle_hours', label: 'Hết phiên đăng nhập sau', kind: 'int', helper: 'giờ không dùng' },
    ],
  ],
  [
    'Kho và nhập hàng',
    [
      { key: 'inventory.allow_negative_pos', label: 'Cho phép bán khi hết hàng (tồn âm)', kind: 'bool' },
      { key: 'inventory.adjust_approval_vnd', label: 'Điều chỉnh tồn cần duyệt khi giá trị vượt', kind: 'vnd' },
      { key: 'catalog.duplicate_mode', label: 'Sản phẩm trùng', kind: 'enum', options: [['block', 'Chặn'], ['warn', 'Chỉ cảnh báo']] },
      { key: 'purchasing.min_margin_bp', label: 'Lãi tối thiểu khi nhập', kind: 'percent' },
      { key: 'purchasing.velocity_days', label: 'Tính tốc độ bán trong', kind: 'int', helper: 'ngày' },
      { key: 'purchasing.reorder_cover_days', label: 'Đặt hàng đủ bán trong', kind: 'int', helper: 'ngày' },
      { key: 'purchasing.consignment_alert_days', label: 'Báo hạn ký gửi trước', kind: 'int', helper: 'ngày' },
    ],
  ],
  [
    'Tích điểm và hạng thành viên',
    [
      { key: 'loyalty.earn_vnd_per_point', label: 'Số tiền cho 1 điểm', kind: 'vnd' },
      { key: 'loyalty.point_value_vnd', label: 'Giá trị 1 điểm khi đổi', kind: 'vnd' },
      { key: 'loyalty.min_redeem_points', label: 'Đổi tối thiểu', kind: 'int', helper: 'điểm' },
      { key: 'loyalty.expiry_months', label: 'Điểm hết hạn sau', kind: 'int', helper: 'tháng' },
      { key: 'loyalty.tier_silver_vnd', label: 'Hạng Bạc khi chi tiêu 12 tháng từ', kind: 'vnd' },
      { key: 'loyalty.tier_gold_vnd', label: 'Hạng Vàng khi chi tiêu 12 tháng từ', kind: 'vnd' },
    ],
  ],
  [
    'Hóa đơn điện tử (MISA meInvoice)',
    [
      { key: 'einvoice.misa_tax_code', label: 'Mã số thuế đăng ký MISA', kind: 'text' },
      { key: 'einvoice.misa_username', label: 'Tên đăng nhập MISA', kind: 'secret' },
      { key: 'einvoice.misa_password', label: 'Mật khẩu MISA', kind: 'secret' },
    ],
  ],
  [
    'Lưu trữ',
    [{ key: 'retention.financial_years', label: 'Giữ chứng từ tài chính', kind: 'int', helper: 'năm (tối thiểu 10)' }],
  ],
];

interface SettingItem {
  key: string;
  secret: boolean;
  value: unknown;
  isSet: boolean;
}

export function SettingsPage() {
  const [tab, setTab] = useParam('tab', 'config');
  return (
    <>
      <PageHeader title="Cài đặt" />
      <Tabs
        tabs={[
          { key: 'config', label: 'Cấu hình' },
          { key: 'master', label: 'Danh mục dùng chung' },
          { key: 'backup', label: 'Sao lưu & dữ liệu' },
        ]}
        value={tab as 'config'}
        onChange={setTab}
      />
      {tab === 'config' && <Config />}
      {tab === 'master' && <MasterData />}
      {tab === 'backup' && <Backup />}
    </>
  );
}

function Config() {
  const s = useQuery({ queryKey: ['settings'], queryFn: () => get<{ items: SettingItem[] }>('/api/v1/admin/settings') });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (s.data) setValues(Object.fromEntries(s.data.items.map((i) => [i.key, i.secret ? '' : i.value])));
  }, [s.data]);
  if (s.isError) return <ErrorState error={s.error} onRetry={() => s.refetch()} />;
  if (!s.data) return <Skeleton className="h-64" />;
  const meta = Object.fromEntries(s.data.items.map((i) => [i.key, i]));
  const change = (k: string, v: unknown) => {
    setValues({ ...values, [k]: v });
    setDirty({ ...dirty, [k]: v });
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await put('/api/v1/admin/settings', dirty);
      toast.success('Đã lưu cài đặt.');
      setDirty({});
      await s.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-6 pb-20">
      {GROUPS.map(([title, defs]) => (
        <Card key={title} title={title}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {defs.map((d) => (
              <SettingInput key={d.key} def={d} value={values[d.key]} isSet={meta[d.key]?.isSet ?? false} masked={meta[d.key]?.secret ? String(meta[d.key]?.value ?? '') : ''} onChange={(v) => change(d.key, v)} />
            ))}
          </div>
        </Card>
      ))}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {Object.keys(dirty).length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-center justify-end gap-2 border-t border-paper-300 bg-white px-6 shadow-sm">
          <span className="mr-auto text-sm text-ink-700">{Object.keys(dirty).length} thay đổi chưa lưu</span>
          <Button variant="secondary" onClick={() => (setDirty({}), void s.refetch())}>
            Hủy
          </Button>
          <Button variant="primary" icon={Save} loading={busy} onClick={save}>
            Lưu cài đặt
          </Button>
        </div>
      )}
    </div>
  );
}

function SettingInput({ def: d, value, isSet, masked, onChange }: { def: Def; value: unknown; isSet: boolean; masked: string; onChange: (v: unknown) => void }) {
  switch (d.kind) {
    case 'bool':
      return (
        <label className="inline-flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" className="size-5" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {d.label}
        </label>
      );
    case 'enum':
      return (
        <SelectField label={d.label} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {d.options!.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </SelectField>
      );
    case 'longtext':
      return <TextArea label={d.label} className="sm:col-span-2" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'secret':
      return <Field label={d.label} type="password" autoComplete="off" placeholder={isSet ? masked : 'Chưa đặt'} helper="Chỉ nhập khi cần thay; giá trị đã lưu không hiển thị." value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
    case 'percent':
      return <Field label={d.label} suffix="%" inputMode="decimal" value={value == null ? '' : String(Number(value) / 100)} onChange={(e) => onChange(Math.round(Number(e.target.value.replace(',', '.')) * 100) || 0)} />;
    case 'vnd':
      return <Field label={d.label} suffix="₫" inputMode="numeric" value={value == null ? '' : formatNumber(Number(value))} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)} />;
    case 'int':
      return <Field label={d.label} inputMode="numeric" {...(d.helper && { helper: d.helper })} value={value == null ? '' : String(value)} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)} />;
    default:
      return <Field label={d.label} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
}

// ---------------------------------------------------------------------------------------------
// Master data (FR-ADM-10)

const MASTER: [string, string][] = [
  ['reason_code', 'Lý do điều chỉnh kho'],
  ['unit', 'Đơn vị tính'],
  ['payment_method', 'Phương thức thanh toán'],
  ['location', 'Vị trí kho'],
  ['order_source', 'Nguồn đơn hàng'],
  ['holiday', 'Ngày lễ'],
];
interface MasterRow {
  code: string;
  i18n: { vi?: { name?: string; date?: string } };
  active: boolean;
  sort: number;
}

function MasterData() {
  const [kind, setKind] = useState('reason_code');
  const list = useQuery({ queryKey: ['master', kind, 'all'], queryFn: () => get<{ items: MasterRow[] }>(`/api/v1/admin/master-data/${kind}`, { all: 'true' }) });
  const [editing, setEditing] = useState<MasterRow | 'new' | null>(null);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SelectField label="Danh mục" value={kind} onChange={(e) => setKind(e.target.value)}>
          {MASTER.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </SelectField>
        {kind !== 'payment_method' && (
          <Button variant="secondary" icon={Plus} onClick={() => setEditing('new')}>
            Thêm mục
          </Button>
        )}
      </div>
      <DataTable
        columns={[
          { header: 'Mã', cell: (r: MasterRow) => <span className="code">{r.code}</span> },
          { header: 'Tên hiển thị', cell: (r) => r.i18n.vi?.name ?? '' },
          ...(kind === 'holiday' ? [{ header: 'Ngày', cell: (r: MasterRow) => r.i18n.vi?.date ?? '' }] : []),
          { header: 'Thứ tự', align: 'right', cell: (r) => r.sort },
          { header: '', cell: (r) => (r.active ? <StatusChip tone="success">Đang dùng</StatusChip> : <StatusChip tone="neutral">Ngừng dùng</StatusChip>) },
        ]}
        rows={list.data?.items}
        rowKey={(r) => r.code}
        onRow={setEditing}
        minWidth={480}
        empty={{ icon: Plus, title: 'Chưa có mục nào' }}
      />
      {editing && <MasterForm kind={kind} row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => list.refetch()} />}
    </>
  );
}

function MasterForm({ kind, row, onClose, onSaved }: { kind: string; row: MasterRow | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(row?.code ?? '');
  const [name, setName] = useState(row?.i18n.vi?.name ?? '');
  const [date, setDate] = useState(row?.i18n.vi?.date ?? '');
  const [sort, setSort] = useState(String(row?.sort ?? 0));
  const [active, setActive] = useState(row?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title={row ? `Sửa ${row.code}` : 'Thêm mục'}
      size="sm"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          disabled={!code.trim() || !name.trim()}
          onClick={async () => {
            try {
              await put(`/api/v1/admin/master-data/${kind}/${encodeURIComponent(code.trim().toLowerCase())}`, { name: name.trim(), active, sort: Number(sort) || 0, ...(kind === 'holiday' && date && { date }) });
              toast.success('Đã lưu.');
              onSaved();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Lưu
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Mã" required className="code" readOnly={!!row} value={code} onChange={(e) => setCode(e.target.value)} helper={row ? 'Mã không đổi được; đổi tên hiển thị thoải mái.' : 'Chữ thường, không dấu, dùng gạch dưới.'} />
        <Field label="Tên hiển thị" required value={name} onChange={(e) => setName(e.target.value)} />
        {kind === 'holiday' && <Field label="Ngày" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        <Field label="Thứ tự" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value.replace(/\D/g, ''))} />
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Đang dùng
        </label>
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Backup & data, health indicators (FR-ADM-06, TDD §11.4–11.5)

interface SystemStatus {
  version: string;
  database: { ok: boolean; sizeBytes: number };
  backup: {
    lastSucceededAt: string | null;
    ageHours: number | null;
    stale: boolean;
    pending: boolean;
    runs: { id: string; kind: string; status: string; requestedAt: string; finishedAt: string | null; sizeBytes: number | null; label: string | null; error: string | null }[];
  };
  wal: { archiving: boolean; lastArchivedAt: string | null; lagMinutes: number | null; failedCount: number; lagging: boolean };
  queue: { pendingJobs: number; oldestMinutes: number | null; outboxPending: number };
}
const RUN: Record<string, { tone: Tone; label: string }> = {
  requested: { tone: 'info', label: 'Chờ chạy' },
  running: { tone: 'info', label: 'Đang chạy' },
  succeeded: { tone: 'success', label: 'Thành công' },
  failed: { tone: 'danger', label: 'Lỗi' },
};
const KIND_LABEL: Record<string, string> = { full: 'Toàn bộ', diff: 'Thay đổi', dump: 'Bản sao hằng tuần', manual: 'Thủ công' };
const size = (b: number | null) => (b == null ? '—' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

function Health({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      {ok ? <CheckCircle2 className="mt-0.5 shrink-0 text-success-700" size={20} aria-hidden /> : <AlertOctagon className="mt-0.5 shrink-0 text-danger-700" size={20} aria-hidden />}
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-[13px] text-ink-500">{detail}</p>
      </div>
    </div>
  );
}

function Backup() {
  const s = useQuery({ queryKey: ['system'], queryFn: () => get<SystemStatus>('/api/v1/admin/system'), refetchInterval: 30_000 });
  const [busy, setBusy] = useState(false);
  if (s.isError) return <ErrorState error={s.error} onRetry={() => s.refetch()} />;
  if (!s.data) return <Skeleton className="h-64" />;
  const x = s.data;
  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Tình trạng hệ thống"
        action={
          <Button
            variant="primary"
            icon={DatabaseBackup}
            loading={busy}
            disabled={x.backup.pending}
            onClick={async () => {
              setBusy(true);
              try {
                await post('/api/v1/admin/backups');
                toast.success('Đã yêu cầu sao lưu. Bản sao lưu bắt đầu trong khoảng 1 phút.');
                await s.refetch();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {x.backup.pending ? 'Đang sao lưu…' : 'Sao lưu ngay'}
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Health ok={!x.backup.stale} label="Sao lưu hằng ngày" detail={x.backup.lastSucceededAt ? `Lần gần nhất ${formatRelative(x.backup.lastSucceededAt)} (${x.backup.ageHours} giờ trước)` : 'Chưa có bản sao lưu thành công'} />
          <Health ok={!x.wal.lagging} label="Sao lưu liên tục (WAL)" detail={!x.wal.archiving ? 'Chưa bật trên máy chủ này' : x.wal.lastArchivedAt ? `Cập nhật ${formatRelative(x.wal.lastArchivedAt)}${x.wal.failedCount ? ` · ${x.wal.failedCount} lần lỗi` : ''}` : 'Chưa gửi được tệp WAL nào'} />
          <Health ok={x.database.ok} label="Cơ sở dữ liệu" detail={`Dung lượng ${size(x.database.sizeBytes)} · phiên bản ${x.version}`} />
          <Health ok={(x.queue.oldestMinutes ?? 0) <= 5} label="Hàng đợi công việc nền" detail={`${x.queue.pendingJobs} việc chờ${x.queue.oldestMinutes != null ? `, lâu nhất ${x.queue.oldestMinutes} phút` : ''} · ${x.queue.outboxPending} sự kiện chờ gửi`} />
        </div>
        {x.backup.stale && (
          <div className="mt-4">
            <InlineAlert tone="danger">Chưa có bản sao lưu thành công trong 26 giờ qua. Hãy báo người phụ trách kỹ thuật.</InlineAlert>
          </div>
        )}
      </Card>
      <Card title="Lần sao lưu gần đây">
        <DataTable
          columns={[
            { header: 'Yêu cầu lúc', cell: (r: SystemStatus['backup']['runs'][number]) => formatDateTime(r.requestedAt) },
            { header: 'Loại', cell: (r) => KIND_LABEL[r.kind] ?? r.kind },
            { header: 'Xong lúc', cell: (r) => (r.finishedAt ? formatDateTime(r.finishedAt) : '—') },
            { header: 'Dung lượng', align: 'right', cell: (r) => size(r.sizeBytes) },
            { header: 'Trạng thái', cell: (r) => <span><StatusChip tone={RUN[r.status]?.tone ?? 'neutral'} {...(r.status === 'requested' && { icon: Clock })}>{RUN[r.status]?.label ?? r.status}</StatusChip>{r.error && <span className="block text-[13px] text-danger-700">{r.error.slice(0, 120)}</span>}</span> },
          ]}
          rows={x.backup.runs}
          rowKey={(r) => r.id}
          minWidth={560}
          empty={{ icon: DatabaseBackup, title: 'Chưa có lần sao lưu nào' }}
        />
      </Card>
      <Card title="Khôi phục và xuất dữ liệu">
        <div className="flex flex-col gap-3 text-sm text-ink-700">
          <p>Khôi phục dữ liệu là quy trình của người phụ trách kỹ thuật (tài liệu “Restore from backup”), cần hai người xác nhận. Máy bán hàng vẫn bán ngoại tuyến trong lúc khôi phục.</p>
          <Facts items={[['Xuất danh mục sản phẩm', <a className="text-navy-700 underline" href="/api/v1/catalog/export">Tải Excel</a>], ['Xuất dữ liệu một khách hàng', 'Trong hồ sơ khách hàng → Xuất dữ liệu cá nhân'], ['Xuất báo cáo', 'Trong trang Báo cáo']]} />
        </div>
      </Card>
    </div>
  );
}
