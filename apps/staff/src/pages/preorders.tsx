import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { CalendarClock, Plus } from 'lucide-react';
import { useState } from 'react';
import { DataTable, FilterMenu, SearchBox, useDebounced, useListParam, useParam, type Column } from '../components/data';
import { Button, PageHeader } from '../components/ui';
import { get } from '../lib/api';
import { formatPhone, formatVnd } from '../lib/format';
import { PREORDER_GROUPS, PreorderChip, PreorderRecord, type PreorderGroup, type PreorderRow } from '../pos/preorders';

/**
 * Pre-orders (“Đặt trước”, FR-POS-09, FR-ORD-14; Design §12.8): every slip for cashiers to see without
 * asking a manager – one list with search (a book’s ISBN finds its slips) and a status filter
 * (open slips by default).
 */

const GROUP_KEYS = Object.keys(PREORDER_GROUPS) as PreorderGroup[];
/** The filter's statuses (SRS B.5) as the stored statuses the API takes. */
const storedStatuses = (keys: string[]) => keys.flatMap((k) => PREORDER_GROUPS[k as PreorderGroup]?.statuses ?? []);

export function PreordersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useParam('q');
  const [status, setStatus] = useListParam('status');
  const [open, setOpen] = useState<PreorderRow | null>(null);
  const term = useDebounced(q.trim(), 250);
  const query = { q: term || undefined, ...(status.length ? { status: storedStatuses(status).join(',') } : { open: 'true' }) };
  const list = useQuery({ queryKey: ['preorders', query], queryFn: () => get<{ items: PreorderRow[] }>('/api/v1/preorders', query), refetchInterval: 30_000 });

  const columns: Column<PreorderRow>[] = [
    { header: 'Mã phiếu', className: 'whitespace-nowrap', cell: (p) => <span className="code">{p.docNo}</span> },
    {
      header: 'Khách hàng',
      cell: (p) => (
        <span>
          {p.customerName}
          <span className="block text-[13px] whitespace-nowrap text-ink-500">{p.customerPhone && formatPhone(p.customerPhone)}</span>
        </span>
      ),
    },
    { header: 'Sách', cell: (p) => <span>{p.lines[0]?.title}{p.lines.length > 1 && <span className="text-ink-500"> +{p.lines.length - 1}</span>}</span> },
    { header: 'Đã cọc', align: 'right', cell: (p) => (p.depositVnd ? formatVnd(p.depositVnd) : <span className="text-ink-500">—</span>) },
    { header: 'Trạng thái', cell: (p) => <PreorderChip p={p} /> },
  ];
  const filtered = !!(term || status.length);

  return (
    <>
      <PageHeader
        title="Đặt trước"
        actions={
          <Button variant="primary" icon={Plus} onClick={() => navigate('/preorders/new')}>
            Thêm
          </Button>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <div className="min-w-0 flex-1 sm:max-w-xl sm:flex-initial sm:basis-xl">
          <SearchBox value={q} onChange={setQ} placeholder="Tìm mã phiếu, khách, SĐT, tên sách, ISBN…" />
        </div>
        <FilterMenu groups={[{ label: 'Trạng thái', options: GROUP_KEYS.map((k) => ({ key: k, label: PREORDER_GROUPS[k].label })), values: status, onChange: setStatus }]} />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(p) => p.id}
        onRow={(p) => setOpen(p)}
        error={list.error}
        onRetry={() => list.refetch()}
        minWidth={820}
        empty={
          filtered
            ? { icon: CalendarClock, title: 'Không có phiếu phù hợp', help: 'Thử bỏ bớt bộ lọc hoặc đổi từ khóa.' }
            : { icon: CalendarClock, title: 'Chưa có phiếu đang mở', help: 'Giữ sách cho khách hoặc nhận đặt sách chưa có bằng nút Thêm.' }
        }
      />
      {open && <PreorderRecord p={open} onClose={() => setOpen(null)} />}
    </>
  );
}
