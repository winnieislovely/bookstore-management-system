import { normalizePaymentRef, ORDER_SOURCES, paymentRefFromBytes } from '@bookstore/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { CalendarClock, PackageCheck, Plus, Truck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, SelectField, Tabs, TextArea, toast, useDebounced } from '../components/data';
import { CopyCode, ORDER_SOURCE } from '../components/order-ui';
import { ProductSearch, hitTitle, type ProductHit } from '../components/product-search';
import { Button, EmptyState, ErrorState, Field, InlineAlert, Skeleton, StatusChip, type Tone } from '../components/ui';
import { get, post } from '../lib/api';
import { formatDate, formatNumber, formatPhone, formatVnd } from '../lib/format';
import type { CartCustomer, CartPreorder } from './cart';
import { Dialog, MoneyInput } from './widgets';

/**
 * Pre-orders at the POS (FR-POS-09, FR-ORD-14, Design §13.1): take a pre-order with its deposit,
 * see the list, recall an arrived one into the cart, mark it ordered or cancel it. Needs the server.
 */

const STATUS: Record<string, { label: string; tone: Tone }> = {
  reserved: { label: 'Đã đặt', tone: 'neutral' },
  ordered: { label: 'Đã đặt NCC', tone: 'info' },
  arrived: { label: 'Đã về', tone: 'accent' },
  contacted: { label: 'Đã liên hệ', tone: 'info' },
  collected: { label: 'Đã nhận', tone: 'success' },
  cancelled: { label: 'Đã hủy', tone: 'neutral' },
};

export interface PreorderRow {
  id: string;
  docNo: string;
  status: string;
  createdAt: string;
  variantId: string;
  qty: number;
  unitPriceVnd: number;
  depositVnd: number;
  depositMethod: string | null;
  expiresAt: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  customerTierCode: string | null;
  customerPoints: number;
  sku: string;
  title: string;
}

function PreorderChip({ p }: { p: PreorderRow }) {
  // Holding-period countdown, turning to a warning in the last 2 days (Design §11.2).
  if (p.status === 'contacted' && p.expiresAt) {
    const left = Math.ceil((new Date(p.expiresAt).getTime() - Date.now()) / 86_400_000);
    return <StatusChip tone={left <= 2 ? 'warning' : 'info'}>{left > 0 ? `Đã liên hệ · còn ${left} ngày` : 'Quá hạn giữ hàng'}</StatusChip>;
  }
  const s = STATUS[p.status] ?? { label: p.status, tone: 'neutral' as Tone };
  return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
}

export function PreorderDialog({
  shiftId,
  online,
  onCollect,
  onClose,
}: {
  /** The open shift on the server: cash deposits go into its drawer. */
  shiftId: string | null;
  online: boolean;
  onCollect: (p: CartPreorder, customer: CartCustomer) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'list' | 'new'>('list');
  const [action, setAction] = useState<null | { p: PreorderRow; kind: 'cancel' }>(null);
  if (!online || !shiftId) {
    return (
      <Dialog title="Đặt trước" size="sm" onClose={onClose}>
        <InlineAlert tone="warning">Cần kết nối mạng để tạo, tra cứu hoặc nhận hàng đặt trước.</InlineAlert>
      </Dialog>
    );
  }
  if (action) return <CancelPreorder p={action.p} shiftId={shiftId} onClose={() => setAction(null)} />;
  return (
    <Dialog title="Đặt trước" size="lg" onClose={onClose}>
      <Tabs
        tabs={[
          { key: 'list', label: 'Danh sách phiếu' },
          { key: 'new', label: 'Tạo phiếu' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'list' ? (
        <PreorderList
          onCollect={(p) =>
            onCollect(
              { id: p.id, docNo: p.docNo, variantId: p.variantId, qty: p.qty, unitPriceVnd: p.unitPriceVnd, depositVnd: p.depositVnd },
              { id: p.customerId, name: p.customerName, phoneE164: p.customerPhone, tierCode: p.customerTierCode, pointsBalance: p.customerPoints },
            )
          }
          onCancel={(p) => setAction({ p, kind: 'cancel' })}
        />
      ) : (
        <NewPreorder shiftId={shiftId} onDone={() => setTab('list')} />
      )}
    </Dialog>
  );
}

function PreorderList({ onCollect, onCancel }: { onCollect: (p: PreorderRow) => void; onCancel: (p: PreorderRow) => void }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(true);
  const term = useDebounced(q.trim(), 300);
  const list = useQuery({
    queryKey: ['preorders', term, open],
    queryFn: () => get<{ items: PreorderRow[] }>('/api/v1/preorders', { q: term || undefined, status: open ? 'reserved,ordered,arrived,contacted' : undefined }),
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="h-11 min-w-0 flex-1 rounded-md border border-paper-500 bg-white px-3 text-sm focus:border-navy-700"
          placeholder="Tìm mã phiếu, tên hoặc SĐT khách, SKU…"
          aria-label="Tìm phiếu đặt trước"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-navy-700" checked={open} onChange={(e) => setOpen(e.target.checked)} />
          Chỉ phiếu đang mở
        </label>
      </div>
      {list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data ? (
        <Skeleton className="h-32" />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Không có phiếu đặt trước" />
      ) : (
        <ul className="max-h-[55dvh] divide-y divide-paper-300 overflow-y-auto rounded-lg border border-paper-300">
          {list.data.items.map((p) => {
            const ready = p.status === 'arrived' || p.status === 'contacted';
            const live = !['collected', 'cancelled'].includes(p.status);
            return (
              <li key={p.id} className="flex flex-col gap-2 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{p.title}</p>
                    <p className="text-ink-700">
                      {p.customerName}
                      {p.customerPhone && <span className="ml-2 text-ink-500 num">{formatPhone(p.customerPhone)}</span>}
                    </p>
                    <p className="text-[13px] text-ink-500 num">
                      <span className="code whitespace-nowrap">{p.docNo}</span> · {formatDate(p.createdAt)} · SL {formatNumber(p.qty)} · {formatVnd(p.unitPriceVnd * p.qty)} · Đã cọc {formatVnd(p.depositVnd)}
                    </p>
                  </div>
                  <PreorderChip p={p} />
                </div>
                {live && (
                  <div className="flex flex-wrap gap-2">
                    {ready && (
                      <Button size="sm" variant="primary" icon={PackageCheck} onClick={() => onCollect(p)}>
                        Nhận hàng
                      </Button>
                    )}
                    {p.status === 'reserved' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Truck}
                        onClick={async () => {
                          try {
                            await post(`/api/v1/preorders/${p.id}/ordered`);
                            toast.success('Đã ghi nhận đặt hàng nhà cung cấp.');
                            void qc.invalidateQueries({ queryKey: ['preorders'] });
                          } catch (e) {
                            toast.error((e as Error).message);
                          }
                        }}
                      >
                        Đã đặt NCC
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" icon={XCircle} onClick={() => onCancel(p)}>
                      Hủy phiếu
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface DepositState {
  method: 'cash' | 'transfer' | 'card';
  amountVnd: number | null;
  ref: string;
}

function NewPreorder({ shiftId, onDone }: { shiftId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [cust, setCust] = useState({ phone: '', name: '', source: 'other' });
  const [hit, setHit] = useState<ProductHit | null>(null);
  const [qty, setQty] = useState(1);
  const [dep, setDep] = useState<DepositState>({ method: 'cash', amountVnd: null, ref: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = (hit?.priceVnd ?? 0) * qty;
  const save = async () => {
    setError(null);
    if (!hit) return setError('Chọn sản phẩm khách đặt.');
    setBusy(true);
    try {
      const r = await post<{ docNo: string; status: string }>('/api/v1/preorders', {
        source: cust.source,
        customer: { name: cust.name.trim(), phone: cust.phone.trim() },
        variantId: hit.variantId,
        qty,
        deposit: { method: dep.method, amountVnd: dep.amountVnd ?? 0, ...(dep.method === 'cash' ? { shiftId } : { ref: dep.method === 'transfer' ? normalizePaymentRef(dep.ref) : dep.ref.trim() }) },
      });
      toast.success(r.status === 'arrived' ? `Đã lưu ${r.docNo}. Hàng đã có sẵn – có thể nhận hàng ngay.` : `Đã lưu ${r.docNo}.`);
      void qc.invalidateQueries({ queryKey: ['preorders'] });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Số điện thoại" required inputMode="tel" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} />
        <Field label="Tên khách" required value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} />
        <SelectField label="Kênh" value={cust.source} onChange={(e) => setCust({ ...cust, source: e.target.value })} className="sm:col-span-2">
          {ORDER_SOURCES.filter((s) => s !== 'website').map((s) => (
            <option key={s} value={s}>
              {s === 'other' ? 'Tại quầy / khác' : ORDER_SOURCE[s]}
            </option>
          ))}
        </SelectField>
      </div>
      {hit ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-paper-300 p-3 text-sm">
          <span className="min-w-0">
            <span className="block font-medium">{hitTitle(hit)}</span>
            <span className="text-ink-700 num">{formatVnd(hit.priceVnd)}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => setHit(null)}>
            Đổi
          </Button>
        </div>
      ) : (
        <ProductSearch onPick={setHit} placeholder="Nhập SKU / tên sản phẩm" scanIcon={false} />
      )}
      <Field label="Số lượng" inputMode="numeric" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))} />
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Hình thức nhận cọc">
        {(
          [
            ['cash', 'Tiền mặt'],
            ['transfer', 'Chuyển khoản'],
            ['card', 'Thẻ'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={dep.method === k}
            onClick={() => setDep({ ...dep, method: k, ref: k === 'transfer' ? paymentRefFromBytes(crypto.getRandomValues(new Uint8Array(8))) : '' })}
            className={clsx('h-11 rounded-xl border text-sm font-medium', dep.method === k ? 'border-2 border-navy-700 bg-navy-50 text-navy-700' : 'border-paper-500')}
          >
            {label}
          </button>
        ))}
      </div>
      <MoneyInput label="Tiền cọc" value={dep.amountVnd} onChange={(v) => setDep({ ...dep, amountVnd: v })} />
      {total > 0 && (
        <p className="-mt-2 text-[13px] text-ink-500 num">
          Tối thiểu {formatVnd(Math.round((total * 30) / 100))} (30%) · trả đủ {formatVnd(total)}
        </p>
      )}
      {dep.method === 'transfer' && <CopyCode label="Nội dung chuyển khoản" value={dep.ref} />}
      {dep.method === 'card' && <Field label="Mã chuẩn chi" required className="code" value={dep.ref} onChange={(e) => setDep({ ...dep, ref: e.target.value })} />}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <Button variant="primary" size="lg" full icon={Plus} loading={busy} onClick={save}>
        Lưu phiếu đặt trước
      </Button>
    </div>
  );
}

function CancelPreorder({ p, shiftId, onClose }: { p: PreorderRow; shiftId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [deposit, setDeposit] = useState<'refund' | 'forfeit'>('refund');
  const [ref, setRef] = useState('');
  return (
    <ConfirmDialog
      title={`Hủy ${p.docNo}?`}
      body="Hàng đang giữ sẽ trở lại kho. Không thể hoàn tác."
      confirm="Hủy phiếu"
      destructive
      onClose={onClose}
      onConfirm={async () => {
        await post(`/api/v1/preorders/${p.id}/cancel`, { reason: reason.trim(), deposit, shiftId, ...(ref.trim() && { refundRef: ref.trim() }) });
        toast.success(`Đã hủy ${p.docNo}.`);
        void qc.invalidateQueries({ queryKey: ['preorders'] });
      }}
    >
      <TextArea label="Lý do" required value={reason} onChange={(e) => setReason(e.target.value)} />
      {p.depositVnd > 0 && (
        <>
          <SelectField label={`Tiền cọc ${formatVnd(p.depositVnd)}`} value={deposit} onChange={(e) => setDeposit(e.target.value as 'refund' | 'forfeit')}>
            <option value="refund">Hoàn cọc cho khách</option>
            <option value="forfeit">Giữ cọc (khách mất cọc)</option>
          </SelectField>
          {deposit === 'refund' && p.depositMethod !== 'cash' && <Field label="Mã giao dịch hoàn tiền" required value={ref} onChange={(e) => setRef(e.target.value)} />}
          {deposit === 'refund' && p.depositMethod === 'cash' && <p className="text-[13px] text-ink-500">Tiền mặt được chi ra từ ca đang mở.</p>}
        </>
      )}
    </ConfirmDialog>
  );
}
