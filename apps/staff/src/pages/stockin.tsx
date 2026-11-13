import { useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { SelectField, TextArea, toast } from '../components/data';
import { hitTitle, ProductSearch } from '../components/product-search';
import { Button, Field, InlineAlert } from '../components/ui';
import { get, post } from '../lib/api';
import { formatNumber, formatVnd } from '../lib/format';
import { Dialog } from '../pos/widgets';

/**
 * Stock-in (FR-PUR-01..06, FR-PUR-09, Design §12.4 “Quick stock-in”): existing products only, each
 * needing cost, selling price and quantity; new products are created on “Thêm sản phẩm mới”.
 * Several lines post as one entry.
 */

interface Supplier {
  id: string;
  name: string;
  isConsignor: boolean;
}
export const useSuppliers = () => useQuery({ queryKey: ['suppliers'], queryFn: () => get<{ items: (Supplier & { phone: string | null; email: string | null; taxCode: string | null; note: string | null; status: string; version: number })[] }>('/api/v1/purchasing/suppliers') });

interface Line {
  key: string;
  variantId: string;
  title: string;
  sku: string;
  costVnd: string;
  sellingPriceVnd: string;
  qty: string;
}

const digits = (s: string) => Number(s.replace(/\D/g, '') || 0);
const money = (s: string) => (s ? formatNumber(digits(s)) : '');

/** Products ticked on the Stock page, prefilled as lines. */
export interface StockInPick {
  variantId: string;
  title: string;
  sku: string;
  priceVnd: number;
}

/**
 * Stock-in form, opened from the Stock page (“Nhập thêm hàng”, FR-PUR-01..06, Design §12.1, §12.4).
 * With ticked products the lines are fixed; opened from the page header it starts empty and products
 * are added one at a time from the search field. Posts one stock-in entry.
 */
export function StockInForm({ initial = [], onClose, onPosted }: { initial?: StockInPick[]; onClose: () => void; onPosted: () => void }) {
  const suppliers = useSuppliers();
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [note, setNote] = useState('');
  const [consignment, setConsignment] = useState(false);
  const [discount, setDiscount] = useState('');
  const [deadline, setDeadline] = useState('');
  const [lines, setLines] = useState<Line[]>(() => initial.map((p) => ({ key: p.variantId, variantId: p.variantId, title: p.title, sku: p.sku, costVnd: '', sellingPriceVnd: String(p.priceVnd), qty: '1' })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ entryNo: string; totalCostVnd: number; lines: { marginFlag: boolean; priceChanged: boolean }[] } | null>(null);
  const supplier = suppliers.data?.items.find((s) => s.id === supplierId);
  // Only a consignor's goods can be consignment: switching to another supplier drops the tick, which is hidden then.
  const isConsignment = consignment && !!supplier?.isConsignor;
  const locked = initial.length > 0;

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + digits(l.costVnd) * digits(l.qty), 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...(supplierId && { supplierId }),
        ...(invoiceNo.trim() && { supplierInvoiceNo: invoiceNo.trim() }),
        ...(note.trim() && { note: note.trim() }),
        consignment: isConsignment,
        ...(isConsignment && discount && { consignmentDiscountBp: Math.round(Number(discount.replace(',', '.')) * 100) }),
        ...(isConsignment && deadline && { consignmentDeadline: new Date(deadline).toISOString() }),
        lines: lines.map((l) => ({ kind: 'existing', variantId: l.variantId, costVnd: digits(l.costVnd), sellingPriceVnd: digits(l.sellingPriceVnd), qty: digits(l.qty) })),
      };
      const r = await post<{ entryNo: string; totalCostVnd: number; lines: { marginFlag: boolean; priceChanged: boolean }[] }>('/api/v1/purchasing/stock-in', body);
      setResult(r);
      onPosted();
      toast.success(`Đã nhập kho phiếu ${r.entryNo}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result)
    return (
      <Dialog title={`Đã nhập ${result.entryNo}`} size="sm" onClose={onClose}>
        <div className="flex flex-col gap-3">
          <p className="text-ink-700 num">
            {result.lines.length} dòng · tổng giá nhập {formatVnd(result.totalCostVnd)}
          </p>
          {result.lines.some((l) => l.marginFlag) && <InlineAlert tone="warning">{result.lines.filter((l) => l.marginFlag).length} dòng có lãi dưới mức tối thiểu. Kiểm tra giá bán.</InlineAlert>}
          {result.lines.some((l) => l.priceChanged) && <InlineAlert tone="info">Giá bán đã được cập nhật cho {result.lines.filter((l) => l.priceChanged).length} sản phẩm.</InlineAlert>}
          <Button variant="primary" full onClick={onClose}>
            Xong
          </Button>
        </div>
      </Dialog>
    );

  return (
    <Dialog
      title="Nhập thêm hàng"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm num">
            {lines.length} dòng · {formatVnd(total)}
          </span>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="primary" loading={busy} disabled={!lines.length} onClick={submit}>
            Xác nhận nhập hàng
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Nhà cung cấp" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— Chọn —</option>
            {suppliers.data?.items.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <Field label="Số hóa đơn NCC" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
          {supplier?.isConsignor && (
            <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="size-5" checked={consignment} onChange={(e) => setConsignment(e.target.checked)} />
              Hàng ký gửi
            </label>
          )}
          {isConsignment && (
            <>
              <Field label="Chiết khấu thỏa thuận" suffix="%" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              <Field label="Hạn đối soát / trả hàng" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </>
          )}
        </div>

        {/* With ticked products the lines are fixed. From the page header, products are added one at a
            time; only existing products – new ones are created on “Thêm sản phẩm mới” (Design §12.4). */}
        {!locked && (
          <ProductSearch
            autoFocus
            placeholder="Tìm SKU, tên sản phẩm"
            onPick={(h) =>
              setLines((ls) => {
                const same = ls.find((l) => l.variantId === h.variantId);
                if (same) return ls.map((l) => (l === same ? { ...l, qty: String(digits(l.qty) + 1) } : l));
                return [...ls, { key: crypto.randomUUID(), variantId: h.variantId, title: hitTitle(h), sku: h.sku, costVnd: '', sellingPriceVnd: String(h.priceVnd), qty: '1' }];
              })
            }
          />
        )}

        {!locked && !lines.length && <p className="text-sm text-ink-500">Chưa có sản phẩm. Tìm và chọn sản phẩm để thêm vào phiếu nhập.</p>}
        <ul className="flex flex-col gap-3">
          {lines.map((l) => (
            <li key={l.key} className="rounded-lg border border-paper-300 p-4">
              <div className="mb-3 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{l.title}</p>
                  <p className="code text-[13px] text-ink-500">{l.sku}</p>
                </div>
                <button type="button" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-danger-50" aria-label="Bỏ dòng" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 size={18} aria-hidden />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Giá nhập" required suffix="₫" inputMode="numeric" value={money(l.costVnd)} onChange={(e) => update(l.key, { costVnd: e.target.value })} />
                <Field label="Giá bán" required suffix="₫" inputMode="numeric" value={money(l.sellingPriceVnd)} onChange={(e) => update(l.key, { sellingPriceVnd: e.target.value })} />
                <Field label="Số lượng" required inputMode="numeric" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value.replace(/\D/g, '') })} />
              </div>
              {digits(l.sellingPriceVnd) > 0 && digits(l.costVnd) >= digits(l.sellingPriceVnd) && (
                <div className="mt-3">
                  <InlineAlert tone="warning">Giá nhập không thấp hơn giá bán.</InlineAlert>
                </div>
              )}
            </li>
          ))}
        </ul>
        <TextArea label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}
