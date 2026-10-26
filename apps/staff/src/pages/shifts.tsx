import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, ArrowLeft, Wallet } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { DataTable, Facts, FilterMenu, SearchBox, TimeFilter, timeLabel, timeRange, useListParam, useParam, type Column } from '../components/data';
import { Card, ErrorState, PageHeader, Skeleton, StatusChip } from '../components/ui';
import { get } from '../lib/api';
import { formatDateTime, formatNumber, formatVnd } from '../lib/format';
import { METHOD_LABEL } from './sales';

/** Shift history and shift report (FR-POS-18..22, UC-03, Design §11.2 Shift). */

interface ShiftRow {
  id: string;
  shiftNo: number;
  registerCode: string;
  openedBy: string;
  openedAt: string;
  closedAt: string | null;
  floatVnd: number;
  expectedVnd: number | null;
  countedVnd: number | null;
  varianceVnd: number | null;
  varianceReason: string | null;
}

const signed = (v: number) => (v > 0 ? `+${formatVnd(v)}` : formatVnd(v));

export function ShiftStatus({ s }: { s: Pick<ShiftRow, 'closedAt' | 'varianceVnd'> }) {
  if (!s.closedAt) return <StatusChip tone="success">Đang mở</StatusChip>;
  if (s.varianceVnd)
    return (
      <StatusChip tone="danger" icon={AlertOctagon}>
        Lệch {signed(s.varianceVnd)}
      </StatusChip>
    );
  return <StatusChip tone="neutral">Đã đóng</StatusChip>;
}

export function ShiftsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useParam('q');
  const [registers, setRegisters] = useListParam('register');
  const [time, setTime] = useParam('time');
  const regs = useQuery({ queryKey: ['registers'], queryFn: () => get<{ items: { id: string; code: string; name?: string }[] }>('/api/v1/pos/registers') });
  const query = { q: q || undefined, register: registers.join(',') || undefined, ...timeRange(time), limit: 200 };
  const filtered = !!(q || registers.length || time);
  const list = useQuery({ queryKey: ['shifts', query], queryFn: () => get<{ items: ShiftRow[] }>('/api/v1/pos/shifts', query) });
  const columns: Column<ShiftRow>[] = [
    { header: 'Ca', cell: (r) => <span className="code">#{r.shiftNo}</span> },
    { header: 'Quầy', cell: (r) => r.registerCode },
    { header: 'Thu ngân', cell: (r) => r.openedBy },
    { header: 'Mở lúc', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.openedAt) },
    { header: 'Đóng lúc', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.closedAt) || '—' },
    { header: 'Dự kiến', align: 'right', cell: (r) => (r.expectedVnd == null ? '—' : formatVnd(r.expectedVnd)) },
    { header: 'Đếm được', align: 'right', cell: (r) => (r.countedVnd == null ? '—' : formatVnd(r.countedVnd)) },
    { header: 'Trạng thái', cell: (r) => <div><ShiftStatus s={r} />{r.varianceReason && <span className="mt-1 block text-[13px] text-ink-500">{r.varianceReason}</span>}</div> },
  ];
  return (
    <>
      <PageHeader title="Ca làm" />
      {/* Search and filters (Design §12.1) */}
      <div className="mb-4 flex items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm số ca hoặc tên thu ngân…" />
        <FilterMenu
          groups={[
            { label: 'Quầy', options: (regs.data?.items ?? []).map((r) => ({ key: r.id, label: `Quầy ${r.code}` })), values: registers, onChange: setRegisters },
            { kind: 'custom', label: 'Thời gian', summary: timeLabel(time), active: !!time, onClear: () => setTime(''), content: <TimeFilter value={time} onChange={setTime} /> },
          ]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        onRow={(r) => navigate(`/shifts/${r.id}`)}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={filtered ? { icon: Wallet, title: 'Không có ca phù hợp', help: 'Thử bỏ bớt bộ lọc hoặc đổi từ khóa.' } : { icon: Wallet, title: 'Chưa có ca làm nào', help: 'Ca được mở ở màn hình Bán hàng.' }}
      />
    </>
  );
}

interface ShiftReport extends ShiftRow {
  denominations: Record<string, number> | null;
  cash: { cashSalesVnd: number; cashRefundsVnd: number; cashInVnd: number; cashOutVnd: number; expectedVnd: number };
  paymentsByMethod: { method: string; totalVnd: number; sales: number }[];
}

export function ShiftDetailPage() {
  const { id } = useParams();
  const r = useQuery({ queryKey: ['shift', id], queryFn: () => get<ShiftReport>(`/api/v1/pos/shifts/${id}`) });
  if (r.isError) return <ErrorState error={r.error} onRetry={() => r.refetch()} />;
  if (!r.data) return <Skeleton className="h-64" />;
  const s = r.data;
  const expected = s.closedAt ? (s.expectedVnd ?? s.cash.expectedVnd) : s.cash.expectedVnd;
  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/shifts" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Ca làm
          </Link>
        }
        title={`Ca #${s.shiftNo}`}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ShiftStatus s={s} />
        <span className="text-sm text-ink-500">
          {formatDateTime(s.openedAt)}
          {s.closedAt && ` → ${formatDateTime(s.closedAt)}`}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Tiền mặt">
          <Facts
            items={[
              ['Tiền đầu ca', <span className="num">{formatVnd(s.floatVnd)}</span>],
              ['Bán bằng tiền mặt', <span className="num">+{formatVnd(s.cash.cashSalesVnd)}</span>],
              ['Hoàn tiền mặt', <span className="num">−{formatVnd(s.cash.cashRefundsVnd)}</span>],
              ['Thu vào', <span className="num">+{formatVnd(s.cash.cashInVnd)}</span>],
              ['Chi ra', <span className="num">−{formatVnd(s.cash.cashOutVnd)}</span>],
              ['Dự kiến', <span className="font-semibold num">{formatVnd(expected)}</span>],
              ...(s.closedAt
                ? ([
                    ['Đếm được', <span className="font-semibold num">{formatVnd(s.countedVnd ?? 0)}</span>],
                    ['Chênh lệch', <span className={s.varianceVnd ? (s.varianceVnd < 0 ? 'text-danger-700 num' : 'text-warning-700 num') : 'text-success-700'}>{s.varianceVnd ? signed(s.varianceVnd) : 'Khớp'}</span>],
                    ['Lý do', s.varianceReason ?? '—'],
                  ] as [string, React.ReactNode][])
                : []),
            ]}
          />
        </Card>
        <Card title="Doanh thu theo phương thức">
          {s.paymentsByMethod.length === 0 ? (
            <p className="text-ink-500">Chưa có đơn bán trong ca.</p>
          ) : (
            <Facts items={s.paymentsByMethod.map((p) => [`${METHOD_LABEL[p.method] ?? p.method} (${formatNumber(p.sales)} đơn)`, <span className="num">{formatVnd(p.totalVnd)}</span>])} />
          )}
        </Card>
        {s.denominations && (
          <Card title="Mệnh giá đã đếm">
            <Facts
              items={Object.entries(s.denominations)
                .sort((a, b) => Number(b[0]) - Number(a[0]))
                .filter(([, n]) => n > 0)
                .map(([d, n]) => [`${formatNumber(Number(d))} ₫ × ${n}`, <span className="num">{formatVnd(Number(d) * n)}</span>])}
            />
          </Card>
        )}
      </div>
    </>
  );
}
