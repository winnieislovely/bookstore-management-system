import { normalizePaymentRef, paymentRefFromBytes } from '@bookstore/domain';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog, SelectField, TextArea, toast } from '../components/data';
import { CustomerPicker, type CustomerChoice } from '../components/customer-picker';
import { CopyCode } from '../components/order-ui';
import { ProductSearch, hitTitle, type ProductHit } from '../components/product-search';
import { Button, Field, InlineAlert, StatusChip, type Tone } from '../components/ui';
import { post } from '../lib/api';
import { formatVnd } from '../lib/format';
import type { CartCustomer, CartPreorder } from './cart';
import { Dialog, MoneyInput } from './widgets';

/**
 * Pre-orders (FR-POS-09, FR-ORD-14): the POS takes a pre-order with its deposit; the list is the
 * “Đơn đặt trước” tab of Đơn hàng, which opens a pre-order in the POS to collect it. Needs the server.
 */

export const PREORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
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
  lines: { variantId: string; sku: string; title: string; qty: number; unitPriceVnd: number; held: boolean }[];
  totalVnd: number;
  depositVnd: number;
  depositMethod: string | null;
  contactedAt: string | null;
  expiresAt: string | null;
  saleId: string | null;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  customerTierCode: string | null;
  customerPoints: number;
}

export function PreorderChip({ p }: { p: PreorderRow }) {
  // Holding-period countdown, turning to a warning in the last 2 days (Design §11.2).
  if (p.status === 'contacted' && p.expiresAt) {
    const left = Math.ceil((new Date(p.expiresAt).getTime() - Date.now()) / 86_400_000);
    return <StatusChip tone={left <= 2 ? 'warning' : 'info'}>{left > 0 ? `Đã liên hệ · còn ${left} ngày` : 'Quá hạn giữ hàng'}</StatusChip>;
  }
  const s = PREORDER_STATUS[p.status] ?? { label: p.status, tone: 'neutral' as Tone };
  return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
}

/** What the POS cart needs to collect a pre-order (FR-POS-09). */
export function toCart(p: PreorderRow): { preorder: CartPreorder; customer: CartCustomer } {
  return {
    preorder: { id: p.id, docNo: p.docNo, lines: p.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPriceVnd: l.unitPriceVnd })), depositVnd: p.depositVnd },
    customer: { id: p.customerId, name: p.customerName, phoneE164: p.customerPhone, tierCode: p.customerTierCode, pointsBalance: p.customerPoints },
  };
}

/** The POS “Đặt trước” button: a new pre-order with its deposit. */
export function PreorderDialog({ shiftId, online, customer, onClose }: { shiftId: string | null; online: boolean; customer: CartCustomer | null; onClose: () => void }) {
  if (!online || !shiftId) {
    return (
      <Dialog title="Đặt trước" size="sm" onClose={onClose}>
        <InlineAlert tone="warning">Cần kết nối mạng để tạo phiếu đặt trước.</InlineAlert>
      </Dialog>
    );
  }
  return (
    <Dialog title="Đặt trước" size="lg" onClose={onClose}>
      <NewPreorder shiftId={shiftId} initialCustomer={customer} onDone={onClose} />
    </Dialog>
  );
}

interface DepositState {
  method: 'cash' | 'transfer' | 'card';
  amountVnd: number | null;
  ref: string;
}

function NewPreorder({ shiftId, initialCustomer, onDone }: { shiftId: string; initialCustomer: CartCustomer | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [cust, setCust] = useState<CustomerChoice>(initialCustomer ? { kind: 'existing', customer: initialCustomer } : null);
  const [items, setItems] = useState<{ hit: ProductHit; qty: number }[]>([]);
  const [dep, setDep] = useState<DepositState>({ method: 'cash', amountVnd: null, ref: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = items.reduce((a, x) => a + x.hit.priceVnd * x.qty, 0);
  const add = (h: ProductHit) =>
    setItems((xs) => (xs.some((x) => x.hit.variantId === h.variantId) ? xs.map((x) => (x.hit.variantId === h.variantId ? { ...x, qty: x.qty + 1 } : x)) : [...xs, { hit: h, qty: 1 }]));
  const save = async () => {
    setError(null);
    if (!cust) return setError('Chọn khách hoặc nhập khách mới.');
    if (!items.length) return setError('Chọn sản phẩm khách đặt.');
    setBusy(true);
    try {
      const r = await post<{ docNo: string; status: string }>('/api/v1/preorders', {
        customer: cust.kind === 'existing' ? { customerId: cust.customer.id } : { name: cust.name.trim(), phone: cust.phone.trim() },
        lines: items.map((x) => ({ variantId: x.hit.variantId, qty: x.qty })),
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
      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-medium text-ink-700">Khách hàng</p>
        <CustomerPicker value={cust} onChange={setCust} />
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-ink-700">Sản phẩm</p>
        <ProductSearch onPick={add} placeholder="Nhập SKU / tên sản phẩm" scanIcon={false} />
        {items.length > 0 && (
          <ul className="divide-y divide-paper-300 rounded-md border border-paper-300">
            {items.map((x, i) => (
              <li key={x.hit.variantId} className="flex items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{hitTitle(x.hit)}</p>
                  <p className="text-ink-700 num">{formatVnd(x.hit.priceVnd)}</p>
                </div>
                <input
                  aria-label={`Số lượng ${hitTitle(x.hit)}`}
                  inputMode="numeric"
                  className="h-10 w-16 rounded-md border border-paper-500 text-center num"
                  value={x.qty}
                  onChange={(e) => setItems(items.map((y, j) => (j === i ? { ...y, qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) } : y)))}
                />
                <Button variant="ghost" icon={Trash2} aria-label={`Xóa ${hitTitle(x.hit)}`} onClick={() => setItems(items.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
        )}
      </div>
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

/** Cancel with the deposit refunded (cash out of the open shift) or kept (FR-ORD-16). */
export function CancelPreorder({ p, shiftId, onClose }: { p: PreorderRow; shiftId: string | null; onClose: () => void }) {
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
        await post(`/api/v1/preorders/${p.id}/cancel`, { reason: reason.trim(), deposit, ...(shiftId && { shiftId }), ...(ref.trim() && { refundRef: ref.trim() }) });
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
          {deposit === 'refund' && p.depositMethod === 'cash' && (shiftId ? <p className="text-[13px] text-ink-500">Tiền mặt được chi ra từ ca đang mở.</p> : <InlineAlert tone="warning">Cần một ca đang mở để hoàn cọc tiền mặt. Hãy mở ca ở màn hình Bán hàng.</InlineAlert>)}
        </>
      )}
    </ConfirmDialog>
  );
}
