import { VAT_RATES_BP } from '@bookstore/domain';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowLeft, Globe, History, ImageOff, ImagePlus, Package, Pencil, Printer, Store, Tag, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ConfirmDialog, Facts, SelectField, TextArea, toast } from '../components/data';
import { hitTitle, ProductSearch } from '../components/product-search';
import { Button, Card, ErrorState, Field, InlineAlert, PageHeader, Skeleton, StatusChip } from '../components/ui';
import { del, get, patch, post, put, upload } from '../lib/api';
import { formatDate, formatDateTime, formatNumber, formatVnd } from '../lib/format';
import { printHtml } from '../lib/print';
import { can, useMe } from '../lib/session';
import { Dialog } from '../pos/widgets';

/**
 * Product detail (FR-CAT-01..15, Design §12.3): ISBN and publication channels live here, not in
 * the list. Cost and margin only with `catalog.view_cost`. Missing photos are added here (FR-CAT-11).
 */

interface Variant {
  id: string;
  sku: string;
  isbn13: string | null;
  weightG: number;
  priceVnd: number;
  listPriceVnd: number | null;
  vatBp: number;
  status: string;
  publishedPos: boolean;
  publishedWeb: boolean;
  minStock: number | null;
  version: number;
  barcodes: { code: string; kind: string }[];
  stock: { onHand: number; reserved: number; available: number; byLocation: { location: string; onHand: number; reserved: number }[] };
  avgCostVnd?: number;
  marginVnd?: number;
}
interface Item {
  id: string;
  kind: 'book' | 'stationery' | 'other' | 'bundle';
  i18n: { en: { title: string; description: string; subtitle?: string }; vi?: { title?: string; description?: string } };
  authors: string[];
  translator: string | null;
  publisherId: string | null;
  publicationYear: number | null;
  pageCount: number | null;
  coverType: string | null;
  releaseDate: string | null;
  status: string;
  version: number;
  categories: { id: string; i18n: { vi?: { name?: string }; en?: { name?: string } } }[];
  images: { id: string; fileId: string; sort: number }[];
  components: { bundleVariantId: string; variantId: string; qty: number; sku: string; title: string }[];
  variants: Variant[];
}

const KIND: Record<string, string> = { book: 'Sách', stationery: 'Văn phòng phẩm', other: 'Khác', bundle: 'Combo' };
const STATUS: Record<string, string> = { active: 'Đang bán', hidden: 'Đang ẩn', discontinued: 'Ngừng kinh doanh' };

export function ProductDetailPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const edit = can(me, 'catalog.edit');
  const q = useQuery({ queryKey: ['item', id], queryFn: () => get<Item>(`/api/v1/catalog/items/${id}`) });
  const [dialog, setDialog] = useState<null | { kind: 'info' } | { kind: 'price'; v: Variant } | { kind: 'history'; v: Variant } | { kind: 'variant'; v: Variant } | { kind: 'labels' } | { kind: 'bundle'; v: Variant } | { kind: 'image-delete'; imageId: string }>(null);
  const [uploading, setUploading] = useState(false);
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64" />;
  const x = q.data;
  const title = x.i18n.vi?.title || x.i18n.en.title;
  const refresh = () => void q.refetch();

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/products" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft size={16} aria-hidden /> Sản phẩm
          </Link>
        }
        title={title}
        actions={
          <>
            <Button variant="secondary" icon={Printer} onClick={() => setDialog({ kind: 'labels' })}>
              In nhãn
            </Button>
            {edit && (
              <Button variant="primary" icon={Pencil} onClick={() => setDialog({ kind: 'info' })}>
                Sửa thông tin
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip tone="neutral">{KIND[x.kind]}</StatusChip>
        {x.status !== 'active' && <StatusChip tone="neutral">{STATUS[x.status]}</StatusChip>}
        {x.images.length === 0 && <StatusChip tone="neutral" icon={ImageOff}>Thiếu ảnh</StatusChip>}
        {x.releaseDate && new Date(x.releaseDate) > new Date() && <StatusChip tone="accent">Sắp phát hành {formatDate(x.releaseDate)}</StatusChip>}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          {x.variants.map((v) => (
            <Card
              key={v.id}
              title={v.sku}
              action={
                edit && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={History} onClick={() => setDialog({ kind: 'history', v })}>
                      Lịch sử giá
                    </Button>
                    <Button size="sm" variant="tonal" icon={Tag} onClick={() => setDialog({ kind: 'price', v })}>
                      Đổi giá
                    </Button>
                    <Button size="sm" variant="ghost" icon={Pencil} aria-label="Sửa biến thể" onClick={() => setDialog({ kind: 'variant', v })} />
                  </div>
                )
              }
            >
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Facts
                  items={[
                    ['Giá bán', <span className="text-lg font-semibold num">{formatVnd(v.priceVnd)}</span>],
                    ...(v.listPriceVnd ? ([['Giá bìa', <span className="num">{formatVnd(v.listPriceVnd)}</span>]] as [string, React.ReactNode][]) : []),
                    ['Thuế VAT', `${v.vatBp / 100}%`],
                    ...(v.avgCostVnd !== undefined
                      ? ([
                          ['Giá vốn bình quân', <span className="num">{formatVnd(v.avgCostVnd)}</span>],
                          ['Lãi gộp', <span className={clsx('num', (v.marginVnd ?? 0) < 0 && 'text-danger-700')}>{formatVnd(v.marginVnd ?? 0)}{v.priceVnd ? ` (${Math.round(((v.marginVnd ?? 0) / v.priceVnd) * 100)}%)` : ''}</span>],
                        ] as [string, React.ReactNode][])
                      : []),
                    ...(v.isbn13 ? ([['ISBN', <span className="code">{v.isbn13}</span>]] as [string, React.ReactNode][]) : []),
                    ['Mã vạch', <span className="code">{v.barcodes.map((b) => b.code).join(', ') || '—'}</span>],
                    ['Khối lượng', `${formatNumber(v.weightG)} g`],
                  ]}
                />
                <div className="flex flex-col gap-3">
                  <Facts
                    items={[
                      ['Tồn kho', <span className="font-semibold num">{formatNumber(v.stock.onHand)}</span>],
                      ['Đang giữ', <span className="num">{formatNumber(v.stock.reserved)}</span>],
                      ['Có thể bán', <span className={clsx('font-semibold num', v.stock.available <= 0 && 'text-danger-700')}>{formatNumber(v.stock.available)}</span>],
                      ['Tồn tối thiểu', v.minStock == null ? '—' : formatNumber(v.minStock)],
                    ]}
                  />
                  <div className="flex gap-3 text-sm">
                    <span className={clsx('inline-flex items-center gap-1', !v.publishedPos && 'text-ink-300 line-through')}>
                      <Store size={16} aria-hidden /> Tại quầy
                    </span>
                    <span className={clsx('inline-flex items-center gap-1', !v.publishedWeb && 'text-ink-300 line-through')}>
                      <Globe size={16} aria-hidden /> Website
                    </span>
                  </div>
                </div>
              </div>
              {x.kind === 'bundle' && (
                <div className="mt-6 border-t border-paper-300 pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Sản phẩm trong combo</h3>
                    {edit && (
                      <Button size="sm" variant="tonal" icon={Package} onClick={() => setDialog({ kind: 'bundle', v })}>
                        Sửa thành phần
                      </Button>
                    )}
                  </div>
                  <ul className="divide-y divide-paper-300 text-sm">
                    {x.components
                      .filter((c) => c.bundleVariantId === v.id)
                      .map((c) => (
                        <li key={c.variantId} className="flex justify-between py-1.5">
                          <span>
                            {c.title} <span className="code text-ink-500">{c.sku}</span>
                          </span>
                          <span className="num">× {c.qty}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </Card>
          ))}
          <Card title="Mô tả">
            <p className="whitespace-pre-line text-sm text-ink-700">{x.i18n.vi?.description || x.i18n.en.description}</p>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card
            title="Ảnh"
            action={
              edit && (
                <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full bg-navy-50 px-3 text-sm text-navy-700 hover:bg-navy-100">
                  <ImagePlus size={16} aria-hidden /> {uploading ? 'Đang tải…' : 'Thêm ảnh'}
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
                        await post(`/api/v1/catalog/items/${x.id}/images`, { fileId: r.id });
                        toast.success('Đã thêm ảnh.');
                        refresh();
                      } catch (err) {
                        toast.error((err as Error).message);
                      } finally {
                        setUploading(false);
                        e.target.value = '';
                      }
                    }}
                  />
                </label>
              )
            }
          >
            {x.images.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-md bg-paper-200 py-8 text-ink-500">
                <ImageOff size={32} aria-hidden />
                <span className="text-sm">Chưa có ảnh sản phẩm</span>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {x.images.map((img) => (
                  <div key={img.id} className="group relative">
                    <img src={`/api/v1/files/${img.fileId}`} alt="" className={clsx('w-full rounded-sm border border-paper-300 bg-white object-cover', x.kind === 'book' ? 'aspect-[2/3]' : 'aspect-square')} />
                    {edit && (
                      <button type="button" className="absolute top-1 right-1 inline-flex size-8 items-center justify-center rounded-full bg-white/90 shadow-sm" aria-label="Xóa ảnh" onClick={() => setDialog({ kind: 'image-delete', imageId: img.id })}>
                        <Trash2 size={16} aria-hidden />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Thông tin">
            <Facts
              items={[
                ['Tên tiếng Anh', x.i18n.en.title],
                ['Danh mục', x.categories.map((c) => c.i18n.vi?.name || c.i18n.en?.name).join(', ')],
                ...(x.authors.length ? ([['Tác giả', x.authors.join(', ')]] as [string, string][]) : []),
                ...(x.translator ? ([['Dịch giả', x.translator]] as [string, string][]) : []),
                ...(x.publicationYear ? ([['Năm xuất bản', String(x.publicationYear)]] as [string, string][]) : []),
                ...(x.pageCount ? ([['Số trang', formatNumber(x.pageCount)]] as [string, string][]) : []),
                ['Trạng thái', STATUS[x.status] ?? x.status],
              ]}
            />
          </Card>
        </div>
      </div>

      {dialog?.kind === 'info' && <InfoForm item={x} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.kind === 'price' && <PriceForm v={dialog.v} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.kind === 'history' && <PriceHistory v={dialog.v} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'variant' && <VariantForm v={dialog.v} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.kind === 'labels' && <LabelsDialog item={x} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'bundle' && <BundleForm v={dialog.v} current={x.components.filter((c) => c.bundleVariantId === dialog.v.id)} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.kind === 'image-delete' && (
        <ConfirmDialog
          title="Xóa ảnh này?"
          confirm="Xóa ảnh"
          destructive
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await del(`/api/v1/catalog/items/${x.id}/images/${dialog.imageId}`);
            refresh();
          }}
        />
      )}
    </>
  );
}

function InfoForm({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    title: item.i18n.en.title,
    titleVi: item.i18n.vi?.title ?? '',
    description: item.i18n.en.description,
    descriptionVi: item.i18n.vi?.description ?? '',
    authors: item.authors.join(', '),
    status: item.status,
    releaseDate: item.releaseDate ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <ConfirmDialog
      title="Sửa thông tin sản phẩm"
      confirm="Lưu"
      onClose={onClose}
      onConfirm={async () => {
        setError(null);
        await patch(`/api/v1/catalog/items/${item.id}`, {
          version: item.version,
          i18n: { en: { title: f.title.trim(), description: f.description.trim() }, vi: { ...(f.titleVi.trim() && { title: f.titleVi.trim() }), ...(f.descriptionVi.trim() && { description: f.descriptionVi.trim() }) } },
          authors: f.authors.split(',').map((a) => a.trim()).filter(Boolean),
          status: f.status,
          releaseDate: f.releaseDate || null,
        });
        toast.success('Đã lưu sản phẩm.');
        onSaved();
      }}
    >
      <Field label="Tên tiếng Anh" required value={f.title} onChange={set('title')} />
      <Field label="Tên tiếng Việt" value={f.titleVi} onChange={set('titleVi')} />
      {item.kind === 'book' && <Field label="Tác giả (cách nhau dấu phẩy)" value={f.authors} onChange={set('authors')} />}
      <SelectField label="Trạng thái" value={f.status} onChange={set('status')}>
        {Object.entries(STATUS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </SelectField>
      <Field label="Ngày phát hành (sắp phát hành)" type="date" value={f.releaseDate} onChange={set('releaseDate')} />
      <TextArea label="Mô tả tiếng Anh" required value={f.description} onChange={set('description')} />
      <TextArea label="Mô tả tiếng Việt" value={f.descriptionVi} onChange={set('descriptionVi')} />
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </ConfirmDialog>
  );
}

function PriceForm({ v, onClose, onSaved }: { v: Variant; onClose: () => void; onSaved: () => void }) {
  const [price, setPrice] = useState(String(v.priceVnd));
  const [list, setList] = useState(v.listPriceVnd ? String(v.listPriceVnd) : '');
  const [vat, setVat] = useState(v.vatBp);
  const [reason, setReason] = useState('');
  const n = (s: string) => Number(s.replace(/\D/g, '') || 0);
  return (
    <ConfirmDialog
      title={`Đổi giá ${v.sku}`}
      body="Giá mới áp dụng ngay cho quầy và website; lịch sử giá được lưu lại."
      confirm="Lưu giá"
      onClose={onClose}
      onConfirm={async () => {
        await put(`/api/v1/catalog/variants/${v.id}/price`, { priceVnd: n(price), listPriceVnd: list ? n(list) : null, vatBp: vat, ...(reason.trim() && { reason: reason.trim() }) });
        toast.success('Đã đổi giá.');
        onSaved();
      }}
    >
      <Field label="Giá bán" required suffix="₫" inputMode="numeric" value={price ? formatNumber(n(price)) : ''} onChange={(e) => setPrice(e.target.value)} />
      <Field label="Giá bìa" suffix="₫" inputMode="numeric" value={list ? formatNumber(n(list)) : ''} onChange={(e) => setList(e.target.value)} />
      <SelectField label="Thuế VAT" value={String(vat)} onChange={(e) => setVat(Number(e.target.value))}>
        {VAT_RATES_BP.map((r) => (
          <option key={r} value={r}>
            {r / 100}%
          </option>
        ))}
      </SelectField>
      {v.avgCostVnd !== undefined && n(price) > 0 && n(price) <= v.avgCostVnd && <InlineAlert tone="warning">Giá bán không cao hơn giá vốn bình quân ({formatVnd(v.avgCostVnd)}).</InlineAlert>}
      <Field label="Lý do" value={reason} onChange={(e) => setReason(e.target.value)} />
    </ConfirmDialog>
  );
}

function PriceHistory({ v, onClose }: { v: Variant; onClose: () => void }) {
  const h = useQuery({ queryKey: ['price-history', v.id], queryFn: () => get<{ items: { id: string; priceVnd: number; vatBp: number; effectiveFrom: string; effectiveTo: string | null }[] }>(`/api/v1/catalog/variants/${v.id}/price-history`) });
  const rows = h.data?.items ?? [];
  return (
    <Dialog title={`Lịch sử giá ${v.sku}`} onClose={onClose}>
      {!h.data ? (
        <Skeleton className="h-32" />
      ) : (
        <ul className="divide-y divide-paper-300 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-3 py-2">
              <span>
                {formatDateTime(r.effectiveFrom)}
                {r.effectiveTo ? ` → ${formatDateTime(r.effectiveTo)}` : ' → nay'}
              </span>
              <span className="text-right num">
                {formatVnd(r.priceVnd)} <span className="text-ink-500">· VAT {r.vatBp / 100}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

function VariantForm({ v, onClose, onSaved }: { v: Variant; onClose: () => void; onSaved: () => void }) {
  const [weight, setWeight] = useState(String(v.weightG));
  const [minStock, setMinStock] = useState(v.minStock == null ? '' : String(v.minStock));
  const [pos, setPos] = useState(v.publishedPos);
  const [web, setWeb] = useState(v.publishedWeb);
  const [barcode, setBarcode] = useState('');
  return (
    <ConfirmDialog
      title={`Sửa ${v.sku}`}
      confirm="Lưu"
      onClose={onClose}
      onConfirm={async () => {
        await patch(`/api/v1/catalog/variants/${v.id}`, { version: v.version, weightG: Number(weight) || v.weightG, minStock: minStock === '' ? null : Number(minStock), publishedPos: pos, publishedWeb: web, ...(barcode.trim() && { addBarcodes: [barcode.trim()] }) });
        toast.success('Đã lưu.');
        onSaved();
      }}
    >
      <Field label="Khối lượng" suffix="g" inputMode="numeric" value={weight} onChange={(e) => setWeight(e.target.value.replace(/\D/g, ''))} />
      <Field label="Tồn tối thiểu" inputMode="numeric" value={minStock} onChange={(e) => setMinStock(e.target.value.replace(/\D/g, ''))} />
      <Field label="Thêm mã vạch" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={pos} onChange={(e) => setPos(e.target.checked)} /> Bán tại quầy
      </label>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={web} onChange={(e) => setWeb(e.target.checked)} /> Hiện trên website
      </label>
    </ConfirmDialog>
  );
}

function BundleForm({ v, current, onClose, onSaved }: { v: Variant; current: Item['components']; onClose: () => void; onSaved: () => void }) {
  const [lines, setLines] = useState(current.map((c) => ({ variantId: c.variantId, title: c.title, sku: c.sku, qty: c.qty })));
  return (
    <ConfirmDialog
      title={`Thành phần combo ${v.sku}`}
      body="Bán combo sẽ trừ tồn của từng sản phẩm thành phần."
      confirm="Lưu thành phần"
      onClose={onClose}
      onConfirm={async () => {
        await put(`/api/v1/catalog/variants/${v.id}/components`, { components: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) });
        toast.success('Đã lưu combo.');
        onSaved();
      }}
    >
      <ProductSearch onPick={(h) => setLines((ls) => (ls.some((l) => l.variantId === h.variantId) || h.variantId === v.id ? ls : [...ls, { variantId: h.variantId, title: hitTitle(h), sku: h.sku, qty: 1 }]))} />
      <ul className="divide-y divide-paper-300">
        {lines.map((l, i) => (
          <li key={l.variantId} className="flex items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              {l.title} <span className="code text-ink-500">{l.sku}</span>
            </span>
            <input className="h-10 w-16 rounded-md border border-paper-500 text-center num" inputMode="numeric" aria-label="Số lượng" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value.replace(/\D/g, '')) || 1 } : x)))} />
            <button type="button" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-danger-50" aria-label="Bỏ" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              <Trash2 size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}

/** Shelf, barcode and sale-price labels (FR-CAT-13, Design §16.4), printed from the browser. */
function LabelsDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const [template, setTemplate] = useState<'shelf' | 'barcode' | 'sale_price'>('barcode');
  const [sheet, setSheet] = useState<'a4' | 'roll'>('a4');
  const [copies, setCopies] = useState<Record<string, number>>(Object.fromEntries(item.variants.map((v) => [v.id, 1])));
  const [start, setStart] = useState('1');
  const [error, setError] = useState<string | null>(null);
  return (
    <ConfirmDialog
      title="In nhãn"
      confirm="In"
      onClose={onClose}
      onConfirm={async () => {
        setError(null);
        const res = await fetch('/api/v1/catalog/labels', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-bms-request': '1' },
          body: JSON.stringify({ template, sheet, startPosition: Number(start) || 1, items: item.variants.filter((v) => (copies[v.id] ?? 0) > 0).map((v) => ({ variantId: v.id, copies: copies[v.id] })) }),
        });
        if (!res.ok) {
          const e = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
          throw new Error(e?.error?.message ?? 'Không tạo được nhãn.');
        }
        printHtml(await res.text());
      }}
    >
      <SelectField label="Mẫu nhãn" value={template} onChange={(e) => setTemplate(e.target.value as 'shelf')}>
        <option value="barcode">Nhãn mã vạch</option>
        <option value="shelf">Nhãn kệ</option>
        <option value="sale_price">Nhãn giá khuyến mãi</option>
      </SelectField>
      <SelectField label="Khổ giấy" value={sheet} onChange={(e) => setSheet(e.target.value as 'a4')}>
        <option value="a4">Giấy A4 (tờ nhãn)</option>
        <option value="roll">Cuộn nhãn</option>
      </SelectField>
      {sheet === 'a4' && <Field label="Bắt đầu từ ô số" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} helper="Dùng tiếp tờ nhãn đã in dở." />}
      {item.variants.map((v) => (
        <Field key={v.id} label={`Số nhãn ${v.sku}`} inputMode="numeric" value={String(copies[v.id] ?? 0)} onChange={(e) => setCopies({ ...copies, [v.id]: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
      ))}
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
    </ConfirmDialog>
  );
}
