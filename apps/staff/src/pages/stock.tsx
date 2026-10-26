import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { ApprovalPrompt, DataTable, Facts, SelectField, Tabs, TextArea, toast, type Column } from '../components/data';
import { hitTitle, ProductSearch, type ProductHit } from '../components/product-search';
import { Button, Card, Field, InlineAlert, PageHeader, StatusChip } from '../components/ui';
import { ApiError, get, post } from '../lib/api';
import { formatDateTime, formatNumber, formatVnd } from '../lib/format';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';

/** Stock (FR-INV-01..11): low stock, item history, valuation and adjustments. */

export const MOVEMENT_LABEL: Record<string, string> = {
  stock_in: 'Nhập hàng',
  sale: 'Bán hàng',
  customer_return: 'Khách trả',
  consignment_receipt: 'Nhận ký gửi',
  consignment_return: 'Trả ký gửi',
  adjustment: 'Điều chỉnh',
  count: 'Kiểm kho',
  write_off: 'Hủy hàng',
  bundle_use: 'Xuất cho combo',
  library_transfer: 'Chuyển thư viện',
};
const LOCATION: Record<string, string> = { floor: 'Quầy', back: 'Kho sau' };

interface LowRow {
  variant_id: string;
  sku: string;
  title: string;
  available: number;
  min_stock: number;
}
interface ValRow {
  variant_id: string;
  sku: string;
  on_hand: number;
  avg_cost_vnd: number;
  value_vnd: number;
}

export function StockPage() {
  const { data: me } = useMe();
  const [tab, setTab] = useState<'history' | 'low' | 'value'>('history');
  const [item, setItem] = useState<ProductHit | null>(null);
  const [adjust, setAdjust] = useState(false);
  const low = useQuery({ queryKey: ['low-stock'], queryFn: () => get<{ items: LowRow[] }>('/api/v1/inventory/low-stock'), enabled: tab === 'low' });
  const value = useQuery({ queryKey: ['valuation'], queryFn: () => get<{ items: ValRow[]; totalVnd: number }>('/api/v1/inventory/valuation'), enabled: tab === 'value' });
  return (
    <>
      <PageHeader
        title="Tồn kho"
        actions={
          can(me, 'inventory.adjust') && (
            <Button variant="primary" icon={SlidersHorizontal} onClick={() => setAdjust(true)}>
              Điều chỉnh tồn
            </Button>
          )
        }
      />
      <Tabs
        tabs={[
          { key: 'history', label: 'Lịch sử sản phẩm' },
          { key: 'low', label: 'Sắp hết' },
          ...(can(me, 'catalog.view_cost') ? [{ key: 'value' as const, label: 'Giá trị tồn' }] : []),
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'history' && (
        <div className="flex flex-col gap-4">
          <div className="max-w-xl">
            <ProductSearch onPick={setItem} placeholder="Quét hoặc tìm sản phẩm để xem lịch sử" />
          </div>
          {item ? <ItemHistory item={item} /> : <p className="text-ink-500">Chọn một sản phẩm để xem tồn theo vị trí và mọi lần nhập, bán, trả, điều chỉnh.</p>}
        </div>
      )}
      {tab === 'low' && (
        <DataTable
          columns={[
            { header: 'SKU', cell: (r: LowRow) => <span className="code">{r.sku}</span> },
            { header: 'Sản phẩm', cell: (r) => r.title },
            { header: 'Có thể bán', align: 'right', cell: (r) => <span className={r.available <= 0 ? 'text-danger-700' : ''}>{formatNumber(r.available)}</span> },
            { header: 'Tối thiểu', align: 'right', cell: (r) => formatNumber(r.min_stock) },
            { header: '', cell: (r) => (r.available <= 0 ? <StatusChip tone="danger">Hết hàng</StatusChip> : <StatusChip tone="warning" icon={AlertTriangle}>Sắp hết</StatusChip>) },
          ]}
          rows={low.data?.items}
          rowKey={(r) => r.variant_id}
          error={low.error}
          empty={{ icon: Boxes, title: 'Không có sản phẩm dưới mức tối thiểu' }}
        />
      )}
      {tab === 'value' && (
        <>
          {value.data && (
            <p className="mb-4 text-lg num">
              Tổng giá trị tồn: <span className="font-semibold">{formatVnd(value.data.totalVnd)}</span>
            </p>
          )}
          <DataTable
            columns={[
              { header: 'SKU', cell: (r: ValRow) => <span className="code">{r.sku}</span> },
              { header: 'Tồn', align: 'right', cell: (r) => formatNumber(r.on_hand) },
              { header: 'Giá vốn BQ', align: 'right', cell: (r) => formatVnd(r.avg_cost_vnd) },
              { header: 'Giá trị', align: 'right', cell: (r) => formatVnd(r.value_vnd) },
            ]}
            rows={value.data?.items}
            rowKey={(r) => r.variant_id}
            error={value.error}
            minWidth={480}
            empty={{ icon: Boxes, title: 'Chưa có tồn kho' }}
          />
        </>
      )}
      {adjust && <AdjustDialog initial={item} onClose={() => setAdjust(false)} />}
    </>
  );
}

interface Movement {
  id: string;
  location: string;
  type: string;
  qtyDelta: number;
  unitCostVnd: number | null;
  refType: string;
  at: string;
  note: string | null;
}

function ItemHistory({ item }: { item: ProductHit }) {
  const [type, setType] = useState('');
  const [pages, setPages] = useState<string[]>(['']);
  const cursor = pages[pages.length - 1];
  const levels = useQuery({ queryKey: ['levels', item.variantId], queryFn: () => get<{ items: { location: string; onHand: number; reserved: number; available: number }[] }>('/api/v1/inventory/levels', { variant: item.variantId }) });
  const moves = useQuery({
    queryKey: ['movements', item.variantId, type, cursor],
    queryFn: () => get<{ items: Movement[]; nextCursor: string | null }>('/api/v1/inventory/movements', { variant: item.variantId, type: type || undefined, cursor: cursor || undefined }),
  });
  const columns: Column<Movement>[] = [
    { header: 'Thời gian', cell: (m) => formatDateTime(m.at) },
    { header: 'Loại', cell: (m) => MOVEMENT_LABEL[m.type] ?? m.type },
    { header: 'Vị trí', cell: (m) => LOCATION[m.location] ?? m.location },
    { header: 'Số lượng', align: 'right', cell: (m) => <span className={m.qtyDelta < 0 ? 'text-danger-700' : 'text-success-700'}>{m.qtyDelta > 0 ? '+' : ''}{formatNumber(m.qtyDelta)}</span> },
    { header: 'Ghi chú', cell: (m) => m.note ?? '' },
  ];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-3">
        <SelectField label="Loại giao dịch" className="max-w-xs" value={type} onChange={(e) => (setType(e.target.value), setPages(['']))}>
          <option value="">Tất cả</option>
          {Object.entries(MOVEMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <DataTable columns={columns} rows={moves.data?.items} rowKey={(m) => m.id} error={moves.error} minWidth={560} empty={{ icon: Boxes, title: 'Chưa có giao dịch' }} />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={pages.length <= 1} onClick={() => setPages(pages.slice(0, -1))}>
            ‹ Mới hơn
          </Button>
          <Button size="sm" variant="ghost" disabled={!moves.data?.nextCursor} onClick={() => setPages([...pages, moves.data!.nextCursor!])}>
            Cũ hơn ›
          </Button>
        </div>
      </div>
      <Card title={hitTitle(item)}>
        <p className="mb-3 code text-[13px] text-ink-500">{item.sku}</p>
        <Facts items={(levels.data?.items ?? []).flatMap((l) => [[`${LOCATION[l.location] ?? l.location} · tồn`, <span className="num">{formatNumber(l.onHand)}</span>] as [string, React.ReactNode], [`${LOCATION[l.location] ?? l.location} · giữ chỗ`, <span className="num">{formatNumber(l.reserved)}</span>] as [string, React.ReactNode]])} />
      </Card>
    </div>
  );
}

function AdjustDialog({ initial, onClose }: { initial: ProductHit | null; onClose: () => void }) {
  const [item, setItem] = useState<ProductHit | null>(initial);
  const [delta, setDelta] = useState('');
  const [location, setLocation] = useState('floor');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [writeOff, setWriteOff] = useState(false);
  const [approve, setApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasons = useQuery({ queryKey: ['master', 'reason_code'], queryFn: () => get<{ items: { code: string; i18n: { vi?: string; en?: string } | { vi?: { name: string } } }[] }>('/api/v1/admin/master-data/reason_code') });
  const label = (i18n: unknown, code: string) => {
    const x = i18n as { vi?: { name?: string } | string; en?: { name?: string } | string };
    const v = typeof x.vi === 'string' ? x.vi : x.vi?.name;
    const e = typeof x.en === 'string' ? x.en : x.en?.name;
    return v || e || code;
  };
  const qty = Number(delta.replace(/[^\d-]/g, ''));

  const run = async (approvalToken?: string) => {
    setBusy(true);
    setError(null);
    try {
      await post('/api/v1/inventory/adjustments', { variantId: item!.variantId, location, qtyDelta: qty, reasonCode: reason, ...(note.trim() && { note: note.trim() }), writeOff, ...(approvalToken && { approvalToken }) });
      toast.success('Đã ghi điều chỉnh tồn kho.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'approval_required') setApprove(true);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (approve && item)
    return (
      <ApprovalPrompt
        action="stock_adjustment"
        subject={item.variantId}
        reason={`Điều chỉnh ${qty > 0 ? '+' : ''}${qty} ${hitTitle(item)} vượt hạn mức, cần quản lý duyệt.`}
        onClose={() => setApprove(false)}
        onToken={(tk) => {
          setApprove(false);
          void run(tk);
        }}
      />
    );

  return (
    <Dialog
      title="Điều chỉnh tồn kho"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!item || !qty || !reason} onClick={() => void run()}>
            Lưu điều chỉnh
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {item ? (
          <div className="flex items-center justify-between rounded-md bg-paper-100 px-3 py-2">
            <span>
              {hitTitle(item)} <span className="code text-[13px] text-ink-500">{item.sku}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setItem(null)}>
              Đổi
            </Button>
          </div>
        ) : (
          <ProductSearch onPick={setItem} autoFocus />
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Số lượng (+ tăng, − giảm)" required inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} />
          <SelectField label="Vị trí" value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="floor">Quầy</option>
            <option value="back">Kho sau</option>
          </SelectField>
          <SelectField label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">— Chọn —</option>
            {reasons.data?.items.map((r) => (
              <option key={r.code} value={r.code}>
                {label(r.i18n, r.code)}
              </option>
            ))}
          </SelectField>
          <label className="inline-flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="size-5" checked={writeOff} onChange={(e) => setWriteOff(e.target.checked)} />
            Hủy hàng (ghi giảm giá trị)
          </label>
        </div>
        <TextArea label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}
