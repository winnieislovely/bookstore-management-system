import { VAT_RATES_BP } from '@bookstore/domain';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Globe, ImagePlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { BookLookup, type BookResult } from '../components/bookLookup';
import { SelectField, TextArea, toast } from '../components/data';
import { Button, Field, InlineAlert, PageHeader } from '../components/ui';
import { get, post, upload } from '../lib/api';
import { formatNumber, formatVnd } from '../lib/format';
import { categoryOptions, nameOf, type Category, type Named } from './products';
import { useSuppliers } from './stockin';

/** “Thêm sản phẩm mới” page (FR-CAT-01..04, FR-CAT-16, Design §12.1, §12.4): grouped cards, cost required, profit per unit, book lookup. */

/** Fields the book lookup can fill (FR-CAT-16). */
type AutoField = 'title' | 'isbn' | 'authors' | 'publisherId' | 'description' | 'image';
/** Select value for a publisher from the lookup that is not on file yet: created on save. */
const NEW_PUBLISHER = '__new__';

export function ProductNewPage() {
  const navigate = useNavigate();
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => get<{ items: Category[] }>('/api/v1/catalog/categories') });
  const publishers = useQuery({ queryKey: ['publishers'], queryFn: () => get<{ items: Named[] }>('/api/v1/catalog/publishers') });
  const suppliers = useSuppliers();
  const [f, setF] = useState({ kind: 'book' as 'book' | 'stationery' | 'other', sku: '', title: '', categoryId: '', description: '', isbn: '', barcode: '', authors: '', publisherId: '', unit: '', weightG: '', cost: '', price: '', qty: '', supplierId: '', consignment: false, discount: '', deadline: '', minStock: '', vatBp: 0, web: false, shelfCode: '' });
  // The store's shelves, to find the product later (FR-CAT-01).
  const shelves = useQuery({ queryKey: ['master', 'shelf'], queryFn: () => get<{ items: { code: string; i18n: { vi?: { name?: string } } }[] }>('/api/v1/admin/master-data/shelf') });
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!image) return setPreview(null);
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  // Book lookup (FR-CAT-16): which fields it filled, a publisher to create, a cover already stored.
  const [auto, setAuto] = useState<Set<AutoField>>(new Set());
  const [newPublisher, setNewPublisher] = useState<string | null>(null);
  const [cover, setCover] = useState<{ fileId: string } | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unmark = (k: string) => auto.has(k as AutoField) && setAuto((a) => new Set([...a].filter((x) => x !== k)));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    unmark(k);
    setF({ ...f, [k]: e.target.value });
  };
  const num = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '') });
  const digits = (v: string) => Number(v.replace(/\D/g, ''));
  const money = (v: string) => (v ? formatNumber(digits(v)) : '');
  const book = f.kind === 'book';
  // Consignment opening stock only from a supplier that takes consignment (FR-PUR-09).
  const consignor = !!suppliers.data?.items.find((x) => x.id === f.supplierId)?.isConsignor;
  const consignment = consignor && f.consignment;
  const ready = f.sku.trim() && f.title.trim() && f.categoryId && f.description.trim() && f.cost.trim() && f.price.trim() && digits(f.weightG) > 0 && f.supplierId && digits(f.qty) > 0 && (!!image || !!cover);
  // Profit on one unit sold: selling price − cost, and its share of the selling price.
  const profit = f.cost.trim() && f.price.trim() ? digits(f.price) - digits(f.cost) : null;
  const profitPct = profit !== null && digits(f.price) > 0 ? Math.round((profit / digits(f.price)) * 100) : null;

  /** Fill only the empty fields from a looked-up book; a missing description and the cover are fetched after (FR-CAT-16). */
  const fill = useCallback(
    (b: BookResult) => {
      const marked: AutoField[] = [];
      const next = { ...f };
      if (!f.title.trim() && b.title) {
        next.title = b.title;
        marked.push('title');
      }
      if (!f.isbn.trim() && b.isbn13) {
        next.isbn = b.isbn13;
        marked.push('isbn');
      }
      if (!f.authors.trim() && b.authors.length) {
        next.authors = b.authors.join(', ');
        marked.push('authors');
      }
      if (!f.publisherId && b.publisher) {
        next.publisherId = b.publisherId ?? NEW_PUBLISHER;
        if (!b.publisherId) setNewPublisher(b.publisher);
        marked.push('publisherId');
      }
      if (!f.description.trim() && b.description) {
        next.description = b.description;
        marked.push('description');
      }
      setF(next);
      setAuto((a) => new Set([...a, ...marked]));
      if (!b.description && b.workId) {
        void get<{ description: string | null }>(`/api/v1/catalog/book-lookup/description?work=${b.workId}`)
          .then((r) => {
            if (!r.description) return;
            setF((prev) => (prev.description.trim() ? prev : { ...prev, description: r.description! }));
            setAuto((a) => new Set([...a, 'description']));
          })
          .catch(() => undefined);
      }
      if (b.coverId && !image && !cover) {
        setCoverBusy(true);
        post<{ id: string }>('/api/v1/catalog/book-lookup/cover', { coverId: b.coverId })
          .then((r) => {
            setCover({ fileId: r.id });
            setAuto((a) => new Set([...a, 'image']));
          })
          .catch(() => undefined)
          .finally(() => setCoverBusy(false));
      }
    },
    [f, image, cover],
  );

  /** A publisher from the lookup that is not on file: create it, or find it if someone just did (FR-CAT-16). */
  const publisherIdForSave = async (): Promise<string | null> => {
    if (f.publisherId !== NEW_PUBLISHER) return f.publisherId || null;
    if (!newPublisher) return null;
    try {
      return (await post<{ id: string }>('/api/v1/catalog/publishers', { i18n: { en: { name: newPublisher } } })).id;
    } catch {
      const list = await get<{ items: Named[] }>('/api/v1/catalog/publishers');
      const key = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return list.items.find((p) => key(nameOf(p)) === key(newPublisher))?.id ?? null;
    }
  };

  const save = async () => {
    if (!ready) return setError(image || cover ? 'Hãy điền đủ các ô bắt buộc (*).' : 'Hãy điền đủ các ô bắt buộc (*) và chọn ảnh sản phẩm.');
    setBusy(true);
    setError(null);
    try {
      // Upload the photo first so a failed upload does not leave a product behind.
      // A cover from the book lookup is already stored (FR-CAT-16); a chosen photo replaces it.
      const fileId = image ? (await upload(image, 'image')).id : (cover?.fileId ?? null); // always set: the photo is required (FR-PUR-02)
      const publisherId = book ? await publisherIdForSave() : null;
      const r = await post<{ itemId: string }>('/api/v1/catalog/items', {
        kind: f.kind,
        i18n: { en: { title: f.title.trim(), description: f.description.trim() } },
        authors: book ? f.authors.split(',').map((a) => a.trim()).filter(Boolean) : [],
        ...(publisherId && { publisherId }),
        ...(f.unit.trim() && { unit: f.unit.trim() }),
        categoryIds: [f.categoryId],
        variants: [
          {
            sku: f.sku.trim(),
            ...(book && f.isbn.trim() && { isbn: f.isbn.trim() }),
            barcodes: !book && f.barcode.trim() ? [f.barcode.trim()] : [],
            weightG: digits(f.weightG),
            priceVnd: digits(f.price),
            vatBp: f.vatBp,
            minStock: f.minStock ? digits(f.minStock) : null,
            // Published on the website as soon as it is created when switched on (FR-CAT-09).
            publishedWeb: f.web,
            shelfCode: f.shelfCode || null,
          },
        ],
        // First stock-in from the supplier (FR-PUR-02, FR-PUR-04).
        opening: {
          costVnd: digits(f.cost),
          qty: digits(f.qty),
          supplierId: f.supplierId,
          ...(consignment && {
            consignment: true,
            ...(f.discount && { consignmentDiscountBp: Math.round(Number(f.discount.replace(',', '.')) * 100) }),
            ...(f.deadline && { consignmentDeadline: new Date(f.deadline).toISOString() }),
          }),
        },
      });
      if (fileId) {
        try {
          await post(`/api/v1/catalog/items/${r.itemId}/images`, { fileId });
        } catch (e) {
          toast.error(`Đã tạo sản phẩm nhưng chưa thêm được ảnh: ${(e as Error).message}`);
        }
      }
      toast.success('Đã thêm sản phẩm mới.');
      navigate(`/products/${r.itemId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    // Wide screens: two columns like the selling screen – details left, image, prices, stock and buttons right (Design §12.4).
    <div className="max-w-[720px] lg:max-w-none">
      <PageHeader
        back={{ to: '/products', label: 'Sản phẩm' }}
        title="Thêm sản phẩm mới"
      />
      {/* Two framed parts so they read apart (Design §12.4). */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <section className="rounded-lg border border-paper-300 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-4 text-base font-semibold text-ink-900">Thông tin chi tiết</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Loại sản phẩm first: label in the left half, the select as wide as the fields below; Tìm sách right under it for a book. */}
            <label className="grid grid-cols-2 items-center gap-4 text-sm sm:col-span-2">
              <span className="text-ink-700">Loại sản phẩm</span>
              <select
                className="h-10 w-full rounded-md border border-paper-500 bg-white px-3 text-sm pointer-coarse:h-11 max-sm:text-base"
                value={f.kind}
                onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind, vatBp: e.target.value === 'book' ? 0 : 1000 })}
              >
                <option value="book">Sách</option>
                <option value="stationery">Văn phòng phẩm</option>
                <option value="other">Sản phẩm khác</option>
              </select>
            </label>
            {book && (
              <div className="sm:col-span-2">
                <BookLookup onPick={fill} />
              </div>
            )}
            {/* Tên sản phẩm on its own line; SKU with Danh mục; Nhà cung cấp with Nhà xuất bản (Design §12.4). */}
            <Field label="Tên sản phẩm" required value={f.title} onChange={set('title')} className="sm:col-span-2" />
            <Field label="SKU" required className="code" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} autoFocus />
            <SelectField label="Danh mục" required value={f.categoryId} onChange={set('categoryId')}>
              <option value="">— Chọn —</option>
              {categoryOptions(categories.data?.items ?? [], []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </SelectField>
            <SelectField label="Nhà cung cấp" required value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
              <option value="">— Chọn —</option>
              {suppliers.data?.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </SelectField>
            {book ? (
              <>
                <SelectField label="Nhà xuất bản" value={f.publisherId} onChange={set('publisherId')}>
                  <option value="">—</option>
                  {newPublisher && <option value={NEW_PUBLISHER}>NXB mới: {newPublisher}</option>}
                  {(publishers.data?.items ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {nameOf(p)}
                    </option>
                  ))}
                </SelectField>
                <Field label="ISBN" inputMode="numeric" value={f.isbn} onChange={set('isbn')} />
                <Field label="Tác giả" value={f.authors} onChange={set('authors')} placeholder="VD: Tô Hoài, Nguyễn Nhật Ánh" />
              </>
            ) : (
              <Field label="Mã vạch" value={f.barcode} onChange={set('barcode')} helper="Để trống để in mã nội bộ." />
            )}
            {/* Plain free text, no suggestions (Design §12.1). */}
            <Field label="Đơn vị" value={f.unit} onChange={set('unit')} placeholder="VD: cuốn" />
            <Field label="Khối lượng" required suffix="g" inputMode="numeric" value={f.weightG} onChange={num('weightG')} />
            <div className="sm:col-span-2">
              <TextArea label="Mô tả" required value={f.description} onChange={set('description')} rows={auto.has('description') ? 6 : 3} />
            </div>
            {/* Ảnh sản phẩm under Mô tả; the chosen photo or the found cover shown in full (Design §12.4). */}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="text-[13px] font-medium text-ink-700">
                Ảnh sản phẩm<span className="text-danger-700"> *</span>
              </span>
              {preview || (cover && !image) ? (
                <img src={preview ?? `/api/v1/files/${cover!.fileId}`} alt="Ảnh sản phẩm" className="max-h-60 max-w-full self-start rounded-md border border-paper-300 bg-paper-50 object-contain" />
              ) : (
                <p className="text-[13px] text-ink-500">Bắt buộc một ảnh (JPG, PNG hoặc WebP).</p>
              )}
              {coverBusy && <p className="text-sm text-ink-500">Đang tải ảnh bìa…</p>}
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 self-start rounded-full border border-paper-500 px-4 text-sm hover:bg-navy-50">
                <ImagePlus size={18} aria-hidden />
                <span>{image || cover ? 'Chọn ảnh khác' : 'Chọn ảnh'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    setImage(e.target.files?.[0] ?? null);
                    unmark('image');
                  }}
                />
              </label>
            </div>
          </div>
        </section>

        {/* Wide screens: the right column stays in place while the details scroll, Xác nhận always in view (Design §12.4). */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-20">
          <div className="flex flex-col gap-8 rounded-lg border border-paper-300 bg-white p-4 shadow-sm sm:p-6">
          <section>
            <h2 className="mb-4 text-base font-semibold text-ink-900">Giá và thuế</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Giá nhập" required suffix="₫" inputMode="numeric" value={money(f.cost)} onChange={num('cost')} />
              <Field label="Giá bán" required suffix="₫" inputMode="numeric" value={money(f.price)} onChange={num('price')} />
              {/* The tax with the prices: the selling price includes it (BR-02, Design §12.4). */}
              <SelectField label="Thuế VAT" value={String(f.vatBp)} onChange={(e) => setF({ ...f, vatBp: Number(e.target.value) })}>
                {VAT_RATES_BP.map((v) => (
                  <option key={v} value={v}>
                    {v / 100}%
                  </option>
                ))}
              </SelectField>
            </div>
            {profit !== null && (
              <p className={clsx('mt-3 text-sm num', profit < 0 ? 'text-danger-700' : 'text-ink-700')} aria-live="polite">
                Lãi mỗi sản phẩm: <span className="font-semibold">{formatVnd(profit)}</span>
                {profitPct !== null && ` (${profitPct}%)`}
              </p>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-base font-semibold text-ink-900">Tồn kho</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Số lượng nhập lần đầu" required inputMode="numeric" value={f.qty} onChange={num('qty')} />
              <Field label="Tồn tối thiểu" inputMode="numeric" value={f.minStock} onChange={num('minStock')} />
              {/* One shelf from Cấu hình › Kệ hàng, to find it when a customer asks (Design §12.4). */}
              <SelectField label="Kệ" value={f.shelfCode} onChange={set('shelfCode')} className="sm:col-span-2">
                <option value="">—</option>
                {(shelves.data?.items ?? []).map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.i18n.vi?.name ?? x.code}
                  </option>
                ))}
              </SelectField>
              {consignor && (
                <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" className="size-5 accent-navy-700" checked={f.consignment} onChange={(e) => setF({ ...f, consignment: e.target.checked })} />
                  Hàng ký gửi
                </label>
              )}
              {consignment && (
                <>
                  <Field label="Chiết khấu thỏa thuận" suffix="%" inputMode="decimal" value={f.discount} onChange={set('discount')} />
                  <Field label="Hạn đối soát / trả hàng" type="date" value={f.deadline} onChange={set('deadline')} />
                </>
              )}
            </div>
          </section>

          {/* Website: published as soon as it is created when on; off by default (Design §12.4). */}
          <section>
            <h2 className="mb-4 text-base font-semibold text-ink-900">Website</h2>
            {/* Text left, a compact switch right; the whole row is the tap area (Design §12.4). */}
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
              <span className="inline-flex items-center gap-2 text-ink-700">
                <Globe size={16} aria-hidden /> Hiển thị trên website
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={f.web}
                aria-label="Hiển thị trên website"
                onClick={() => setF({ ...f, web: !f.web })}
                className={clsx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors', f.web ? 'bg-success-700' : 'bg-paper-500')}
              >
                <span className={clsx('inline-block size-4 rounded-full bg-white shadow-sm transition-transform', f.web ? 'translate-x-[18px]' : 'translate-x-0.5')} />
              </button>
            </label>
          </section>

          </div>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          {/* The two buttons at equal widths under the right card; no bar fixed to the bottom (Design §12.4). */}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" full onClick={() => navigate('/products')}>
              Hủy
            </Button>
            <Button variant="primary" size="lg" full loading={busy} onClick={save}>
              Xác nhận
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
