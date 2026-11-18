import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, BookOpen, ChevronDown, Minus, Package, Plus, ScanBarcode } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ConfirmDialog, toast } from '../components/data';
import { hitTitle, ProductSearch, type ProductHit } from '../components/product-search';
import { ScanSession, type ScanOutcome } from '../components/scanSession';
import { Button, ErrorState, Field, InlineAlert, Skeleton } from '../components/ui';
import { ApiError, get, post } from '../lib/api';
import { formatNumber } from '../lib/format';
import { can, useMe } from '../lib/session';

/**
 * Stock-in (FR-PUR-01..06, FR-PUR-09, Design §12.4 “Quick stock-in”): existing products only; each
 * line has its quantity, and its cost and selling price can be opened and changed (prefilled with the
 * current values). New products are created on “Thêm sản phẩm mới”, and a scanned code that matches
 * no product is refused (FR-PUR-03). Several lines post as one entry.
 */

interface Supplier {
  id: string;
  name: string;
  isConsignor: boolean;
}
export const useSuppliers = () => useQuery({ queryKey: ['suppliers'], queryFn: () => get<{ items: (Supplier & { phone: string | null; email: string | null; taxCode: string | null; note: string | null; status: string; version: number })[] }>('/api/v1/purchasing/suppliers') });

/**
 * One product on the entry (FR-PUR-03, Design §12.4): the quantity, and the cost and selling price
 * prefilled with the current values – only values staff change are sent.
 */
interface Line {
  key: string;
  variantId: string;
  title: string;
  sku: string;
  kind: string;
  imageFileId: string | null;
  qty: string;
  /** Current average cost, or null when not known or not visible to this user. */
  costNow: number | null;
  priceNow: number;
  cost: string;
  price: string;
}

const digits = (s: string) => Number(s.replace(/\D/g, '') || 0);
const money = (s: string) => (s ? formatNumber(digits(s)) : '');

/** A product as a new line, from a search hit or the product's stock page. */
interface LineSource {
  variantId: string;
  title: string;
  sku: string;
  kind: string;
  imageFileId: string | null;
  priceVnd: number;
  avgCostVnd?: number | null;
}

const lineOf = (p: LineSource, key: string): Line => ({
  key,
  variantId: p.variantId,
  title: p.title,
  sku: p.sku,
  kind: p.kind,
  imageFileId: p.imageFileId,
  qty: '1',
  costNow: p.avgCostVnd ?? null,
  priceNow: p.priceVnd,
  cost: p.avgCostVnd != null ? String(p.avgCostVnd) : '',
  price: String(p.priceVnd),
});

interface ItemForPick {
  kind: string;
  i18n: { vi?: { title?: string }; en: { title: string } };
  images: { fileId: string }[];
  variants: { id: string; sku: string; priceVnd: number; avgCostVnd?: number }[];
}

/**
 * “Nhập thêm hàng” page, `/stock/in` (FR-PUR-01..06, Design §12.1, §12.4). From the Tồn kho header it
 * starts empty; from a product's stock page (`?item=&v=`) it starts with that product. Either way
 * products are scanned (camera or handheld scanner) or searched one at a time. Posts one stock-in entry.
 */
export function StockInPage() {
  const [params] = useSearchParams();
  const itemId = params.get('item');
  const variantId = params.get('v');
  const item = useQuery({ queryKey: ['item', itemId], enabled: !!itemId, queryFn: () => get<ItemForPick>(`/api/v1/catalog/items/${itemId}`) });
  if (itemId && item.isError) return <ErrorState error={item.error} onRetry={() => void item.refetch()} />;
  if (itemId && !item.data) return <Skeleton className="h-64" />;
  const v = item.data?.variants.find((x) => x.id === variantId) ?? item.data?.variants[0];
  const title = item.data ? item.data.i18n.vi?.title || item.data.i18n.en.title : null;
  const initial: LineSource[] =
    item.data && v ? [{ variantId: v.id, title: title!, sku: v.sku, kind: item.data.kind, imageFileId: item.data.images[0]?.fileId ?? null, priceVnd: v.priceVnd, avgCostVnd: v.avgCostVnd ?? null }] : [];
  // Back to where the page was opened from.
  const back = itemId ? { to: `/stock/${itemId}${v ? `?v=${v.id}` : ''}`, label: title! } : { to: '/stock', label: 'Tồn kho' };
  return <StockInForm key={`${itemId ?? ''}:${v?.id ?? ''}`} initial={initial} back={back} />;
}

function StockInForm({ initial, back }: { initial: LineSource[]; back: { to: string; label: string } }) {
  const suppliers = useSuppliers();
  const { data: me } = useMe();
  // The cost shows only to users who may see costs (TDD §10.3).
  const showCost = can(me, 'catalog.view_cost');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [consignment, setConsignment] = useState(false);
  const [discount, setDiscount] = useState('');
  const [deadline, setDeadline] = useState('');
  const [lines, setLines] = useState<Line[]>(() => initial.map((p) => lineOf(p, p.variantId)));
  const [open, setOpen] = useState<Set<string>>(new Set());
  // A row whose quantity was stepped below 1: asked before it is removed.
  const [removing, setRemoving] = useState<Line | null>(null);
  // The last scanned code that matches no product: a new product, refused (FR-PUR-03).
  const [unknown, setUnknown] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ entryNo: string; lines: { marginFlag: boolean; priceChanged: boolean }[] } | null>(null);
  // The latest lines, for scans handled while the camera is open.
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const supplier = suppliers.data?.items.find((s) => s.id === supplierId);
  // Only a consignor's goods can be consignment: switching to another supplier drops the tick, which is hidden then.
  const isConsignment = consignment && !!supplier?.isConsignor;

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const toggle = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** A product picked or scanned: a new line, or 1 more of a line already there. Returns the quantity now on the entry. */
  const addHit = (h: ProductHit) => {
    setUnknown(null);
    const same = linesRef.current.find((l) => l.variantId === h.variantId);
    const qty = same ? digits(same.qty) + 1 : 1;
    // The search answers with the average cost when this user may see costs.
    const avg = (h as ProductHit & { avgCostVnd?: number | null }).avgCostVnd;
    const next = same
      ? linesRef.current.map((l) => (l === same ? { ...l, qty: String(qty) } : l))
      : [...linesRef.current, lineOf({ variantId: h.variantId, title: hitTitle(h), sku: h.sku, kind: h.kind, imageFileId: h.imageFileId, priceVnd: h.priceVnd, avgCostVnd: avg ?? null }, crypto.randomUUID())];
    linesRef.current = next;
    setLines(next);
    return qty;
  };

  /** One camera read (Design §13.8): the product's line, or a refused new product. */
  const onScan = async (raw: string): Promise<ScanOutcome> => {
    const code = raw.trim();
    try {
      const { variantId } = await get<{ variantId: string }>('/api/v1/catalog/lookup', { code });
      const r = await get<{ items: ProductHit[] }>('/api/v1/catalog/items', { q: code, limit: 20 });
      const hit = r.items.find((x) => x.variantId === variantId);
      if (hit) {
        const qty = addHit(hit);
        return { tone: 'success', title: 'Đã thêm', lines: [hitTitle(hit), `SL ${formatNumber(qty)}`] };
      }
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'code_not_found')) return { tone: 'danger', title: 'Không đọc được mã', lines: [(e as Error).message] };
    }
    setUnknown(code);
    return { tone: 'warning', title: 'Sản phẩm mới – không nhập được', lines: [code, 'Tạo sản phẩm ở trang Thêm sản phẩm mới.'] };
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...(supplierId && { supplierId }),
        consignment: isConsignment,
        ...(isConsignment && discount && { consignmentDiscountBp: Math.round(Number(discount.replace(',', '.')) * 100) }),
        ...(isConsignment && deadline && { consignmentDeadline: new Date(deadline).toISOString() }),
        // Only values staff changed are sent: otherwise the stock enters at the current average cost and the price stays (FR-PUR-03).
        lines: lines.map((l) => {
          const costChanged = showCost && l.cost.trim() !== '' && digits(l.cost) !== l.costNow;
          const priceChanged = l.price.trim() !== '' && digits(l.price) !== l.priceNow;
          return { kind: 'existing', variantId: l.variantId, qty: Math.max(1, digits(l.qty)), ...(costChanged && { costVnd: digits(l.cost) }), ...(priceChanged && { sellingPriceVnd: digits(l.price) }) };
        }),
      };
      const r = await post<{ entryNo: string; lines: { marginFlag: boolean; priceChanged: boolean }[] }>('/api/v1/purchasing/stock-in', body);
      setResult(r);
      // The Stock list, a product's stock page and the stock value read these.
      for (const key of ['stock-list', 'item', 'movements', 'valuation']) void qc.invalidateQueries({ queryKey: [key] });
      toast.success(`Đã nhập kho phiếu ${r.entryNo}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** “Nhập tiếp”: an empty form for the next entry. */
  const restart = () => {
    setResult(null);
    setLines([]);
    linesRef.current = [];
    setOpen(new Set());
    setUnknown(null);
    setError(null);
    if (window.location.search) navigate('/stock/in', { replace: true });
  };

  // One-row header (Design §12.4): a back arrow in the title colour and a heading-size title, centred on
  // each other; the arrow's left edge is level with the content below.
  const header = (
    // The 40 px arrow target sits 8 px (6 px from sm) below the title line, so the title is 16 px above the supplier.
    <div className="mb-2 flex items-center gap-1 sm:mb-2.5">
      <Link
        to={back.to}
        aria-label="Quay lại"
        title={`Quay lại ${back.label}`}
        className="-ml-2.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-navy-700 hover:bg-navy-50"
      >
        <ArrowLeft size={20} aria-hidden />
      </Link>
      <h1 className="min-w-0 text-base leading-6 font-semibold text-navy-700 sm:text-xl sm:leading-7">Nhập thêm hàng</h1>
    </div>
  );

  if (result)
    return (
      <div className="max-w-[720px]">
        {header}
        <section className="flex flex-col gap-3" aria-labelledby="stockin-done">
          <h2 id="stockin-done" className="text-base font-semibold text-ink-900">
            Đã nhập {result.entryNo}
          </h2>
          <p className="text-ink-700 num">Đã nhập {formatNumber(result.lines.length)} sản phẩm.</p>
          {result.lines.some((l) => l.marginFlag) && <InlineAlert tone="warning">{result.lines.filter((l) => l.marginFlag).length} dòng có lãi dưới mức tối thiểu. Kiểm tra giá bán.</InlineAlert>}
          {result.lines.some((l) => l.priceChanged) && <InlineAlert tone="info">Giá bán đã được cập nhật cho {result.lines.filter((l) => l.priceChanged).length} sản phẩm.</InlineAlert>}
          <div className="mt-2 flex gap-2 max-sm:[&>*]:flex-1">
            <Button variant="secondary" className="sm:w-48" onClick={restart}>
              Nhập tiếp
            </Button>
            <Button variant="primary" className="sm:w-48" onClick={() => navigate(back.to)}>
              Xong
            </Button>
          </div>
        </section>
      </div>
    );

  return (
    <div className="max-w-[720px] pb-20">
      {header}
      {/* Lean layout (Design §12.4): 16 px under the title, 12 px between the supplier, the search and the rows. */}
      <div className="flex flex-col gap-3">
        {/* No label above: the select reads “Nhà cung cấp” until one is chosen; the name stays for screen readers. */}
        <select
          aria-label="Nhà cung cấp"
          className={clsx('h-12 w-full rounded-md border border-paper-500 bg-white px-3 text-base focus:border-navy-700', supplierId ? 'text-ink-900' : 'text-ink-500')}
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
        >
          <option value="">Nhà cung cấp</option>
          {suppliers.data?.items.map((s) => (
            <option key={s.id} value={s.id} className="text-ink-900">
              {s.name}
            </option>
          ))}
        </select>
        {supplier?.isConsignor && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="size-5" checked={consignment} onChange={(e) => setConsignment(e.target.checked)} />
              Hàng ký gửi
            </label>
            {isConsignment && (
              <>
                <Field label="Chiết khấu thỏa thuận" suffix="%" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                <Field label="Hạn đối soát / trả hàng" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </>
            )}
          </div>
        )}

        {/* Products are scanned or searched one at a time; only existing products – new ones are created
            on “Thêm sản phẩm mới” (Design §12.4). */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ProductSearch autoFocus placeholder="Nhập SKU/tên sản phẩm" onPick={(h) => void addHit(h)} onUnknownCode={setUnknown} />
          </div>
          <button
            type="button"
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-md text-navy-700 hover:bg-navy-50"
            aria-label="Quét mã"
            title="Quét mã"
            onClick={() => setScanning(true)}
          >
            <ScanBarcode size={24} aria-hidden />
          </button>
        </div>
        {unknown && <InlineAlert tone="warning">Mã {unknown} chưa có trong danh mục. Đây là sản phẩm mới – hãy để riêng và tạo ở trang Thêm sản phẩm mới.</InlineAlert>}

        {!lines.length && <p className="text-sm text-ink-500">Chưa có sản phẩm. Quét mã hoặc tìm sản phẩm để thêm vào phiếu nhập.</p>}
        {lines.length > 0 && (
          // Rows follow the POS cart line, nothing cut off; tapping a row opens its prices (Design §12.4).
          <ul className="flex flex-col gap-2" aria-label="Sản phẩm">
            {lines.map((l) => (
              <StockInRow
                key={l.key}
                line={l}
                open={open.has(l.key)}
                showCost={showCost}
                onToggle={() => toggle(l.key)}
                onChange={(patch) => update(l.key, patch)}
                onRemoveAsk={() => setRemoving(l)}
              />
            ))}
          </ul>
        )}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
      {scanning && <ScanSession label="Quét mã nhập hàng" prompt="Đưa mã vạch hoặc ISBN vào khung" progress={`${lines.length} dòng`} onScan={onScan} onClose={() => setScanning(false)} />}
      {removing && (
        <ConfirmDialog
          title={`Bỏ ${removing.title} khỏi phiếu?`}
          confirm="Bỏ"
          cancel="Không"
          destructive
          onConfirm={async () => setLines((ls) => ls.filter((x) => x.key !== removing.key))}
          onClose={() => setRemoving(null)}
        />
      )}

      {/* Sticky action bar (Design §12.4): Hủy and Xác nhận the same size – half each on phones, 192 px from sm. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-center justify-end gap-2 border-t border-paper-300 bg-white px-4 shadow-sm max-sm:[&>*]:flex-1 sm:px-6 md:left-[72px] lg:left-[264px]">
        <Button variant="secondary" className="sm:w-48" onClick={() => navigate(back.to)}>
          Hủy
        </Button>
        <Button variant="primary" className="sm:w-48" loading={busy} disabled={!lines.length} onClick={submit}>
          Xác nhận nhập hàng
        </Button>
      </div>
    </div>
  );
}

/**
 * One product row (Design §12.4), like the POS cart line: cover at the left; the name in full; the SKU
 * and the quantity stepper on the row under it. Tapping the row (not the stepper) opens Giá nhập and
 * Giá bán; Minus at 1 asks to remove the row.
 */
function StockInRow({
  line: l,
  open,
  showCost,
  onToggle,
  onChange,
  onRemoveAsk,
}: {
  line: Line;
  open: boolean;
  showCost: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Line>) => void;
  onRemoveAsk: () => void;
}) {
  const qty = digits(l.qty);
  const pricesId = `prices-${l.key}`;
  const lowMargin = showCost && digits(l.price) > 0 && l.cost.trim() !== '' && digits(l.cost) >= digits(l.price);
  return (
    <li className="rounded-md border border-paper-300 p-3">
      <div className="flex items-start gap-3">
        <button type="button" className="shrink-0" onClick={onToggle} aria-expanded={open} aria-controls={pricesId} aria-label={`Giá của ${l.title}`}>
          <LineThumb line={l} />
        </button>
        <div className="min-w-0 flex-1">
          <button type="button" className="flex w-full items-start gap-2 text-left" onClick={onToggle} aria-expanded={open} aria-controls={pricesId}>
            <span className="min-w-0 flex-1 font-semibold break-words text-ink-900">{l.title}</span>
            <ChevronDown size={18} className={clsx('mt-0.5 shrink-0 text-ink-500 transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
          <div className="mt-1 flex items-center justify-between gap-3">
            <button type="button" className="code min-w-0 text-left text-[13px] break-all text-ink-500" onClick={onToggle} tabIndex={-1}>
              {l.sku}
            </button>
            {/* The POS cart stepper: bare icons around the quantity field (Design §13.2). */}
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-full text-ink-700 hover:bg-paper-200"
                aria-label={qty <= 1 ? `Bỏ ${l.title}` : `Bớt 1 ${l.title}`}
                onClick={() => (qty <= 1 ? onRemoveAsk() : onChange({ qty: String(qty - 1) }))}
              >
                <Minus size={16} aria-hidden />
              </button>
              <input
                className="h-8 w-10 rounded-md border border-paper-500 text-center text-sm num focus:border-navy-700"
                inputMode="numeric"
                aria-label={`Số lượng ${l.title}`}
                value={l.qty}
                onChange={(e) => onChange({ qty: e.target.value.replace(/\D/g, '') })}
                onBlur={() => qty < 1 && onChange({ qty: '1' })}
              />
              <button
                type="button"
                className="inline-flex size-8 items-center justify-center rounded-full text-ink-700 hover:bg-paper-200"
                aria-label={`Thêm 1 ${l.title}`}
                onClick={() => onChange({ qty: String(qty + 1) })}
              >
                <Plus size={16} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </div>
      {open && (
        <div id={pricesId} className="mt-3 flex flex-col gap-3">
          <div className={clsx('grid gap-3', showCost ? 'grid-cols-2' : 'grid-cols-1')}>
            {showCost && <Field label="Giá nhập" suffix="₫" inputMode="numeric" value={money(l.cost)} onChange={(e) => onChange({ cost: e.target.value })} />}
            <Field label="Giá bán" suffix="₫" inputMode="numeric" value={money(l.price)} onChange={(e) => onChange({ price: e.target.value })} />
          </div>
          {lowMargin && <InlineAlert tone="warning">Giá nhập không thấp hơn giá bán.</InlineAlert>}
        </div>
      )}
    </li>
  );
}

/** The row's photo: a 32 × 48 cover for a book, 32 px square otherwise, a grey placeholder when none (Design §12.4). */
function LineThumb({ line }: { line: Pick<Line, 'kind' | 'imageFileId'> }) {
  const book = line.kind === 'book';
  const box = book ? 'h-12 w-8' : 'size-8';
  if (!line.imageFileId) {
    const Icon = book ? BookOpen : Package;
    return (
      <div className={clsx(box, 'flex items-center justify-center rounded-sm bg-paper-200')}>
        <Icon size={16} className="text-ink-300" aria-hidden />
      </div>
    );
  }
  return <img src={`/api/v1/files/${line.imageFileId}`} alt="" loading="lazy" className={clsx(box, 'block rounded-sm bg-white', book ? 'object-cover' : 'object-contain')} />;
}
