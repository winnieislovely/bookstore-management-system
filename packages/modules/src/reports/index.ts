import { schema } from '@bookstore/db';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import { AppError, can, errors, randomToken, requirePermission, sha256, tsParam, type Ctx } from '../platform/index.js';
import { writeTable } from '../imports/index.js';

/**
 * Reports (FR-RPT-01..05, FR-RPT-10, TDD §4.11): read models with a mandatory date range in store
 * time, capped at 366 days. Every report returns the same table shape, so one exporter serves all.
 * Margin and cost columns appear only with `report.profit`.
 */

const TZ = 'Asia/Ho_Chi_Minh';
const OFFSET_MS = 7 * 3600_000;
const MAX_DAYS = 366;

export type ColumnType = 'text' | 'vnd' | 'int' | 'date' | 'datetime' | 'percent';
export interface Column {
  key: string;
  label: string;
  type: ColumnType;
}
export interface Table {
  title: string;
  from: string | null;
  to: string | null;
  columns: Column[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
}

export const RangeSchema = z.object({ from: z.iso.date(), to: z.iso.date() });

/** `YYYY-MM-DD` dates in store time (inclusive) → UTC [start, end). */
export function storeRange(from: string, to: string): { start: Date; end: Date } {
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - OFFSET_MS);
  const end = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000 - OFFSET_MS);
  if (!(end > start)) throw new AppError(400, 'invalid_range', 'Ngày kết thúc phải sau ngày bắt đầu.');
  if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_DAYS) {
    throw new AppError(400, 'range_too_long', `Khoảng thời gian tối đa ${MAX_DAYS} ngày.`);
  }
  return { start, end };
}

function storeDate(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function sumRows(rows: Record<string, unknown>[], keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + n(r[k]), 0)]));
}

// =============================================================================================
// Dashboard (FR-RPT-01): no alert tiles; those are notifications and badges (FR-ADM-08)

async function salesTotals(ctx: Ctx, start: Date, end: Date) {
  const [r] = await ctx.db.execute<{ gross: string; orders: number; returns: string }>(sql`
    select
      coalesce((select sum(total_vnd) from reports.sale_doc where sold_at >= ${tsParam(start)} and sold_at < ${tsParam(end)}), 0) as gross,
      (select count(*)::int from reports.sale_doc where sold_at >= ${tsParam(start)} and sold_at < ${tsParam(end)}) as orders,
      coalesce((select sum(refund_vnd) from reports.return_line where returned_at >= ${tsParam(start)} and returned_at < ${tsParam(end)}), 0) as returns`);
  const gross = n(r!.gross);
  const orders = r!.orders;
  const returns = n(r!.returns);
  return { grossVnd: gross, returnsVnd: returns, netVnd: gross - returns, orders, averageBasketVnd: orders ? Math.round(gross / orders) : 0 };
}

export async function dashboard(ctx: Ctx) {
  const actor = requirePermission(ctx, 'report.view');
  const now = ctx.clock.now();
  const today = storeDate(now);
  const day = storeRange(today, today);
  const dayT = await salesTotals(ctx, day.start, day.end);
  // The trend and by-channel charts read the sales report for the user's range (TDD §4.11).
  const month = storeRange(`${today.slice(0, 8)}01`, today);
  const bestsellers = await ctx.db.execute<{ variant_id: string; sku: string; title: string; units: number; gross: string }>(sql`
    select l.variant_id, v.sku, i.i18n -> 'en' ->> 'title' as title, sum(l.qty)::int as units, sum(l.total_vnd) as gross
    from reports.sale_line l
    join catalog.item_variant v on v.id = l.variant_id join catalog.item i on i.id = v.item_id
    where l.sold_at >= ${tsParam(month.start)} and l.sold_at < ${tsParam(month.end)}
    group by l.variant_id, v.sku, i.id order by units desc, gross desc limit 10`);
  const lowStock = can(actor, 'inventory.view')
    ? await ctx.db.execute<{ variant_id: string; sku: string; title: string; available: number; min_stock: number }>(sql`
        select v.id as variant_id, v.sku, i.i18n -> 'en' ->> 'title' as title,
               coalesce(sum(s.on_hand - s.reserved), 0)::int as available, v.min_stock
        from catalog.item_variant v join catalog.item i on i.id = v.item_id
        left join inventory.stock_level s on s.variant_id = v.id
        where v.min_stock is not null and v.status = 'active'
        group by v.id, i.id having coalesce(sum(s.on_hand - s.reserved), 0) <= v.min_stock
        order by available limit 10`)
    : null;
  return {
    today: dayT,
    bestsellers: bestsellers.map((b) => ({ variantId: b.variant_id, sku: b.sku, title: b.title, units: b.units, grossVnd: n(b.gross) })),
    ...(lowStock && { lowStock: lowStock.map((l) => ({ variantId: l.variant_id, sku: l.sku, title: l.title, available: l.available, minStock: l.min_stock })) }),
    // Events (R3) and library (R4) lists join the dashboard in their releases.
    upcomingEvents: [],
    overdueLoans: [],
  };
}

// =============================================================================================
// Sales (FR-RPT-02)

export const SalesReportSchema = RangeSchema.extend({
  groupBy: z.enum(['day', 'month', 'channel', 'item', 'customer']).default('day'),
});

const SALES_GROUPS = {
  day: { label: 'Ngày', key: sql`to_char(l.sold_at at time zone ${TZ}, 'YYYY-MM-DD')`, rkey: sql`to_char(r.returned_at at time zone ${TZ}, 'YYYY-MM-DD')` },
  month: { label: 'Tháng', key: sql`to_char(l.sold_at at time zone ${TZ}, 'YYYY-MM')`, rkey: sql`to_char(r.returned_at at time zone ${TZ}, 'YYYY-MM')` },
  // Counter sales and online orders by source (FR-SOC-02, BR-29).
  channel: { label: 'Kênh', key: sql`l.channel`, rkey: sql`r.channel` },
  customer: {
    label: 'Khách hàng',
    key: sql`coalesce((select c.name from crm.customer c where c.id = l.customer_id), 'Khách lẻ')`,
    rkey: sql`coalesce((select c.name from crm.customer c where c.id = r.customer_id), 'Khách lẻ')`,
  },
} as const;

export async function sales(ctx: Ctx, input: z.input<typeof SalesReportSchema>): Promise<Table> {
  const actor = requirePermission(ctx, 'report.view');
  const q = SalesReportSchema.parse(input);
  const { start, end } = storeRange(q.from, q.to);
  const profit = can(actor, 'report.profit');
  const inRange = sql`l.sold_at >= ${tsParam(start)} and l.sold_at < ${tsParam(end)}`;
  const returnsInRange = sql`r.returned_at >= ${tsParam(start)} and r.returned_at < ${tsParam(end)}`;
  // Line-level for items; sale-level keys otherwise. Returns are attributed by return date.
  // Items key on SKU; the name is looked up after the join so SKU and name stay separate columns.
  const lineKey: SQL = q.groupBy === 'item' ? sql`v.sku` : SALES_GROUPS[q.groupBy].key;
  const returnKey: SQL = q.groupBy === 'item' ? lineKey : SALES_GROUPS[q.groupBy].rkey;
  const res = await ctx.db.execute<{ key: string; title: string | null; orders: number; units: number; gross: string; discount: string; vat: string; cost: string; returns: string }>(sql`
    with sold as (
      select ${lineKey} as key, count(distinct l.doc_id)::int as orders, sum(l.qty)::int as units, sum(l.total_vnd) as gross,
             sum(l.discount_vnd) as discount, sum(l.vat_vnd) as vat, sum(l.cost_vnd) as cost
      from reports.sale_line l
      left join catalog.item_variant v on v.id = l.variant_id left join catalog.item i on i.id = v.item_id
      where ${inRange} group by 1),
    ret as (
      select ${returnKey} as key, sum(r.refund_vnd) as returns
      from reports.return_line r
      left join catalog.item_variant v on v.id = r.variant_id left join catalog.item i on i.id = v.item_id
      where ${returnsInRange} group by 1)
    select coalesce(sold.key, ret.key) as key,
           ${q.groupBy === 'item' ? sql`(select i2.i18n -> 'en' ->> 'title' from catalog.item_variant v2 join catalog.item i2 on i2.id = v2.item_id where v2.sku = coalesce(sold.key, ret.key))` : sql`null`} as title,
           coalesce(sold.orders, 0) as orders, coalesce(sold.units, 0) as units,
           coalesce(sold.gross, 0) as gross, coalesce(sold.discount, 0) as discount, coalesce(sold.vat, 0) as vat,
           coalesce(sold.cost, 0) as cost, coalesce(ret.returns, 0) as returns
    from sold full join ret on ret.key = sold.key
    order by ${q.groupBy === 'day' || q.groupBy === 'month' ? sql`1` : sql`gross desc`}`);
  const rows = res.map((r) => {
    const gross = n(r.gross);
    const row: Record<string, unknown> = {
      key: r.key,
      ...(q.groupBy === 'item' && { title: r.title }),
      orders: r.orders,
      units: r.units,
      grossVnd: gross,
      discountVnd: n(r.discount),
      vatVnd: n(r.vat),
      returnsVnd: n(r.returns),
      netVnd: gross - n(r.returns),
    };
    if (profit) {
      row.costVnd = n(r.cost);
      row.marginVnd = gross - n(r.vat) - n(r.cost);
    }
    return row;
  });
  const sumKeys = ['units', 'grossVnd', 'discountVnd', 'vatVnd', 'returnsVnd', 'netVnd', ...(profit ? ['costVnd', 'marginVnd'] : [])];
  const totals = sumRows(rows, sumKeys);
  // Orders are distinct sales; summing per-line groups would double count, so total them directly.
  const [ord] = await ctx.db.execute<{ orders: number }>(sql`select count(*)::int as orders from reports.sale_doc l where ${inRange}`);
  totals.orders = ord!.orders;
  const label = q.groupBy === 'item' ? 'Sản phẩm' : SALES_GROUPS[q.groupBy].label;
  return {
    title: `Doanh thu theo ${label.toLowerCase()}`,
    from: q.from,
    to: q.to,
    columns: [
      ...(q.groupBy === 'item'
        ? [
            { key: 'key', label: 'SKU', type: 'text' as const },
            { key: 'title', label: 'Tên sản phẩm', type: 'text' as const },
          ]
        : [{ key: 'key', label, type: q.groupBy === 'day' ? ('date' as const) : ('text' as const) }]),
      { key: 'orders', label: 'Số đơn', type: 'int' },
      { key: 'units', label: 'Số lượng', type: 'int' },
      { key: 'grossVnd', label: 'Doanh thu', type: 'vnd' },
      { key: 'discountVnd', label: 'Giảm giá', type: 'vnd' },
      { key: 'vatVnd', label: 'Thuế VAT', type: 'vnd' },
      { key: 'returnsVnd', label: 'Trả hàng', type: 'vnd' },
      { key: 'netVnd', label: 'Doanh thu thuần', type: 'vnd' },
      ...(profit
        ? [
            { key: 'costVnd', label: 'Giá vốn', type: 'vnd' as const },
            { key: 'marginVnd', label: 'Lãi gộp', type: 'vnd' as const },
          ]
        : []),
    ],
    rows,
    totals,
  };
}

// =============================================================================================
// Inventory (FR-RPT-03, FR-INV-08, FR-INV-10)

export const InventoryReportSchema = z.object({
  view: z.enum(['stock', 'movements']),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** Vietnamese movement types, as on the stock screen; the report and its Excel export show these. */
const MOVEMENT_LABEL: Record<string, string> = {
  stock_in: 'Nhập hàng',
  sale: 'Bán hàng',
  customer_return: 'Khách trả',
  consignment_receipt: 'Nhận ký gửi',
  consignment_return: 'Trả ký gửi',
  adjustment: 'Điều chỉnh',
  count: 'Kiểm kho',
  write_off: 'Hủy hàng',
  bundle_use: 'Xuất cho combo',
  library_transfer: 'Chuyển thư viện',
};

export async function inventory(ctx: Ctx, input: z.input<typeof InventoryReportSchema>): Promise<Table> {
  const actor = requirePermission(ctx, 'report.view');
  const q = InventoryReportSchema.parse(input);
  const cost = can(actor, 'catalog.view_cost');
  const needRange = q.view === 'movements';
  if (needRange && (!q.from || !q.to)) throw new AppError(400, 'range_required', 'Cần chọn khoảng thời gian.');
  const range = needRange ? storeRange(q.from!, q.to!) : null;

  if (q.view === 'stock') {
    const res = await ctx.db.execute<{ sku: string; title: string; on_hand: number; reserved: number; avg: string; value: string }>(sql`
      select v.sku, i.i18n -> 'en' ->> 'title' as title, coalesce(sum(s.on_hand), 0)::int as on_hand, coalesce(sum(s.reserved), 0)::int as reserved,
             coalesce(max(s.avg_cost_vnd), 0) as avg, coalesce(sum(greatest(s.on_hand, 0) * s.avg_cost_vnd), 0) as value
      from catalog.item_variant v join catalog.item i on i.id = v.item_id left join inventory.stock_level s on s.variant_id = v.id
      where v.status <> 'discontinued' group by v.id, i.id order by v.sku`);
    const rows = res.map((r) => ({
      sku: r.sku,
      title: r.title,
      onHand: r.on_hand,
      reserved: r.reserved,
      available: r.on_hand - r.reserved,
      ...(cost && { avgCostVnd: n(r.avg), valueVnd: n(r.value) }),
    }));
    return {
      title: 'Tồn kho và giá trị tồn',
      from: null,
      to: null,
      columns: [
        { key: 'sku', label: 'SKU', type: 'text' },
        { key: 'title', label: 'Tên sản phẩm', type: 'text' },
        { key: 'onHand', label: 'Tồn', type: 'int' },
        { key: 'reserved', label: 'Đang giữ', type: 'int' },
        { key: 'available', label: 'Có thể bán', type: 'int' },
        ...(cost
          ? [
              { key: 'avgCostVnd', label: 'Giá vốn BQ', type: 'vnd' as const },
              { key: 'valueVnd', label: 'Giá trị tồn', type: 'vnd' as const },
            ]
          : []),
      ],
      rows,
      totals: sumRows(rows, ['onHand', 'reserved', 'available', ...(cost ? ['valueVnd'] : [])]),
    };
  }

  if (q.view === 'movements') {
    const res = await ctx.db.execute<{ type: string; qty_in: number; qty_out: number; lines: number }>(sql`
      select type, coalesce(sum(qty_delta) filter (where qty_delta > 0), 0)::int as qty_in,
             coalesce(-sum(qty_delta) filter (where qty_delta < 0), 0)::int as qty_out, count(*)::int as lines
      from inventory.stock_movement where at >= ${tsParam(range!.start)} and at < ${tsParam(range!.end)} group by type order by type`);
    const rows = res.map((r) => ({ type: MOVEMENT_LABEL[r.type] ?? r.type, lines: r.lines, qtyIn: r.qty_in, qtyOut: r.qty_out }));
    return {
      title: 'Xuất nhập tồn theo loại phát sinh',
      from: q.from!,
      to: q.to!,
      columns: [
        { key: 'type', label: 'Loại', type: 'text' },
        { key: 'lines', label: 'Số dòng', type: 'int' },
        { key: 'qtyIn', label: 'Nhập', type: 'int' },
        { key: 'qtyOut', label: 'Xuất', type: 'int' },
      ],
      rows,
      totals: sumRows(rows, ['lines', 'qtyIn', 'qtyOut']),
    };
  }

  throw new AppError(400, 'unknown_view', 'Báo cáo không tồn tại.');
}

// =============================================================================================
// Tax and audit (FR-RPT-04)

/** Vietnamese e-invoice states, as on the sales screen; the register and its Excel export show these. */
const EINVOICE_LABEL: Record<string, string> = { pending: 'Chờ xuất', sent: 'Đã gửi', issued: 'Đã xuất', failed: 'Lỗi', cancelled: 'Đã hủy', adjusted: 'Điều chỉnh' };

export const TaxReportSchema = RangeSchema.extend({ view: z.enum(['vat', 'einvoices', 'shifts']) });

export async function tax(ctx: Ctx, input: z.input<typeof TaxReportSchema>): Promise<Table> {
  requirePermission(ctx, 'report.view');
  const q = TaxReportSchema.parse(input);
  const { start, end } = storeRange(q.from, q.to);

  if (q.view === 'vat') {
    // Output VAT by rate; returns reduce it by the VAT contained in the refund.
    const res = await ctx.db.execute<{ vat_bp: number; gross: string; vat: string; ret_gross: string; ret_vat: string }>(sql`
      with sold as (select l.vat_bp, sum(l.total_vnd) as gross, sum(l.vat_vnd) as vat
                    from reports.sale_line l
                    where l.sold_at >= ${tsParam(start)} and l.sold_at < ${tsParam(end)} group by l.vat_bp),
           ret as (select r.vat_bp, sum(r.refund_vnd) as gross, sum(round(r.refund_vnd::numeric * r.vat_bp / (10000 + r.vat_bp))) as vat
                   from reports.return_line r
                   where r.returned_at >= ${tsParam(start)} and r.returned_at < ${tsParam(end)} group by r.vat_bp)
      select coalesce(sold.vat_bp, ret.vat_bp) as vat_bp, coalesce(sold.gross, 0) as gross, coalesce(sold.vat, 0) as vat,
             coalesce(ret.gross, 0) as ret_gross, coalesce(ret.vat, 0) as ret_vat
      from sold full join ret on ret.vat_bp = sold.vat_bp order by 1`);
    const rows = res.map((r) => {
      const gross = n(r.gross) - n(r.ret_gross);
      const vat = n(r.vat) - n(r.ret_vat);
      return { vatBp: r.vat_bp, revenueVnd: gross, netOfVatVnd: gross - vat, vatVnd: vat };
    });
    return {
      title: 'Thuế GTGT đầu ra theo thuế suất',
      from: q.from,
      to: q.to,
      columns: [
        { key: 'vatBp', label: 'Thuế suất', type: 'percent' },
        { key: 'revenueVnd', label: 'Doanh thu (gồm VAT)', type: 'vnd' },
        { key: 'netOfVatVnd', label: 'Doanh thu chưa VAT', type: 'vnd' },
        { key: 'vatVnd', label: 'Thuế GTGT', type: 'vnd' },
      ],
      rows,
      totals: sumRows(rows, ['revenueVnd', 'netOfVatVnd', 'vatVnd']),
    };
  }

  if (q.view === 'einvoices') {
    const res = await ctx.db.execute<{ doc_no: string; sold_at: Date; total: string; vat: string; status: string; invoice_no: string | null; buyer: { name?: string; taxCode?: string } | null }>(sql`
      select s.doc_no, s.sold_at, s.total_vnd as total, s.vat_vnd as vat, j.status, j.invoice_no, j.buyer
      from sales.einvoice_job j
      join (select id, doc_no, sold_at, total_vnd, vat_vnd from sales.sale
            union all select id, doc_no, done_at, total_vnd, vat_vnd from orders.web_order where done_at is not null) s on s.id = coalesce(j.sale_id, j.order_id)
      where s.sold_at >= ${tsParam(start)} and s.sold_at < ${tsParam(end)} order by s.sold_at`);
    const rows = res.map((r) => ({
      docNo: r.doc_no,
      soldAt: r.sold_at,
      invoiceNo: r.invoice_no,
      status: EINVOICE_LABEL[r.status] ?? r.status,
      buyer: r.buyer?.name ?? 'Khách lẻ',
      buyerTaxCode: r.buyer?.taxCode ?? null,
      totalVnd: n(r.total),
      vatVnd: n(r.vat),
    }));
    return {
      title: 'Bảng kê hóa đơn điện tử',
      from: q.from,
      to: q.to,
      columns: [
        { key: 'docNo', label: 'Mã đơn', type: 'text' },
        { key: 'soldAt', label: 'Thời gian', type: 'datetime' },
        { key: 'invoiceNo', label: 'Số hóa đơn', type: 'text' },
        { key: 'status', label: 'Trạng thái', type: 'text' },
        { key: 'buyer', label: 'Người mua', type: 'text' },
        { key: 'buyerTaxCode', label: 'MST người mua', type: 'text' },
        { key: 'totalVnd', label: 'Tổng tiền', type: 'vnd' },
        { key: 'vatVnd', label: 'Thuế GTGT', type: 'vnd' },
      ],
      rows,
      totals: sumRows(rows, ['totalVnd', 'vatVnd']),
    };
  }

  const res = await ctx.db.execute<{ shift_no: number; register: string; cashier: string; opened_at: Date; closed_at: Date | null; float: string; expected: string | null; counted: string | null; variance: string | null; reason: string | null }>(sql`
    select s.shift_no, r.code as register, u.display_name as cashier, s.opened_at, s.closed_at, s.float_vnd as float,
           s.expected_vnd as expected, s.counted_vnd as counted, s.variance_vnd as variance, s.variance_reason as reason
    from sales.shift s join sales.register r on r.id = s.register_id join platform.app_user u on u.id = s.opened_by
    where s.opened_at >= ${tsParam(start)} and s.opened_at < ${tsParam(end)} order by s.opened_at`);
  const rows = res.map((r) => ({
    shiftNo: r.shift_no,
    register: r.register,
    cashier: r.cashier,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    floatVnd: n(r.float),
    expectedVnd: r.expected === null ? null : n(r.expected),
    countedVnd: r.counted === null ? null : n(r.counted),
    varianceVnd: r.variance === null ? null : n(r.variance),
    varianceReason: r.reason,
  }));
  return {
    title: 'Đối soát tiền mặt theo ca',
    from: q.from,
    to: q.to,
    columns: [
      { key: 'shiftNo', label: 'Ca', type: 'int' },
      { key: 'register', label: 'Quầy', type: 'text' },
      { key: 'cashier', label: 'Thu ngân', type: 'text' },
      { key: 'openedAt', label: 'Mở ca', type: 'datetime' },
      { key: 'closedAt', label: 'Đóng ca', type: 'datetime' },
      { key: 'floatVnd', label: 'Tiền đầu ca', type: 'vnd' },
      { key: 'expectedVnd', label: 'Dự kiến', type: 'vnd' },
      { key: 'countedVnd', label: 'Thực đếm', type: 'vnd' },
      { key: 'varianceVnd', label: 'Chênh lệch', type: 'vnd' },
      { key: 'varianceReason', label: 'Lý do', type: 'text' },
    ],
    rows,
    totals: sumRows(rows, ['varianceVnd']),
  };
}

// =============================================================================================
// Purchasing (FR-RPT-05)

export const PurchasingReportSchema = z.object({
  view: z.enum(['stock_ins']),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export async function purchasingReport(ctx: Ctx, input: z.input<typeof PurchasingReportSchema>): Promise<Table> {
  const actor = requirePermission(ctx, 'report.view');
  const q = PurchasingReportSchema.parse(input);

  if (!q.from || !q.to) throw new AppError(400, 'range_required', 'Cần chọn khoảng thời gian.');
  const { start, end } = storeRange(q.from, q.to);
  const res = await ctx.db.execute<{ supplier: string; entries: number; units: number; cost: string }>(sql`
    select coalesce(s.name, '(Không ghi nhà cung cấp)') as supplier, count(distinct e.id)::int as entries, sum(l.qty)::int as units, sum(l.qty * l.unit_cost_vnd) as cost
    from purchasing.stock_in_entry e join purchasing.stock_in_line l on l.entry_id = e.id left join purchasing.supplier s on s.id = e.supplier_id
    where e.created_at >= ${tsParam(start)} and e.created_at < ${tsParam(end)} group by s.name order by cost desc`);
  const showCost = can(actor, 'catalog.view_cost');
  const rows = res.map((r) => ({ supplier: r.supplier, entries: r.entries, units: r.units, ...(showCost && { costVnd: n(r.cost) }) }));
  return {
    title: 'Nhập hàng theo nhà cung cấp',
    from: q.from,
    to: q.to,
    columns: [
      { key: 'supplier', label: 'Nhà cung cấp', type: 'text' },
      { key: 'entries', label: 'Số phiếu', type: 'int' },
      { key: 'units', label: 'Số lượng', type: 'int' },
      ...(showCost ? [{ key: 'costVnd', label: 'Tổng giá nhập', type: 'vnd' as const }] : []),
    ],
    rows,
    totals: sumRows(rows, ['entries', 'units', ...(showCost ? ['costVnd'] : [])]),
  };
}

// =============================================================================================
// Export through a download token (FR-RPT-10, TDD §4.11)

export const REPORTS = {
  sales: { run: sales, schema: SalesReportSchema },
  inventory: { run: inventory, schema: InventoryReportSchema },
  tax: { run: tax, schema: TaxReportSchema },
  purchasing: { run: purchasingReport, schema: PurchasingReportSchema },
} as const;
export type ReportName = keyof typeof REPORTS;

// Excel only (FR-RPT-10): no CSV export for reports.
export const ExportSchema = z.object({ format: z.enum(['xlsx']).default('xlsx'), params: z.record(z.string(), z.unknown()).default({}) });

export async function createExport(ctx: Ctx, report: ReportName, input: z.input<typeof ExportSchema>) {
  const actor = requirePermission(ctx, 'report.export');
  const data = ExportSchema.parse(input);
  // Validate now, so a bad request fails here rather than at download.
  REPORTS[report].schema.parse(data.params);
  const token = randomToken();
  const expiresAt = new Date(ctx.clock.now().getTime() + 10 * 60_000);
  await ctx.db.insert(schema.downloadToken).values({ tokenHash: sha256(token), userId: actor.userId, report, params: data.params, format: data.format, expiresAt, createdAt: ctx.clock.now() });
  return { token, expiresAt, url: `/api/v1/reports/download/${token}` };
}

function formatCell(v: unknown, type: ColumnType): string | number | null {
  if (v === null || v === undefined) return null;
  if (type === 'percent') return Number(v) / 100;
  if (type === 'datetime' && (v instanceof Date || typeof v === 'string')) {
    const d = new Date(v);
    return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
  }
  return typeof v === 'number' ? v : String(v);
}

/** Redeem a token once: runs the report as its creator and returns the file; audit-logged. */
export async function download(ctx: Ctx, token: string): Promise<{ bytes: Uint8Array; mime: string; filename: string }> {
  const now = ctx.clock.now();
  const [row] = await ctx.db
    .update(schema.downloadToken)
    .set({ usedAt: now })
    .where(sql`${schema.downloadToken.tokenHash} = ${sha256(token)} and ${schema.downloadToken.usedAt} is null and ${schema.downloadToken.expiresAt} > ${tsParam(now)}`)
    .returning();
  if (!row) throw new AppError(404, 'download_expired', 'Liên kết tải đã hết hạn hoặc đã dùng. Hãy xuất lại báo cáo.');
  if (!ctx.actor || ctx.actor.userId !== row.userId) throw errors.forbidden();
  const name = row.report as ReportName;
  const table = await REPORTS[name].run(ctx, row.params as never);
  await audit.record(ctx.db, ctx, { action: 'report.export', entity: 'report', entityId: name, after: { params: row.params, format: row.format, rows: table.rows.length } });
  const base = `bao-cao-${name}-${table.from ?? storeDate(now)}${table.to ? `_${table.to}` : ''}`;
  const header = table.columns.map((c) => c.label);
  const body = table.rows.map((r) => table.columns.map((c) => formatCell(r[c.key], c.type)));
  if (table.totals) body.push(table.columns.map((c, i) => (i === 0 ? 'Tổng cộng' : formatCell(table.totals![c.key], c.type))));
  const filter = `${table.title}${table.from ? ` · Từ ${table.from} đến ${table.to}` : ''}`;
  return { bytes: await writeTable(table.title.slice(0, 31), header, body, filter), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${base}.xlsx` };
}

// =============================================================================================
// Menu count badges (FR-ADM-08, TDD §4.12)

/** Per-menu counts, each only with the matching permission. */
export async function badges(ctx: Ctx) {
  if (!ctx.actor) throw errors.unauthenticated();
  const out: Record<string, number> = {};
  if (can(ctx.actor, 'einvoice.manage')) {
    const [r] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from sales.einvoice_job where status = 'failed'`);
    out.einvoicesFailed = r!.n;
  }
  // Orders needing action on “Giao hàng” (Design §12.9, FR-ORD-05).
  if (can(ctx.actor, 'online.manage')) {
    const [r] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from orders.web_order where status in ('new', 'pending_review', 'return_requested')`);
    out.ordersNeedingAction = r!.n;
  }
  // Pre-orders past the holding period, on the POS “Đặt trước” button (FR-ORD-16).
  if (can(ctx.actor, 'sale.create')) {
    const [h] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from orders.preorder where status = 'contacted' and expires_at < ${tsParam(ctx.clock.now())}`);
    out.holdsOverdue = h!.n;
  }
  return out;
}
