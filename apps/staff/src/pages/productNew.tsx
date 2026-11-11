import { VAT_RATES_BP } from '@bookstore/domain';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, ImagePlus, Plus } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { BookLookup, type BookResult } from '../components/bookLookup';
import { SelectField, TextArea, toast } from '../components/data';
import { Button, Card, Field, InlineAlert, PageHeader, StatusChip } from '../components/ui';
import { get, post, upload } from '../lib/api';
import { formatNumber, formatVnd } from '../lib/format';
import { categoryOptions, nameOf, type Category, type Named } from './products';
import { useSuppliers } from './stockin';

/** “Thêm sản phẩm mới” page (FR-CAT-01..04, FR-CAT-16, Design §12.1, §12.4): grouped cards, cost required, profit per unit, book lookup. */

/** Fields the book lookup can fill (FR-CAT-16). */
type AutoField = 'title' | 'isbn' | 'authors' | 'publisherId' | 'description' | 'image';
/** Select value for a publisher from the lookup that is not on file yet: created on save. */
const NEW_PUBLISHER = '__new__';

function AutoChip() {
  return (
    <span className="ml-1.5 align-middle">
      <StatusChip tone="info">Tự điền</StatusChip>
    </span>
  );
}

interface Unit {
  code: string;
  i18n: { vi?: { name?: string }; en?: { name?: string } };
}

export function ProductNewPage() {
  const navigate = useNavigate();
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => get<{ items: Category[] }>('/api/v1/catalog/categories') });
  const publishers = useQuery({ queryKey: ['publishers'], queryFn: () => get<{ items: Named[] }>('/api/v1/catalog/publishers') });
  const units = useQuery({ queryKey: ['master-data', 'unit'], queryFn: () => get<{ items: Unit[] }>('/api/v1/admin/master-data/unit') });
  const unitList = useId();
  const suppliers = useSuppliers();
  const [f, setF] = useState({ kind: 'book' as 'book' | 'stationery' | 'other', sku: '', title: '', categoryId: '', description: '', isbn: '', barcode: '', authors: '', publisherId: '', unit: '', weightG: '', cost: '', price: '', qty: '', supplierId: '', consignment: false, discount: '', deadline: '', minStock: '', vatBp: 0 });
  const [image, setImage] = useState<File | null>(null);
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
  const label = (text: string, k: AutoField) => (
    <>
      {text}
      {auto.has(k) && <AutoChip />}
    </>
  );
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
    <div className="max-w-[720px] pb-20">
      <PageHeader
        breadcrumb={
          <Link to="/products" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Sản phẩm
          </Link>
        }
        title="Thêm sản phẩm mới"
      />
      <div className="flex flex-col gap-6">
        <Card title="Thông tin sản phẩm">
          {book && (
            <div className="mb-4">
              <BookLookup onPick={fill} />
              {auto.size > 0 && <p className="mt-1 text-xs text-ink-500">Dữ liệu từ Open Library</p>}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField label="Loại" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind, vatBp: e.target.value === 'book' ? 0 : 1000 })}>
              <option value="book">Sách</option>
              <option value="stationery">Văn phòng phẩm</option>
              <option value="other">Sản phẩm khác</option>
            </SelectField>
            <Field label="SKU" required className="code" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} autoFocus />
            <Field label={label('Tên sản phẩm', 'title')} required value={f.title} onChange={set('title')} className="sm:col-span-2" />
            <SelectField label="Danh mục" required value={f.categoryId} onChange={set('categoryId')} className="sm:col-span-2">
              <option value="">— Chọn —</option>
              {categoryOptions(categories.data?.items ?? [], []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </SelectField>
            <SelectField label="Nhà cung cấp" required value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} className="sm:col-span-2">
              <option value="">— Chọn —</option>
              {suppliers.data?.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </SelectField>
            <div className="sm:col-span-2">
              <TextArea label={label('Mô tả', 'description')} required value={f.description} onChange={set('description')} rows={auto.has('description') ? 6 : 3} helper={auto.has('description') ? 'Tự điền từ Open Library – nên kiểm tra hoặc viết lại.' : undefined} />
            </div>
            {book ? (
              <>
                <Field label={label('ISBN', 'isbn')} inputMode="numeric" value={f.isbn} onChange={set('isbn')} />
                <Field label={label('Tác giả', 'authors')} value={f.authors} onChange={set('authors')} helper="Nhiều tác giả cách nhau bằng dấu phẩy." />
                <SelectField label={label('Nhà xuất bản', 'publisherId')} value={f.publisherId} onChange={set('publisherId')} className="sm:col-span-2">
                  <option value="">—</option>
                  {newPublisher && <option value={NEW_PUBLISHER}>NXB mới: {newPublisher}</option>}
                  {(publishers.data?.items ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {nameOf(p)}
                    </option>
                  ))}
                </SelectField>
              </>
            ) : (
              <Field label="Mã vạch" value={f.barcode} onChange={set('barcode')} helper="Để trống để in mã nội bộ." className="sm:col-span-2" />
            )}
            {/* Free text with suggestions from the unit list (Design §12.1). */}
            <Field label="Đơn vị" list={unitList} value={f.unit} onChange={set('unit')} helper="Chọn gợi ý hoặc tự gõ." />
            <datalist id={unitList}>
              {(units.data?.items ?? []).map((u) => (
                <option key={u.code} value={u.i18n.vi?.name || u.i18n.en?.name || u.code} />
              ))}
            </datalist>
            <Field label="Khối lượng" required suffix="g" inputMode="numeric" value={f.weightG} onChange={num('weightG')} />
          </div>
        </Card>

        <Card title="Giá">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Giá nhập" required suffix="₫" inputMode="numeric" value={money(f.cost)} onChange={num('cost')} />
            <Field label="Giá bán" required suffix="₫" inputMode="numeric" value={money(f.price)} onChange={num('price')} />
          </div>
          {profit !== null && (
            <p className={clsx('mt-3 text-sm num', profit < 0 ? 'text-danger-700' : 'text-ink-700')} aria-live="polite">
              Lãi mỗi sản phẩm: <span className="font-semibold">{formatVnd(profit)}</span>
              {profitPct !== null && ` (${profitPct}%)`}
            </p>
          )}
        </Card>

        <Card title="Tồn kho và thuế">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Số lượng nhập lần đầu" required inputMode="numeric" value={f.qty} onChange={num('qty')} />
            <Field label="Tồn tối thiểu" inputMode="numeric" value={f.minStock} onChange={num('minStock')} />
            <SelectField label="Thuế VAT" value={String(f.vatBp)} onChange={(e) => setF({ ...f, vatBp: Number(e.target.value) })}>
              {VAT_RATES_BP.map((v) => (
                <option key={v} value={v}>
                  {v / 100}%
                </option>
              ))}
            </SelectField>
            {consignor && (
              <label className="inline-flex items-center gap-2 text-sm sm:col-span-3">
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
        </Card>

        <Card title="Ảnh sản phẩm">
          <p className="mb-3 text-[13px] text-ink-500">Bắt buộc một ảnh (JPG, PNG hoặc WebP).</p>
          {cover && !image && (
            <div className="mb-3 flex items-center gap-3">
              <img src={`/api/v1/files/${cover.fileId}`} alt="Ảnh bìa" className="h-24 w-16 rounded-sm border border-paper-300 object-cover" />
              <span className="text-sm text-ink-700">
                Ảnh bìa từ Open Library
                <AutoChip />
              </span>
            </div>
          )}
          {coverBusy && <p className="mb-3 text-sm text-ink-500">Đang tải ảnh bìa…</p>}
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-paper-500 px-4 text-sm hover:bg-navy-50">
            <ImagePlus size={18} aria-hidden />
            <span className="max-w-[240px] truncate">{image ? image.name : cover ? 'Chọn ảnh khác' : 'Chọn ảnh'}</span>
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
        </Card>

        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>

      {/* Sticky action bar (Design §12.4) */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-center justify-end gap-2 border-t border-paper-300 bg-white px-4 shadow-sm sm:px-6 md:left-[72px] lg:left-[264px]">
        <Button variant="secondary" onClick={() => navigate('/products')}>
          Hủy
        </Button>
        <Button variant="primary" icon={Plus} loading={busy} onClick={save}>
          Thêm sản phẩm mới
        </Button>
      </div>
    </div>
  );
}
