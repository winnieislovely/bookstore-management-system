import { VAT_RATES_BP } from '@bookstore/domain';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, ImagePlus, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { SelectField, TextArea, toast } from '../components/data';
import { Button, Card, Field, InlineAlert, PageHeader } from '../components/ui';
import { get, post, upload } from '../lib/api';
import { formatNumber, formatVnd } from '../lib/format';
import { categoryOptions, nameOf, type Category, type Named } from './products';

/** “Thêm sản phẩm mới” page (FR-CAT-01..04, Design §12.1, §12.4): grouped cards, cost required, profit per unit. */

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
  const [f, setF] = useState({ kind: 'book' as 'book' | 'stationery' | 'other', sku: '', title: '', categoryId: '', description: '', isbn: '', barcode: '', authors: '', publisherId: '', unit: '', weightG: '', cost: '', price: '', qty: '', minStock: '', vatBp: 0 });
  const [image, setImage] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const num = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value.replace(/\D/g, '') });
  const digits = (v: string) => Number(v.replace(/\D/g, ''));
  const money = (v: string) => (v ? formatNumber(digits(v)) : '');
  const book = f.kind === 'book';
  const ready = f.sku.trim() && f.title.trim() && f.categoryId && f.description.trim() && f.cost.trim() && f.price.trim() && digits(f.weightG) > 0;
  // Profit on one unit sold: selling price − cost, and its share of the selling price.
  const profit = f.cost.trim() && f.price.trim() ? digits(f.price) - digits(f.cost) : null;
  const profitPct = profit !== null && digits(f.price) > 0 ? Math.round((profit / digits(f.price)) * 100) : null;

  const save = async () => {
    if (!ready) return setError('Hãy điền đủ các ô bắt buộc (*).');
    setBusy(true);
    setError(null);
    try {
      // Upload the photo first so a failed upload does not leave a product behind.
      const fileId = image ? (await upload(image, 'image')).id : null;
      const r = await post<{ itemId: string }>('/api/v1/catalog/items', {
        kind: f.kind,
        i18n: { en: { title: f.title.trim(), description: f.description.trim() } },
        authors: book ? f.authors.split(',').map((a) => a.trim()).filter(Boolean) : [],
        ...(book && f.publisherId && { publisherId: f.publisherId }),
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
        opening: { costVnd: digits(f.cost), ...(digits(f.qty) > 0 && { qty: digits(f.qty) }) },
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
        <Card title="Thông tin chung">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField label="Loại" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind, vatBp: e.target.value === 'book' ? 0 : 1000 })}>
              <option value="book">Sách</option>
              <option value="stationery">Văn phòng phẩm</option>
              <option value="other">Sản phẩm khác</option>
            </SelectField>
            <Field label="SKU" required className="code" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} autoFocus />
            <Field label="Tên sản phẩm" required value={f.title} onChange={set('title')} className="sm:col-span-2" />
            <SelectField label="Danh mục" required value={f.categoryId} onChange={set('categoryId')} className="sm:col-span-2">
              <option value="">— Chọn —</option>
              {categoryOptions(categories.data?.items ?? [], []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </SelectField>
            <div className="sm:col-span-2">
              <TextArea label="Mô tả" required value={f.description} onChange={set('description')} />
            </div>
          </div>
        </Card>

        <Card title="Mã và quy cách">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {book ? (
              <>
                <Field label="ISBN" inputMode="numeric" value={f.isbn} onChange={set('isbn')} />
                <Field label="Tác giả" value={f.authors} onChange={set('authors')} helper="Nhiều tác giả cách nhau bằng dấu phẩy." />
                <SelectField label="Nhà xuất bản" value={f.publisherId} onChange={set('publisherId')} className="sm:col-span-2">
                  <option value="">—</option>
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
            <Field label="Số lượng nhập lần đầu" inputMode="numeric" value={f.qty} onChange={num('qty')} helper="Để trống nếu chưa có hàng." />
            <Field label="Tồn tối thiểu" inputMode="numeric" value={f.minStock} onChange={num('minStock')} />
            <SelectField label="Thuế VAT" value={String(f.vatBp)} onChange={(e) => setF({ ...f, vatBp: Number(e.target.value) })}>
              {VAT_RATES_BP.map((v) => (
                <option key={v} value={v}>
                  {v / 100}%
                </option>
              ))}
            </SelectField>
          </div>
        </Card>

        <Card title="Ảnh sản phẩm">
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-paper-500 px-4 text-sm hover:bg-navy-50">
            <ImagePlus size={18} aria-hidden />
            <span className="max-w-[240px] truncate">{image ? image.name : 'Chọn ảnh'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
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
