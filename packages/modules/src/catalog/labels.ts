import { schema } from '@bookstore/db';
import { barcodeSvg, escapeXml, formatVnd, isEan13 } from '@bookstore/domain';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AppError, requirePermission, type Ctx } from '../platform/index.js';

/**
 * Shelf/price labels and barcode stickers as print-optimised HTML (FR-CAT-13, TDD §4.1,
 * Design §16.4): black on white, tabular figures, a start position for partly used A4 sheets.
 */

interface Layout {
  pageW: number;
  pageH: number;
  cols: number;
  rows: number;
  labelW: number;
  labelH: number;
}

const LAYOUTS: Record<string, Layout> = {
  // 4 × 10 = 40-up on A4 (52.5 × 29.7 mm cells for 50 × 30 labels)
  'shelf:a4': { pageW: 210, pageH: 297, cols: 4, rows: 10, labelW: 52.5, labelH: 29.7 },
  'shelf:roll': { pageW: 50, pageH: 30, cols: 1, rows: 1, labelW: 50, labelH: 30 },
  // 5 × 13 = 65-up on A4 (38.1 × 21.2 mm)
  'barcode:a4': { pageW: 210, pageH: 297, cols: 5, rows: 13, labelW: 38.1, labelH: 21.2 },
  'barcode:roll': { pageW: 40, pageH: 25, cols: 1, rows: 1, labelW: 40, labelH: 25 },
  'sale_price:roll': { pageW: 30, pageH: 20, cols: 1, rows: 1, labelW: 30, labelH: 20 },
  'sale_price:a4': { pageW: 210, pageH: 297, cols: 7, rows: 14, labelW: 30, labelH: 20 },
};

export const LabelSchema = z.object({
  template: z.enum(['shelf', 'barcode', 'sale_price']),
  sheet: z.enum(['a4', 'roll']).default('a4'),
  items: z.array(z.object({ variantId: z.uuid(), copies: z.number().int().min(1).max(500).default(1) })).min(1).max(500),
  /** 1-based cell to start at on the first A4 sheet. */
  startPosition: z.number().int().min(1).default(1),
});

interface LabelData {
  sku: string;
  title: string;
  author: string;
  priceVnd: number;
  oldPriceVnd: number | null;
  code: string;
}

function cell(t: z.infer<typeof LabelSchema>['template'], d: LabelData, l: Layout): string {
  const price = escapeXml(formatVnd(d.priceVnd));
  if (t === 'sale_price') {
    return `<div class="sale"><s>${d.oldPriceVnd ? escapeXml(formatVnd(d.oldPriceVnd)) : ''}</s><b>${price}</b></div>`;
  }
  if (t === 'barcode') {
    return `<div class="bc">${barcodeSvg(d.code, { moduleMm: 0.26, heightMm: 9 })}<div class="nm">${escapeXml(d.title)}</div><div class="pr">${price}</div></div>`;
  }
  return `<div class="shelf"><div class="ti">${escapeXml(d.title)}</div><div class="au">${escapeXml(d.author)}</div><div class="row"><div class="pr">${price}</div>${barcodeSvg(d.code, { moduleMm: Math.min(0.3, 22 / 95), heightMm: Math.min(10, l.labelH - 18) })}</div><div class="sku">${escapeXml(d.sku)}</div></div>`;
}

export async function labels(ctx: Ctx, input: z.input<typeof LabelSchema>): Promise<string> {
  requirePermission(ctx, 'catalog.view');
  const data = LabelSchema.parse(input);
  const layout = LAYOUTS[`${data.template}:${data.sheet}`];
  if (!layout) throw new AppError(400, 'invalid_layout', 'Mẫu nhãn không hỗ trợ khổ giấy này.');
  const ids = [...new Set(data.items.map((i) => i.variantId))];
  const rows = await ctx.db
    .select({ id: schema.itemVariant.id, sku: schema.itemVariant.sku, price: schema.itemVariant.priceVnd, list: schema.itemVariant.listPriceVnd, i18n: schema.item.i18n, authors: schema.item.authors })
    .from(schema.itemVariant)
    .innerJoin(schema.item, eq(schema.item.id, schema.itemVariant.itemId))
    .where(inArray(schema.itemVariant.id, ids));
  const codes = await ctx.db.select().from(schema.barcode).where(inArray(schema.barcode.variantId, ids));
  const byId = new Map(
    rows.map((r) => {
      const own = codes.filter((c) => c.variantId === r.id);
      // Prefer a scannable EAN-13 (ISBN or internal), then any barcode, then the SKU (Code 128).
      const code = own.find((c) => isEan13(c.code))?.code ?? own[0]?.code ?? r.sku;
      const d: LabelData = {
        sku: r.sku,
        title: r.i18n.vi?.title || r.i18n.en.title,
        author: r.authors.join(', '),
        priceVnd: r.price,
        oldPriceVnd: r.list != null && r.list > r.price ? r.list : null,
        code,
      };
      return [r.id, d] as const;
    }),
  );
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new AppError(404, 'not_found', 'Có sản phẩm không tồn tại.', { missing });

  const cells: string[] = [];
  if (data.sheet === 'a4') for (let i = 1; i < data.startPosition; i++) cells.push('');
  for (const it of data.items) for (let c = 0; c < it.copies; c++) cells.push(cell(data.template, byId.get(it.variantId)!, layout));
  const perPage = layout.cols * layout.rows;
  const pages: string[] = [];
  for (let i = 0; i < cells.length; i += perPage) {
    pages.push(`<section class="page">${cells.slice(i, i + perPage).map((c) => `<div class="cell">${c}</div>`).join('')}</section>`);
  }
  const marginX = Math.max(0, (layout.pageW - layout.cols * layout.labelW) / 2);
  const marginY = Math.max(0, (layout.pageH - layout.rows * layout.labelH) / 2);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Nhãn ${data.template}</title><style>
@page { size: ${layout.pageW}mm ${layout.pageH}mm; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Be Vietnam Pro", Arial, sans-serif; color: #000; background: #fff; font-variant-numeric: tabular-nums; }
.page { width: ${layout.pageW}mm; height: ${layout.pageH}mm; padding: ${marginY}mm ${marginX}mm; display: grid;
  grid-template-columns: repeat(${layout.cols}, ${layout.labelW}mm); grid-auto-rows: ${layout.labelH}mm; page-break-after: always; }
.cell { overflow: hidden; padding: 1.5mm; }
.shelf .ti { font-size: 9pt; font-weight: 600; line-height: 1.15; max-height: 2.3em; overflow: hidden; }
.shelf .au { font-size: 7pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.shelf .row { display: flex; justify-content: space-between; align-items: flex-end; }
.shelf .pr { font-size: 16pt; font-weight: 700; }
.shelf .sku, .bc .nm { font-size: 6pt; font-weight: 500; }
.bc { text-align: center; } .bc .pr { font-size: 9pt; font-weight: 700; }
.sale { text-align: center; } .sale s { display: block; font-size: 7pt; } .sale b { font-size: 14pt; }
</style></head><body>${pages.join('')}</body></html>`;
}
