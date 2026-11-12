import { CHANNEL_KINDS } from '@bookstore/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, HandCoins, Plus, RadioTower } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ConfirmDialog, DataTable, SelectField, Tabs, toast, useParam, type Column } from '../components/data';
import { ORDER_SOURCE } from '../components/order-ui';
import { Button, ErrorState, Field, InlineAlert, PageHeader, Skeleton, StatusChip, type Tone } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { formatDateTime, formatVnd } from '../lib/format';
import { Dialog, MoneyInput } from '../pos/widgets';

/**
 * COD reconciliation (FR-ORD-11), channel profiles (FR-SOC-01) and the product share card (FR-SOC-04). Pre-orders are in the POS.
 */

// =============================================================================================
// COD reconciliation (FR-ORD-11)

interface Remittance {
  id: string;
  status: string;
  expectedVnd: number;
  receivedVnd: number | null;
  statementRef: string | null;
  createdAt: string;
  trackingNo: string;
  orderId: string;
  docNo: string;
}

const COD_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Chờ đối soát', tone: 'warning' },
  matched: { label: 'Đã khớp', tone: 'success' },
  difference: { label: 'Chênh lệch', tone: 'danger' },
};

export function CodPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useParam('status', 'pending');
  const [row, setRow] = useState<Remittance | null>(null);
  const list = useQuery({ queryKey: ['cod', status], queryFn: () => get<{ items: Remittance[] }>('/api/v1/cod/remittances', { status: status === 'all' ? undefined : status }) });
  const columns: Column<Remittance>[] = [
    { header: 'Mã vận đơn', cell: (r) => <span className="code">{r.trackingNo}</span> },
    { header: 'Đơn', cell: (r) => <span className="code">{r.docNo}</span> },
    { header: 'Giao xong', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.createdAt) },
    { header: 'Phải thu', align: 'right', cell: (r) => formatVnd(r.expectedVnd) },
    { header: 'GHN đã trả', align: 'right', cell: (r) => (r.receivedVnd === null ? '' : formatVnd(r.receivedVnd)) },
    { header: 'Bảng kê', cell: (r) => r.statementRef ?? '' },
    { header: 'Trạng thái', cell: (r) => <StatusChip tone={COD_STATUS[r.status]!.tone}>{COD_STATUS[r.status]!.label}</StatusChip> },
  ];
  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/orders" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Giao hàng
          </Link>
        }
        title="Đối soát COD"
      />
      <div className="mb-4">
        <Tabs
          tabs={[
            { key: 'pending', label: 'Chờ đối soát' },
            { key: 'difference', label: 'Chênh lệch' },
            { key: 'matched', label: 'Đã khớp' },
          ]}
          value={status}
          onChange={setStatus}
        />
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        onRow={(r) => (r.status === 'matched' ? navigate(`/orders/${r.orderId}`) : setRow(r))}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={{ icon: HandCoins, title: 'Không có khoản thu hộ nào', help: 'Đơn COD giao xong sẽ chờ đối soát với bảng kê GHN ở đây.' }}
      />
      {row && <ReconcileDialog row={row} onClose={() => setRow(null)} onDone={() => void qc.invalidateQueries({ queryKey: ['cod'] })} />}
    </>
  );
}

function ReconcileDialog({ row, onClose, onDone }: { row: Remittance; onClose: () => void; onDone: () => void }) {
  const [received, setReceived] = useState<number | null>(row.expectedVnd);
  const [ref, setRef] = useState(row.statementRef ?? '');
  return (
    <ConfirmDialog
      title={`Đối soát ${row.trackingNo}`}
      body={`Phải thu ${formatVnd(row.expectedVnd)} cho đơn ${row.docNo}.`}
      confirm="Lưu đối soát"
      onClose={onClose}
      onConfirm={async () => {
        const r = await post<{ status: string; differenceVnd: number }>(`/api/v1/cod/remittances/${row.id}/reconcile`, { receivedVnd: received ?? 0, statementRef: ref.trim() });
        if (r.status === 'matched') toast.success('Đã khớp.');
        else toast.error(`Chênh lệch ${formatVnd(r.differenceVnd)}. Hãy liên hệ GHN.`);
        onDone();
      }}
    >
      <MoneyInput label="GHN đã trả" value={received} onChange={setReceived} autoFocus />
      <Field label="Mã bảng kê" required value={ref} onChange={(e) => setRef(e.target.value)} />
    </ConfirmDialog>
  );
}

// =============================================================================================
// Channel profiles (FR-SOC-01)

interface Channel {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  handle: string | null;
  active: boolean;
}

/** Channel profiles, a tab of Cài đặt (FR-SOC-01). */
export function ChannelsPanel() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<Channel | 'new' | null>(null);
  const list = useQuery({ queryKey: ['channels', 'all'], queryFn: () => get<{ items: Channel[] }>('/api/v1/channels') });
  const columns: Column<Channel>[] = [
    { header: 'Tên', cell: (c) => <span className="font-medium">{c.name}</span> },
    { header: 'Loại', cell: (c) => ORDER_SOURCE[c.kind] ?? c.kind },
    { header: 'Tài khoản', cell: (c) => c.handle ?? '' },
    { header: 'Địa chỉ', cell: (c) => (c.url ? <span className="break-all text-ink-700">{c.url}</span> : '') },
    { header: 'Trạng thái', cell: (c) => (c.active ? <StatusChip tone="success">Đang dùng</StatusChip> : <StatusChip tone="neutral">Ngừng dùng</StatusChip>) },
  ];
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-sm text-ink-500">Trang và tài khoản bán hàng, để chọn khi tạo đơn.</p>
        <Button variant="primary" icon={Plus} onClick={() => setEdit('new')}>
          Thêm kênh
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(c) => c.id}
        onRow={setEdit}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={{ icon: RadioTower, title: 'Chưa có kênh nào', help: 'Thêm fanpage, Zalo OA, Instagram, TikTok hoặc gian hàng sàn để chọn khi tạo đơn.' }}
      />
      {edit && <ChannelDialog channel={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={() => void qc.invalidateQueries({ queryKey: ['channels'] })} />}
    </>
  );
}

function ChannelDialog({ channel, onClose, onDone }: { channel: Channel | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: channel?.name ?? '', kind: channel?.kind ?? 'facebook', url: channel?.url ?? '', handle: channel?.handle ?? '', active: channel?.active ?? true });
  return (
    <ConfirmDialog
      title={channel ? 'Sửa kênh' : 'Thêm kênh'}
      confirm="Lưu"
      onClose={onClose}
      onConfirm={async () => {
        const body = { name: f.name.trim(), kind: f.kind, url: f.url.trim() || null, handle: f.handle.trim() || null, active: f.active };
        if (channel) await patch(`/api/v1/channels/${channel.id}`, body);
        else await post('/api/v1/channels', body);
        toast.success('Đã lưu kênh.');
        onDone();
      }}
    >
      <Field label="Tên" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <SelectField label="Loại" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
        {CHANNEL_KINDS.map((k) => (
          <option key={k} value={k}>
            {ORDER_SOURCE[k]}
          </option>
        ))}
      </SelectField>
      <Field label="Tài khoản" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} />
      <Field label="Địa chỉ trang" inputMode="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5 accent-navy-700" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
        Đang dùng
      </label>
    </ConfirmDialog>
  );
}

/** Share card for a product (FR-SOC-04): copy-ready text and link. */
export function ShareCardDialog({ variantId, onClose }: { variantId: string; onClose: () => void }) {
  const card = useQuery({ queryKey: ['share-card', variantId], queryFn: () => post<{ text: string; url: string | null }>('/api/v1/share-links', { variantId }) });
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      title="Chia sẻ sản phẩm"
      size="sm"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          disabled={!card.data}
          onClick={async () => {
            await navigator.clipboard.writeText(card.data!.text);
            setCopied(true);
            toast.success('Đã sao chép nội dung.');
          }}
        >
          {copied ? 'Đã sao chép' : 'Sao chép nội dung'}
        </Button>
      }
    >
      {card.isError ? (
        <ErrorState error={card.error} />
      ) : !card.data ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="flex flex-col gap-3">
          <pre className="rounded-lg border border-paper-300 bg-paper-200 p-4 font-sans text-sm whitespace-pre-wrap text-ink-900">{card.data.text}</pre>
          {!card.data.url && <InlineAlert tone="info">Chưa có địa chỉ trang sản phẩm trên website (Cấu hình → web.product_url), nên nội dung chưa có liên kết.</InlineAlert>}
        </div>
      )}
    </Dialog>
  );
}

