import { VAT_RATES_BP } from '@bookstore/domain';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertTriangle, Download, ImagePlus, PackagePlus, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { DataTable, Pager, SelectField, TextArea, toast, useParam, type Column } from '../components/data';
import { hitTitle, ProductSearch } from '../components/product-search';
import { Button, Field, InlineAlert, PageHeader, StatusChip } from '../components/ui';
import { get, post, upload } from '../lib/api';
import { formatDateTime, formatNumber, formatVnd } from '../lib/format';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';

/**
 * Stock-in (FR-PUR-01..06, FR-PUR-09, Design §12.4 “Quick stock-in”): one form with the scan field
 * on top; an existing product needs only cost, selling price and quantity; a new one expands to the
 * required catalogue fields. Several lines post as one entry.
 */

interface Supplier {
  id: string;
  name: string;
  isConsignor: boolean;
  tracksPayables: boolean;
}
export const useSuppliers = () => useQuery({ queryKey: ['suppliers'], queryFn: () => get<{ items: (Supplier & { taxCode: string | null; kind: string; termsDays: number | null; contacts: { name: string; phone?: string; email?: string }[]; note: string | null; status: string; hasBank: boolean; version: number })[] }>('/api/v1/purchasing/suppliers') });

interface Named {
  id: string;
  i18n: { vi?: { name?: string }; en?: { name?: string } };
  parentId?: string | null;
}
const nameOf = (n: Named) => n.i18n.vi?.name || n.i18n.en?.name || '';

interface ExistingLine {
  kind: 'existing';
  key: string;
  variantId: string;
  title: string;
  sku: string;
  costVnd: string;
  sellingPriceVnd: string;
  qty: string;
  orderLineId?: string;
}
interface NewLine {
  kind: 'new';
  key: string;
  itemKind: 'book' | 'stationery' | 'other';
  title: string;
  titleVi: string;
  description: string;
  authors: string;
  publisherId: string;
  categoryId: string;
  sku: string;
  isbn: string;
  barcode: string;
  weightG: string;
  vatBp: number;
  minStock: string;
  imageFileId: string | null;
  imageName: string;
  costVnd: string;
  sellingPriceVnd: string;
  qty: string;
}
type Line = ExistingLine | NewLine;

const digits = (s: string) => Number(s.replace(/\D/g, '') || 0);
const money = (s: string) => (s ? formatNumber(digits(s)) : '');

interface EntryRow {
  id: string;
  entryNo: string;
  supplierName: string | null;
  supplierInvoiceNo: string | null;
  consignment: boolean;
  totalCostVnd: number;
  source: string;
  createdAt: string;
  lines: number;
  marginFlags: number;
}

export function StockInPage() {
  const { data: me } = useMe();
  const [params] = useSearchParams();
  const [page, setPage] = useParam('page', '1');
  const [form, setForm] = useState(!!params.get('order'));
  const list = useQuery({ queryKey: ['stock-in', page], queryFn: () => get<{ items: EntryRow[] }>('/api/v1/purchasing/stock-in', { page: Number(page), limit: 40 }) });
  const columns: Column<EntryRow>[] = [
    { header: 'Số phiếu', cell: (r) => <span className="code">{r.entryNo}</span> },
    { header: 'Ngày', className: 'whitespace-nowrap', cell: (r) => formatDateTime(r.createdAt) },
    { header: 'Nhà cung cấp', cell: (r) => r.supplierName ?? '—' },
    { header: 'Số HĐ NCC', cell: (r) => r.supplierInvoiceNo ?? '—' },
    { header: 'Dòng', align: 'right', cell: (r) => formatNumber(r.lines) },
    { header: 'Tổng giá nhập', align: 'right', cell: (r) => formatVnd(r.totalCostVnd) },
    {
      header: 'Ghi chú',
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.consignment && <StatusChip tone="accent">Ký gửi</StatusChip>}
          {r.source === 'import' && <StatusChip tone="neutral">Từ Excel</StatusChip>}
          {r.marginFlags > 0 && <StatusChip tone="warning" icon={AlertTriangle}>{r.marginFlags} dòng lãi thấp</StatusChip>}
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Nhập hàng"
        actions={
          <>
            {can(me, 'catalog.import') && (
              <>
                <a className="inline-flex h-10 items-center gap-2 rounded-full px-[18px] text-sm font-medium text-navy-700 hover:bg-navy-50" href="/api/v1/admin/import/stock_in/template">
                  <Download size={20} aria-hidden /> Tải file mẫu
                </a>
                <a className="inline-flex h-10 items-center gap-2 rounded-full border border-paper-500 px-[18px] text-sm font-medium hover:bg-navy-50" href="/import?kind=stock_in">
                  <Upload size={20} aria-hidden /> Nhập từ Excel
                </a>
              </>
            )}
            <Button variant="primary" icon={Plus} onClick={() => setForm(true)}>
              Tạo phiếu nhập
            </Button>
          </>
        }
      />
      <DataTable
        columns={columns}
        rows={list.data?.items}
        rowKey={(r) => r.id}
        error={list.error}
        onRetry={() => list.refetch()}
        empty={{ icon: PackagePlus, title: 'Chưa có phiếu nhập', help: 'Quét mã sản phẩm để nhập thêm hàng, hoặc tạo sản phẩm mới ngay khi nhập.' }}
      />
      <Pager page={Number(page)} hasMore={(list.data?.items.length ?? 0) === 40} onPage={(p) => setPage(String(p))} />
      {form && <StockInForm orderId={params.get('order')} onClose={() => setForm(false)} onPosted={() => list.refetch()} />}
    </>
  );
}

function newLine(code = ''): NewLine {
  const isbnLike = /^97[89]\d{10}$/.test(code);
  return {
    kind: 'new',
    key: crypto.randomUUID(),
    itemKind: isbnLike ? 'book' : 'stationery',
    title: '',
    titleVi: '',
    description: '',
    authors: '',
    publisherId: '',
    categoryId: '',
    sku: isbnLike ? '' : code,
    isbn: isbnLike ? code : '',
    barcode: !isbnLike && code ? code : '',
    weightG: '',
    vatBp: isbnLike ? 0 : 1000,
    minStock: '',
    imageFileId: null,
    imageName: '',
    costVnd: '',
    sellingPriceVnd: '',
    qty: '1',
  };
}

function StockInForm({ orderId, onClose, onPosted }: { orderId: string | null; onClose: () => void; onPosted: () => void }) {
  const navigate = useNavigate();
  const suppliers = useSuppliers();
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => get<{ items: Named[] }>('/api/v1/catalog/categories') });
  const publishers = useQuery({ queryKey: ['publishers'], queryFn: () => get<{ items: Named[] }>('/api/v1/catalog/publishers') });
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [note, setNote] = useState('');
  const [consignment, setConsignment] = useState(false);
  const [discount, setDiscount] = useState('');
  const [deadline, setDeadline] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ entryNo: string; totalCostVnd: number; lines: { marginFlag: boolean; createdProduct: boolean; priceChanged: boolean }[] } | null>(null);
  const supplier = suppliers.data?.items.find((s) => s.id === supplierId);

  // Receiving a supplier order: prefill outstanding lines (FR-PUR-07).
  useEffect(() => {
    if (!orderId) return;
    void get<{ supplierId: string; docNo: string; lines: { id: string; variantId: string; sku: string; title: string; qty: number; receivedQty: number; unitCostVnd: number | null }[] }>(`/api/v1/purchasing/orders/${orderId}`).then(async (o) => {
      setSupplierId(o.supplierId);
      setNote(`Nhận hàng đơn ${o.docNo}`);
      const open = o.lines.filter((l) => l.qty > l.receivedQty);
      // Current selling price per line, so receiving keeps it unless staff change it.
      const prices = (await Promise.all(open.map((l) => get<{ items: { variantId: string; priceVnd: number }[] }>('/api/v1/catalog/items', { q: l.sku, limit: 5 }).then((r) => r.items).catch(() => [])))).flat();
      setLines(
        open.map((l) => ({
          kind: 'existing',
          key: l.id,
          variantId: l.variantId,
          title: l.title,
          sku: l.sku,
          costVnd: l.unitCostVnd ? String(l.unitCostVnd) : '',
          sellingPriceVnd: String(prices.find((p) => p.variantId === l.variantId)?.priceVnd ?? ''),
          qty: String(l.qty - l.receivedQty),
          orderLineId: l.id,
        })),
      );
    });
  }, [orderId]);

  const update = (key: string, patch: Partial<ExistingLine> | Partial<NewLine>) => setLines((ls) => ls.map((l) => (l.key === key ? ({ ...l, ...patch } as Line) : l)));
  const total = lines.reduce((a, l) => a + digits(l.costVnd) * digits(l.qty), 0);
  const hasNew = lines.some((l) => l.kind === 'new');

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...(supplierId && { supplierId }),
        ...(invoiceNo.trim() && { supplierInvoiceNo: invoiceNo.trim() }),
        ...(note.trim() && { note: note.trim() }),
        consignment,
        ...(consignment && discount && { consignmentDiscountBp: Math.round(Number(discount.replace(',', '.')) * 100) }),
        ...(consignment && deadline && { consignmentDeadline: new Date(deadline).toISOString() }),
        lines: lines.map((l) =>
          l.kind === 'existing'
            ? { kind: 'existing', variantId: l.variantId, costVnd: digits(l.costVnd), sellingPriceVnd: digits(l.sellingPriceVnd), qty: digits(l.qty), ...(l.orderLineId && { orderLineId: l.orderLineId }) }
            : {
                kind: 'new',
                item: {
                  kind: l.itemKind,
                  i18n: { en: { title: l.title.trim(), description: l.description.trim() }, ...(l.titleVi.trim() && { vi: { title: l.titleVi.trim() } }) },
                  authors: l.authors.split(',').map((a) => a.trim()).filter(Boolean),
                  ...(l.publisherId && { publisherId: l.publisherId }),
                  categoryIds: l.categoryId ? [l.categoryId] : [],
                },
                variant: {
                  sku: l.sku.trim(),
                  ...(l.isbn.trim() && { isbn: l.isbn.trim() }),
                  barcodes: l.barcode.trim() ? [l.barcode.trim()] : [],
                  weightG: digits(l.weightG),
                  vatBp: l.vatBp,
                  minStock: l.minStock ? digits(l.minStock) : null,
                },
                imageFileIds: l.imageFileId ? [l.imageFileId] : [],
                costVnd: digits(l.costVnd),
                sellingPriceVnd: digits(l.sellingPriceVnd),
                qty: digits(l.qty),
              },
        ),
      };
      const r = await post<{ entryNo: string; totalCostVnd: number; lines: { marginFlag: boolean; createdProduct: boolean; priceChanged: boolean }[] }>('/api/v1/purchasing/stock-in', body);
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
            {result.lines.some((l) => l.createdProduct) && ` · ${result.lines.filter((l) => l.createdProduct).length} sản phẩm mới`}
          </p>
          {result.lines.some((l) => l.marginFlag) && <InlineAlert tone="warning">{result.lines.filter((l) => l.marginFlag).length} dòng có lãi dưới mức tối thiểu. Kiểm tra giá bán.</InlineAlert>}
          {result.lines.some((l) => l.priceChanged) && <InlineAlert tone="info">Giá bán đã được cập nhật cho {result.lines.filter((l) => l.priceChanged).length} sản phẩm.</InlineAlert>}
          <Button variant="primary" full onClick={() => (orderId ? navigate('/supplier-orders') : onClose())}>
            Xong
          </Button>
        </div>
      </Dialog>
    );

  return (
    <Dialog
      title="Phiếu nhập hàng"
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
          <Button variant="primary" loading={busy} disabled={!lines.length || (hasNew && !supplierId)} onClick={submit}>
            Xác nhận nhập hàng
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Nhà cung cấp" required={hasNew} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
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
          {consignment && (
            <>
              <Field label="Chiết khấu thỏa thuận" suffix="%" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              <Field label="Hạn đối soát / trả hàng" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </>
          )}
        </div>

        <ProductSearch
          autoFocus
          onPick={(h) =>
            setLines((ls) => {
              const same = ls.find((l) => l.kind === 'existing' && l.variantId === h.variantId);
              if (same) return ls.map((l) => (l === same ? { ...l, qty: String(digits(l.qty) + 1) } : l));
              return [...ls, { kind: 'existing', key: crypto.randomUUID(), variantId: h.variantId, title: hitTitle(h), sku: h.sku, costVnd: '', sellingPriceVnd: String(h.priceVnd), qty: '1' }];
            })
          }
          onUnknownCode={(code) => setLines((ls) => [...ls, newLine(code)])}
        />
        <Button variant="tonal" size="sm" icon={Plus} className="self-start" onClick={() => setLines((ls) => [...ls, newLine()])}>
          Sản phẩm mới
        </Button>

        <ul className="flex flex-col gap-3">
          {lines.map((l) => (
            <li key={l.key} className={clsx('rounded-lg border p-4', l.kind === 'new' ? 'border-olive-100 bg-olive-50' : 'border-paper-300')}>
              <div className="mb-3 flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {l.kind === 'existing' ? (
                    <>
                      <p className="font-medium">{l.title}</p>
                      <p className="code text-[13px] text-ink-500">{l.sku}</p>
                    </>
                  ) : (
                    <StatusChip tone="accent">Sản phẩm mới</StatusChip>
                  )}
                </div>
                <button type="button" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-danger-50" aria-label="Bỏ dòng" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  <Trash2 size={18} aria-hidden />
                </button>
              </div>
              {l.kind === 'new' && <NewProductFields line={l} onChange={(p) => update(l.key, p)} categories={categories.data?.items ?? []} publishers={publishers.data?.items ?? []} />}
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
        {hasNew && !supplierId && <InlineAlert tone="info">Sản phẩm mới cần chọn nhà cung cấp.</InlineAlert>}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

function NewProductFields({ line: l, onChange, categories, publishers }: { line: NewLine; onChange: (p: Partial<NewLine>) => void; categories: Named[]; publishers: Named[] }) {
  const [uploading, setUploading] = useState(false);
  return (
    <div className="mb-3 grid gap-3 sm:grid-cols-2">
      <SelectField label="Loại" value={l.itemKind} onChange={(e) => onChange({ itemKind: e.target.value as NewLine['itemKind'], vatBp: e.target.value === 'book' ? 0 : 1000 })}>
        <option value="book">Sách</option>
        <option value="stationery">Văn phòng phẩm</option>
        <option value="other">Khác</option>
      </SelectField>
      <SelectField label="Danh mục" required value={l.categoryId} onChange={(e) => onChange({ categoryId: e.target.value })}>
        <option value="">— Chọn —</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {nameOf(c)}
          </option>
        ))}
      </SelectField>
      <Field label="Tên sản phẩm (tiếng Anh)" required value={l.title} onChange={(e) => onChange({ title: e.target.value })} />
      <Field label="Tên tiếng Việt" value={l.titleVi} onChange={(e) => onChange({ titleVi: e.target.value })} />
      <Field label="SKU" required className="code" value={l.sku} onChange={(e) => onChange({ sku: e.target.value.toUpperCase() })} />
      {l.itemKind === 'book' ? <Field label="ISBN" inputMode="numeric" value={l.isbn} onChange={(e) => onChange({ isbn: e.target.value })} /> : <Field label="Mã vạch" value={l.barcode} onChange={(e) => onChange({ barcode: e.target.value })} helper="Để trống để in mã nội bộ." />}
      {l.itemKind === 'book' && (
        <>
          <Field label="Tác giả (cách nhau dấu phẩy)" value={l.authors} onChange={(e) => onChange({ authors: e.target.value })} />
          <SelectField label="Nhà xuất bản" value={l.publisherId} onChange={(e) => onChange({ publisherId: e.target.value })}>
            <option value="">—</option>
            {publishers.map((p) => (
              <option key={p.id} value={p.id}>
                {nameOf(p)}
              </option>
            ))}
          </SelectField>
        </>
      )}
      <Field label="Khối lượng" required suffix="g" inputMode="numeric" value={l.weightG} onChange={(e) => onChange({ weightG: e.target.value.replace(/\D/g, '') })} />
      <SelectField label="Thuế VAT" value={String(l.vatBp)} onChange={(e) => onChange({ vatBp: Number(e.target.value) })}>
        {VAT_RATES_BP.map((v) => (
          <option key={v} value={v}>
            {v / 100}%
          </option>
        ))}
      </SelectField>
      <Field label="Tồn tối thiểu" inputMode="numeric" value={l.minStock} onChange={(e) => onChange({ minStock: e.target.value.replace(/\D/g, '') })} />
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium text-ink-700">
          Ảnh sản phẩm <span className="text-danger-700">*</span>
        </span>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-paper-500 px-4 text-sm hover:bg-navy-50">
          <ImagePlus size={18} aria-hidden />
          {uploading ? 'Đang tải…' : l.imageName || 'Chọn ảnh'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setUploading(true);
              try {
                const r = await upload(f, 'image');
                onChange({ imageFileId: r.id, imageName: f.name });
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>
      </div>
      <TextArea label="Mô tả (tiếng Anh)" required className="sm:col-span-2" value={l.description} onChange={(e) => onChange({ description: e.target.value })} />
    </div>
  );
}

