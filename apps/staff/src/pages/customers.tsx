import { ORDER_SOURCE } from '../components/order-ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, GitMerge, MoreHorizontal, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ConfirmDialog, DataTable, Facts, FilterMenu, SearchBox, TextArea, toast, useListParam, useParam, type Column } from '../components/data';
import { Button, Card, ErrorState, Field, InlineAlert, PageHeader, Skeleton, StatusChip } from '../components/ui';
import { defaultTiers } from '@bookstore/domain';
import { ApiError, get, patch, post } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, formatPhone, formatVnd } from '../lib/format';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';
import { CustomerLibrarySection } from './library';

/** Customers and loyalty points (FR-CRM-01..09, Design §12.1, §12.3). */

interface CustomerRow {
  id: string;
  name: string;
  phoneE164: string | null;
  email: string | null;
  pointsBalance: number;
  tierName: string | null;
  orders: number;
  ordersVnd: number;
  lastActivityAt: string | null;
}

/** Default tiers (TDD §4.9), as in the promotion scope picker. */
const TIER_OPTIONS = defaultTiers(0, 0).map((t) => ({ key: t.code, label: t.name }));

export function CustomersPage() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [q, setQ] = useParam('q');
  const [tier, setTier] = useListParam('tier');
  const [lastActivity, setLastActivity] = useParam('lastActivity');
  const [services, setServices] = useParam('services');
  const [orders, setOrders] = useListParam('orders');
  const [points, setPoints] = useListParam('points');
  const [creating, setCreating] = useState(false);
  const query = { q: q || undefined, tier: tier.join(',') || undefined, lastActivity: lastActivity || undefined, services: services || undefined, orders: orders.join(',') || undefined, points: points.join(',') || undefined };
  const filtered = !!(tier.length || lastActivity || services || orders.length || points.length);
  const list = useQuery({ queryKey: ['customers', query], queryFn: () => get<{ items: CustomerRow[] }>('/api/v1/customers', query) });
  const columns: Column<CustomerRow>[] = [
    { header: 'Khách hàng', cell: (r) => <span className="font-medium">{r.name}</span> },
    { header: 'Số điện thoại', className: 'whitespace-nowrap', cell: (r) => (r.phoneE164 ? <span className="num">{formatPhone(r.phoneE164)}</span> : '—') },
    { header: 'Hạng', cell: (r) => (r.tierName ? <StatusChip tone="brand">{r.tierName}</StatusChip> : '—') },
    { header: 'Điểm', align: 'right', cell: (r) => formatNumber(r.pointsBalance) },
    { header: 'Số đơn', align: 'right', cell: (r) => formatNumber(r.orders) },
    { header: 'Tổng mua', align: 'right', cell: (r) => formatVnd(r.ordersVnd) },
    // Shop and library alike, date only (FR-CRM-02, Design §12.1).
    { header: 'Hoạt động gần nhất', className: 'whitespace-nowrap', cell: (r) => (r.lastActivityAt ? <span className="num">{formatDate(r.lastActivityAt)}</span> : '—') },
  ];
  return (
    <>
      <PageHeader
        title="Khách hàng"
        actions={
          can(me, 'customer.manage') && (
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              Thêm khách hàng
            </Button>
          )
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm theo tên, số điện thoại, email…" />
        {/* Filters (FR-CRM-02, Design §12.1) */}
        <FilterMenu
          groups={[
            { label: 'Hạng', options: TIER_OPTIONS, values: tier, onChange: setTier },
            {
              kind: 'single',
              label: 'Hoạt động gần nhất',
              options: [
                { key: '30d', label: '30 ngày qua' },
                { key: '90d', label: '90 ngày qua' },
                { key: '180d', label: '6 tháng qua' },
                { key: 'over180d', label: 'Hơn 6 tháng không hoạt động' },
                { key: 'never', label: 'Chưa hoạt động lần nào' },
              ],
              value: lastActivity,
              onChange: setLastActivity,
            },
            {
              kind: 'single',
              label: 'Dịch vụ sử dụng',
              // No choice is “Tất cả” (FR-CRM-02, Design §12.1).
              options: [
                { key: 'shop', label: 'Chỉ mua hàng' },
                { key: 'library', label: 'Chỉ thư viện' },
              ],
              value: services,
              onChange: setServices,
            },
            {
              label: 'Số đơn',
              options: [
                { key: '0', label: 'Chưa có đơn' },
                { key: '1', label: '1 đơn' },
                { key: '2-5', label: '2–5 đơn' },
                { key: '6-10', label: '6–10 đơn' },
                { key: '11+', label: 'Trên 10 đơn' },
              ],
              values: orders,
              onChange: setOrders,
            },
            {
              label: 'Điểm',
              options: [
                { key: '0', label: '0 điểm' },
                { key: '1-99', label: '1–99 điểm' },
                { key: '100-499', label: '100–499 điểm' },
                { key: '500-999', label: '500–999 điểm' },
                { key: '1000+', label: 'Từ 1.000 điểm' },
              ],
              values: points,
              onChange: setPoints,
            },
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        onRow={(r) => navigate(`/customers/${r.id}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        minWidth={760}
        empty={{ icon: Users, title: q ? `Không tìm thấy khách hàng “${q}”` : filtered ? 'Không có khách hàng phù hợp' : 'Chưa có khách hàng', help: 'Tìm không dấu cũng được, hoặc theo 4 số cuối điện thoại.' }}
      />
      {creating && <CustomerForm onClose={() => setCreating(false)} onSaved={(id) => navigate(`/customers/${id}`)} />}
    </>
  );
}

interface Customer extends CustomerRow {
  birthDate: string | null;
  note: string | null;
  tags: string[];
  source: string | null;
  tierCode: string | null;
  anonymisedAt: string | null;
  mergedInto: string | null;
  createdAt: string;
  version: number;
  pointsLedger: { id: string; delta: number; reason: string; note: string | null; at: string; expiresAt: string | null }[];
}

const REASON: Record<string, string> = {
  earn: 'Tích điểm',
  redeem: 'Đổi điểm',
  adjust: 'Điều chỉnh',
  expire: 'Hết hạn',
  return: 'Trả hàng',
  reverse: 'Thu hồi',
  void: 'Hủy đơn',
  merge: 'Gộp hồ sơ',
  import: 'Nhập dữ liệu',
  redeem_refund: 'Hoàn điểm đã đổi',
  return_reversal: 'Thu hồi do trả hàng',
};

function CustomerForm({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState({
    name: customer?.name ?? '',
    phone: customer?.phoneE164 ? formatPhone(customer.phoneE164) : '',
    email: customer?.email ?? '',
    birthDate: customer?.birthDate ?? '',
    note: customer?.note ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    setError(null);
    setDup(null);
    try {
      if (customer) {
        await patch(`/api/v1/customers/${customer.id}`, { name: f.name, phone: f.phone, email: f.email || null, birthDate: f.birthDate || null, note: f.note || null, version: customer.version });
        toast.success('Đã lưu hồ sơ khách hàng.');
        onSaved(customer.id);
      } else {
        const r = await post<{ id: string }>('/api/v1/customers', { name: f.name, phone: f.phone, ...(f.email && { email: f.email }), ...(f.birthDate && { birthDate: f.birthDate }), ...(f.note && { note: f.note }) });
        toast.success('Đã thêm khách hàng.');
        onSaved(r.id);
      }
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate_phone') setDup((e.details as { customerId: string }).customerId);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={customer ? 'Sửa khách hàng' : 'Thêm khách hàng'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!f.name.trim() || !f.phone.trim()} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Họ tên" required value={f.name} onChange={set('name')} className="sm:col-span-2" autoFocus />
        <Field label="Số điện thoại" required inputMode="tel" value={f.phone} onChange={set('phone')} />
        <Field label="Email" type="email" value={f.email} onChange={set('email')} />
        <Field label="Ngày sinh" type="date" value={f.birthDate} onChange={set('birthDate')} />
        <TextArea label="Ghi chú" value={f.note} onChange={set('note')} className="sm:col-span-2" />
        {error && (
          <div className="sm:col-span-2">
            <InlineAlert tone="danger">
              {error}{' '}
              {dup && (
                <Link to={`/customers/${dup}`} className="underline" onClick={onClose}>
                  Mở hồ sơ đó
                </Link>
              )}
            </InlineAlert>
          </div>
        )}
      </div>
    </Dialog>
  );
}

interface Purchases {
  items: { id: string; kind: 'sale' | 'order'; docNo: string; soldAt: string; channel: string; status: string; totalVnd: number; returnsVnd: number; pointsEarned: number }[];
  totals: { orders: number; grossVnd: number; returnsVnd: number; netVnd: number };
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const c = useQuery({ queryKey: ['customer', id], queryFn: () => get<Customer>(`/api/v1/customers/${id}`) });
  const purchases = useQuery({ queryKey: ['customer-purchases', id], queryFn: () => get<Purchases>(`/api/v1/customers/${id}/purchases`) });
  const [dialog, setDialog] = useState<null | 'edit' | 'points' | 'merge' | 'erase' | 'menu'>(null);

  if (c.isError) return <ErrorState error={c.error} onRetry={() => c.refetch()} />;
  if (!c.data) return <Skeleton className="h-64" />;
  const x = c.data;
  const erased = !!x.anonymisedAt;
  const refresh = () => {
    void c.refetch();
    void purchases.refetch();
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/customers" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Khách hàng
          </Link>
        }
        title={x.name}
        // Icon-only “Sửa” directly beside ⋯ on the title row (Design §12.3).
        menu={
          !erased && (
            <div className="flex items-center gap-1">
              {can(me, 'customer.manage') && <Button variant="ghost" icon={Pencil} aria-label="Sửa" title="Sửa" onClick={() => setDialog('edit')} />}
              {(can(me, 'customer.manage') || can(me, 'customer.erase')) && <Button variant="ghost" icon={MoreHorizontal} aria-label="Thao tác khác" onClick={() => setDialog('menu')} />}
            </div>
          )
        }
      />
      {erased && (
        <div className="mb-4">
          <InlineAlert tone="info">Dữ liệu cá nhân đã được xóa theo yêu cầu ngày {formatDate(x.anonymisedAt)}. Lịch sử mua hàng vẫn được giữ.</InlineAlert>
        </div>
      )}
      {x.mergedInto && (
        <div className="mb-4">
          <InlineAlert tone="info">
            Hồ sơ này đã được gộp vào{' '}
            <Link className="underline" to={`/customers/${x.mergedInto}`}>
              hồ sơ khác
            </Link>
            .
          </InlineAlert>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* One page, no tabs: purchases, then points (Design §12.3). */}
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <h2 className="mb-3 text-base font-semibold text-ink-900">
              Mua hàng{purchases.data && <span className="font-normal text-ink-500 num"> ({formatNumber(purchases.data.items.length)})</span>}
            </h2>
            <DataTable
              columns={[
                { header: 'Mã đơn', cell: (r) => <span className="code">{r.docNo}</span> },
                { header: 'Thời gian', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.soldAt) },
                // Counter or the online source (FR-CRM-03); text only, no colour dot (Design §10.5).
                { header: 'Kênh', cell: (r) => (r.kind === 'sale' ? 'Tại quầy' : (ORDER_SOURCE[r.channel] ?? r.channel)) },
                {
                  header: 'Trạng thái',
                  cell: (r) =>
                    r.status === 'voided' || r.status === 'cancelled' ? (
                      <StatusChip tone="neutral">Đã hủy</StatusChip>
                    ) : r.status === 'open' ? (
                      <StatusChip tone="info">Đang xử lý</StatusChip>
                    ) : (
                      <StatusChip tone="success">Hoàn tất</StatusChip>
                    ),
                },
                { header: 'Tổng', align: 'right', cell: (r) => formatVnd(r.totalVnd) },
                { header: 'Đã trả', align: 'right', cell: (r) => (r.returnsVnd ? formatVnd(r.returnsVnd) : '') },
                { header: 'Điểm', align: 'right', cell: (r) => (r.pointsEarned ? `+${formatNumber(r.pointsEarned)}` : '') },
              ]}
              rows={purchases.data?.items}
              rowKey={(r) => r.id}
              onRow={(r) => navigate(r.kind === 'order' ? `/orders/${r.id}` : `/sales/${r.id}`)}
              error={purchases.error}
              minWidth={560}
              empty={{ icon: Users, title: 'Chưa có đơn mua' }}
            />
          </section>
          <Ledger
            rows={x.pointsLedger.map((l) => ({ id: l.id, at: l.at, reason: REASON[l.reason] ?? l.reason, note: l.note, amount: `${l.delta > 0 ? '+' : ''}${formatNumber(l.delta)}`, extra: l.expiresAt ? `Hết hạn ${formatDate(l.expiresAt)}` : null }))}
            action={!erased && can(me, 'customer.adjust_points') && <Button variant="tonal" size="sm" onClick={() => setDialog('points')}>Điều chỉnh điểm</Button>}
          />
          {(can(me, 'library.lend') || can(me, 'library.manage')) && <CustomerLibrarySection customerId={x.id} />}
        </div>
        <div className="flex flex-col gap-6">
          <Card title="Hồ sơ">
            <Facts
              items={[
                ['Số điện thoại', x.phoneE164 ? <span className="num">{formatPhone(x.phoneE164)}</span> : '—'],
                ['Email', x.email],
                ['Ngày sinh', x.birthDate ? formatDate(x.birthDate) : null],
                ['Hạng', x.tierName ? <StatusChip tone="brand">{x.tierName}</StatusChip> : null],
                ['Điểm', <span className="font-semibold num">{formatNumber(x.pointsBalance)}</span>],
                ['Khách từ', formatDate(x.createdAt)],
              ]}
            />
            {x.note && <p className="mt-4 text-sm text-ink-700">{x.note}</p>}
          </Card>
          {purchases.data && (
            <Card title="Tổng mua">
              <Facts
                items={[
                  ['Số đơn', formatNumber(purchases.data.totals.orders)],
                  ['Doanh số', <span className="num">{formatVnd(purchases.data.totals.grossVnd)}</span>],
                  ['Trả hàng', <span className="num">{formatVnd(purchases.data.totals.returnsVnd)}</span>],
                  ['Thực mua', <span className="font-semibold num">{formatVnd(purchases.data.totals.netVnd)}</span>],
                ]}
              />
            </Card>
          )}
        </div>
      </div>

      {dialog === 'edit' && <CustomerForm customer={x} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog === 'menu' && (
        <Dialog title="Thao tác" size="sm" onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-2">
            {can(me, 'customer.manage') && (
              <Button variant="secondary" full icon={GitMerge} onClick={() => setDialog('merge')}>
                Gộp hồ sơ trùng vào đây
              </Button>
            )}
            {can(me, 'customer.erase') && (
              <>
                <a className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-paper-500 text-sm font-medium hover:bg-navy-50" href={`/api/v1/customers/${x.id}/export`} download>
                  <Download size={20} aria-hidden /> Xuất dữ liệu cá nhân
                </a>
                <Button variant="destructive-outline" full icon={Trash2} onClick={() => setDialog('erase')}>
                  Xóa dữ liệu cá nhân
                </Button>
              </>
            )}
          </div>
        </Dialog>
      )}
      {dialog === 'points' && <AdjustDialog customerId={x.id} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'merge' && <MergeDialog target={x} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'erase' && <EraseDialog customer={x} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

function Ledger({ rows, action }: { rows: { id: string; at: string; reason: string; note: string | null; amount: string; extra: string | null }[]; action: React.ReactNode }) {
  return (
    <Card title="Điểm" action={action}>
      {rows.length === 0 ? (
        <p className="text-ink-500">Chưa có giao dịch.</p>
      ) : (
        <ul className="divide-y divide-paper-300 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 py-2">
              <span>
                <span className="font-medium">{r.reason}</span>
                <span className="block text-[13px] text-ink-500">
                  {formatDateTime(r.at)}
                  {r.note && ` · ${r.note}`}
                  {r.extra && ` · ${r.extra}`}
                </span>
              </span>
              <span className="font-semibold num">{r.amount}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AdjustDialog({ customerId, onClose, onDone }: { customerId: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const value = Number(amount.replace(/[^\d-]/g, ''));
  return (
    <ConfirmDialog
      title="Điều chỉnh điểm"
      confirm="Lưu điều chỉnh"
      onClose={onClose}
      onConfirm={async () => {
        await post(`/api/v1/customers/${customerId}/points-adjust`, { delta: value, reason });
        toast.success('Đã lưu điều chỉnh.');
        onDone();
      }}
    >
      <Field label="Số điểm (+ cộng, − trừ)" required inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      <TextArea label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} />
    </ConfirmDialog>
  );
}

function MergeDialog({ target, onClose, onDone }: { target: Customer; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState<CustomerRow | null>(null);
  const found = useQuery({ queryKey: ['customers', q], queryFn: () => get<{ items: CustomerRow[] }>('/api/v1/customers', { q }), enabled: q.length >= 2 });
  return (
    <ConfirmDialog
      title="Gộp hồ sơ trùng"
      body={`Điểm và lịch sử mua của hồ sơ được chọn sẽ chuyển sang ${target.name}. Hồ sơ đó sẽ đóng lại. Không hoàn tác được.`}
      confirm="Gộp hồ sơ"
      destructive
      onClose={onClose}
      onConfirm={async () => {
        if (!source) throw new Error('Hãy chọn hồ sơ cần gộp.');
        await post(`/api/v1/customers/${target.id}/merge`, { sourceId: source.id });
        toast.success(`Đã gộp ${source.name} vào ${target.name}.`);
        onDone();
      }}
    >
      <Field label="Tìm hồ sơ trùng (tên hoặc SĐT)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="max-h-60 divide-y divide-paper-300 overflow-y-auto">
        {found.data?.items
          .filter((r) => r.id !== target.id)
          .map((r) => (
            <li key={r.id}>
              <label className="flex cursor-pointer items-center gap-3 py-2">
                <input type="radio" name="merge-source" className="size-5" checked={source?.id === r.id} onChange={() => setSource(r)} />
                <span>
                  {r.name}
                  <span className="block text-[13px] text-ink-500 num">
                    {r.phoneE164 && formatPhone(r.phoneE164)} · {formatNumber(r.pointsBalance)} điểm
                  </span>
                </span>
              </label>
            </li>
          ))}
      </ul>
    </ConfirmDialog>
  );
}

function EraseDialog({ customer, onClose, onDone }: { customer: Customer; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  return (
    <ConfirmDialog
      title={`Xóa dữ liệu cá nhân của ${customer.name}?`}
      body="Tên, số điện thoại, email và địa chỉ sẽ bị xóa vĩnh viễn; lịch sử mua và chứng từ kế toán được giữ. Không hoàn tác được."
      confirm="Xóa dữ liệu"
      destructive
      onClose={onClose}
      onConfirm={async () => {
        if (typed.trim().toUpperCase() !== 'XOA') throw new Error('Gõ XOA để xác nhận.');
        await post(`/api/v1/customers/${customer.id}/erase`, { reason });
        toast.success('Đã xóa dữ liệu cá nhân.');
        onDone();
      }}
    >
      <TextArea label="Lý do (yêu cầu của khách)" required value={reason} onChange={(e) => setReason(e.target.value)} />
      <Field label="Gõ XOA để xác nhận" value={typed} onChange={(e) => setTyped(e.target.value)} />
    </ConfirmDialog>
  );
}
