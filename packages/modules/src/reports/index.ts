import { schema } from '@bookstore/db';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as purchasing from '../purchasing/index.js';
import { AppError, can, errors, randomToken, requirePermission, sha256, tsParam, type Ctx } from '../platform/index.js';
import { writeTable } from '../imports/parse.js';

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
      coalesce((select sum(total_vnd) from sales.sale where status = 'completed' and sold_at >= ${tsParam(start)} and sold_at < ${tsParam(end)}), 0) as gross,
      (select count(*)::int from sales.sale where status = 'completed' and sold_at >= ${tsParam(start)} and sold_at < ${tsParam(end)}) as orders,
      coalesce((select sum(refund_vnd) from sales.sale_return where created_at >= ${tsParam(start)} and created_at < ${tsParam(end)}), 0) as returns`);
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
    from sales.sale_line l join sales.sale s on s.id = l.sale_id
    join catalog.item_variant v on v.id = l.variant_id join catalog.item i on i.id = v.item_id
    where s.status = 'completed' and s.sold_at >= ${tsParam(month.start)} and s.sold_at < ${tsParam(month.end)}
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
  groupBy: z.enum(['day', 'month', 'channel', 'category', 'item', 'cashier', 'payment', 'customer']).default('day'),
});

const SALES_GROUPS = {
  day: { label: 'Ngày', key: sql`to_char(s.sold_at at time zone ${TZ}, 'YYYY-MM-DD')`, rkey: sql`to_char(r.created_at at time zone ${TZ}, 'YYYY-MM-DD')` },
  month: { label: 'Tháng', key: sql`to_char(s.sold_at at time zone ${TZ}, 'YYYY-MM')`, rkey: sql`to_char(r.created_at at time zone ${TZ}, 'YYYY-MM')` },
  channel: { label: 'Kênh', key: sql`s.channel`, rkey: sql`s.channel` },
  cashier: { label: 'Thu ngân', key: sql`(select u.display_name from platform.app_user u where u.id = s.cashier_id)`, rkey: sql`(select u.display_name from platform.app_user u where u.id = s.cashier_id)` },
  customer: {
    label: 'Khách hàng',
    key: sql`coalesce((select c.name from crm.customer c where c.id = s.customer_id), 'Khách lẻ')`,
    rkey: sql`coalesce((select c.name from crm.customer c where c.id = s.customer_id), 'Khách lẻ')`,
  },
} as const;

/** A line's primary category: the first by sort order (an item may sit in several). */
const PRIMARY_CATEGORY = sql`(select c.i18n -> 'en' ->> 'name' from catalog.item_category ic join catalog.category c on c.id = ic.category_id
  where ic.item_id = v.item_id order by c.sort, c.slug limit 1)`;

export async function sales(ctx: Ctx, input: z.input<typeof SalesReportSchema>): Promise<Table> {
  const actor = requirePermission(ctx, 'report.view');
  const q = SalesReportSchema.parse(input);
  const { start, end } = storeRange(q.from, q.to);
  const profit = can(actor, 'report.profit');
  const inRange = sql`s.status = 'completed' and s.sold_at >= ${tsParam(start)} and s.sold_at < ${tsParam(end)}`;
  const returnsInRange = sql`r.created_at >= ${tsParam(start)} and r.created_at < ${tsParam(end)}`;
  let rows: Record<string, unknown>[];

  if (q.groupBy === 'payment') {
    const res = await ctx.db.execute<{ key: string; orders: number; gross: string; returns: string }>(sql`
      with pay as (select p.method as key, count(distinct s.id)::int as orders, sum(p.amount_vnd) as gross
                   from sales.sale_payment p join sales.sale s on s.id = p.sale_id where ${inRange} group by p.method),
           ref as (select r.refund_method as key, sum(r.refund_vnd) as returns from sales.sale_return r where ${returnsInRange} group by r.refund_method)
      select coalesce(pay.key, ref.key) as key, coalesce(pay.orders, 0) as orders, coalesce(pay.gross, 0) as gross, coalesce(ref.returns, 0) as returns
      from pay full join ref on ref.key = pay.key order by gross desc`);
    rows = res.map((r) => ({ key: r.key, orders: r.orders, grossVnd: n(r.gross), returnsVnd: n(r.returns), netVnd: n(r.gross) - n(r.returns) }));
    return {
      title: 'Doanh thu theo phương thức thanh toán',
      from: q.from,
      to: q.to,
      columns: [
        { key: 'key', label: 'Phương thức', type: 'text' },
        { key: 'orders', label: 'Số đơn', type: 'int' },
        { key: 'grossVnd', label: 'Đã thu', type: 'vnd' },
        { key: 'returnsVnd', label: 'Đã hoàn', type: 'vnd' },
        { key: 'netVnd', label: 'Thực thu', type: 'vnd' },
      ],
      rows,
      totals: sumRows(rows, ['orders', 'grossVnd', 'returnsVnd', 'netVnd']),
    };
  }

  // Line-level for item/category; sale-level keys otherwise. Returns are attributed by return date.
  const lineKey: SQL =
    q.groupBy === 'item' ? sql`v.sku || ' · ' || (i.i18n -> 'en' ->> 'title')` : q.groupBy === 'category' ? sql`coalesce(${PRIMARY_CATEGORY}, '—')` : SALES_GROUPS[q.groupBy].key;
  const returnKey: SQL = q.groupBy === 'item' || q.groupBy === 'category' ? lineKey : SALES_GROUPS[q.groupBy].rkey;
  const res = await ctx.db.execute<{ key: string; orders: number; units: number; gross: string; discount: string; vat: string; cost: string; returns: string }>(sql`
    with sold as (
      select ${lineKey} as key, count(distinct s.id)::int as orders, sum(l.qty)::int as units, sum(l.total_vnd) as gross,
             sum(l.discount_vnd) as discount, sum(l.vat_vnd) as vat, sum(l.cost_vnd) as cost
      from sales.sale_line l join sales.sale s on s.id = l.sale_id
      left join catalog.item_variant v on v.id = l.variant_id left join catalog.item i on i.id = v.item_id
      where ${inRange} group by 1),
    ret as (
      select ${returnKey} as key, sum(rl.refund_vnd) as returns
      from sales.sale_return_line rl join sales.sale_return r on r.id = rl.return_id
      join sales.sale s on s.id = r.sale_id join sales.sale_line l on l.id = rl.sale_line_id
      left join catalog.item_variant v on v.id = l.variant_id left join catalog.item i on i.id = v.item_id
      where ${returnsInRange} group by 1)
    select coalesce(sold.key, ret.key) as key, coalesce(sold.orders, 0) as orders, coalesce(sold.units, 0) as units,
           coalesce(sold.gross, 0) as gross, coalesce(sold.discount, 0) as discount, coalesce(sold.vat, 0) as vat,
           coalesce(sold.cost, 0) as cost, coalesce(ret.returns, 0) as returns
    from sold full join ret on ret.key = sold.key
    order by ${q.groupBy === 'day' || q.groupBy === 'month' ? sql`1` : sql`gross desc`}`);
  rows = res.map((r) => {
    const gross = n(r.gross);
    const row: Record<string, unknown> = {
      key: r.key,
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
  const [ord] = await ctx.db.execute<{ orders: number }>(sql`select count(*)::int as orders from sales.sale s where ${inRange}`);
  totals.orders = ord!.orders;
  const label = q.groupBy === 'item' ? 'Sản phẩm' : q.groupBy === 'category' ? 'Danh mục' : SALES_GROUPS[q.groupBy].label;
  return {
    title: `Doanh thu theo ${label.toLowerCase()}`,
    from: q.from,
    to: q.to,
    columns: [
      { key: 'key', label, type: q.groupBy === 'day' ? 'date' : 'text' },
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
  view: z.enum(['stock', 'movements', 'slow', 'counts', 'consignment']),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Slow-moving: days since the last sale (default 90). */
  days: z.coerce.number().int().min(1).max(3650).default(90),
});

export async function inventory(ctx: Ctx, input: z.input<typeof InventoryReportSchema>): Promise<Table> {
  const actor = requirePermission(ctx, 'report.view');
  const q = InventoryReportSchema.parse(input);
  const cost = can(actor, 'catalog.view_cost');
  const needRange = q.view === 'movements' || q.view === 'counts';
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
    const rows = res.map((r) => ({ type: r.type, lines: r.lines, qtyIn: r.qty_in, qtyOut: r.qty_out }));
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

  if (q.view === 'slow') {
    const since = new Date(ctx.clock.now().getTime() - q.days * 86_400_000);
    const res = await ctx.db.execute<{ sku: string; title: string; on_hand: number; last_sale: Date | null; value: string }>(sql`
      select v.sku, i.i18n -> 'en' ->> 'title' as title, sum(s.on_hand)::int as on_hand, max(s.last_sale_at) as last_sale,
             coalesce(sum(greatest(s.on_hand, 0) * s.avg_cost_vnd), 0) as value
      from inventory.stock_level s join catalog.item_variant v on v.id = s.variant_id join catalog.item i on i.id = v.item_id
      group by v.id, i.id having sum(s.on_hand) > 0 and (max(s.last_sale_at) is null or max(s.last_sale_at) < ${tsParam(since)})
      order by max(s.last_sale_at) nulls first`);
    const now = ctx.clock.now().getTime();
    const rows = res.map((r) => ({
      sku: r.sku,
      title: r.title,
      onHand: r.on_hand,
      lastSaleAt: r.last_sale,
      daysSinceSale: r.last_sale ? Math.floor((now - new Date(r.last_sale).getTime()) / 86_400_000) : null,
      ...(cost && { valueVnd: n(r.value) }),
    }));
    return {
      title: `Hàng chậm bán (không bán trong ${q.days} ngày)`,
      from: null,
      to: null,
      columns: [
        { key: 'sku', label: 'SKU', type: 'text' },
        { key: 'title', label: 'Tên sản phẩm', type: 'text' },
        { key: 'onHand', label: 'Tồn', type: 'int' },
        { key: 'lastSaleAt', label: 'Bán lần cuối', type: 'datetime' },
        { key: 'daysSinceSale', label: 'Số ngày chưa bán', type: 'int' },
        ...(cost ? [{ key: 'valueVnd', label: 'Giá trị tồn', type: 'vnd' as const }] : []),
      ],
      rows,
    };
  }

  if (q.view === 'counts') {
    const res = await ctx.db.execute<{ doc_no: string; approved_at: Date; sku: string; title: string; expected: number; counted: number; avg: string }>(sql`
      select c.doc_no, c.approved_at, v.sku, i.i18n -> 'en' ->> 'title' as title, l.expected, l.counted,
             coalesce((select max(avg_cost_vnd) from inventory.stock_level s where s.variant_id = l.variant_id), 0) as avg
      from inventory.stock_count c join inventory.stock_count_line l on l.count_id = c.id
      join catalog.item_variant v on v.id = l.variant_id join catalog.item i on i.id = v.item_id
      where c.status = 'approved' and c.approved_at >= ${tsParam(range!.start)} and c.approved_at < ${tsParam(range!.end)}
        and l.counted is not null and l.counted <> l.expected
      order by c.approved_at, v.sku`);
    const rows = res.map((r) => ({
      docNo: r.doc_no,
      approvedAt: r.approved_at,
      sku: r.sku,
      title: r.title,
      expected: r.expected,
      counted: r.counted,
      variance: r.counted - r.expected,
      ...(cost && { varianceValueVnd: (r.counted - r.expected) * n(r.avg) }),
    }));
    return {
      title: 'Chênh lệch kiểm kho',
      from: q.from!,
      to: q.to!,
      columns: [
        { key: 'docNo', label: 'Phiếu', type: 'text' },
        { key: 'approvedAt', label: 'Ngày duyệt', type: 'datetime' },
        { key: 'sku', label: 'SKU', type: 'text' },
        { key: 'title', label: 'Tên sản phẩm', type: 'text' },
        { key: 'expected', label: 'Sổ sách', type: 'int' },
        { key: 'counted', label: 'Thực tế', type: 'int' },
        { key: 'variance', label: 'Chênh lệch', type: 'int' },
        ...(cost ? [{ key: 'varianceValueVnd', label: 'Giá trị chênh lệch', type: 'vnd' as const }] : []),
      ],
      rows,
      totals: sumRows(rows, ['variance', ...(cost ? ['varianceValueVnd'] : [])]),
    };
  }

  // consignment stock
  const res = await ctx.db.execute<{ supplier: string; sku: string; title: string; received: number; sold: number; returned: number; remaining: number; discount_bp: number }>(sql`
    select s.name as supplier, v.sku, i.i18n -> 'en' ->> 'title' as title, sum(l.qty_received)::int as received, sum(l.qty_sold)::int as sold,
           sum(l.qty_returned)::int as returned, sum(l.qty_received - l.qty_sold - l.qty_returned)::int as remaining, max(l.discount_bp) as discount_bp
    from purchasing.consignment_lot l join purchasing.supplier s on s.id = l.supplier_id
    join catalog.item_variant v on v.id = l.variant_id join catalog.item i on i.id = v.item_id
    group by s.id, v.id, i.id order by s.name, v.sku`);
  const rows = res.map((r) => ({ supplier: r.supplier, sku: r.sku, title: r.title, received: r.received, sold: r.sold, returned: r.returned, remaining: r.remaining, discountBp: r.discount_bp }));
  return {
    title: 'Hàng ký gửi',
    from: null,
    to: null,
    columns: [
      { key: 'supplier', label: 'Nhà cung cấp', type: 'text' },
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'title', label: 'Tên sản phẩm', type: 'text' },
      { key: 'received', label: 'Nhận', type: 'int' },
      { key: 'sold', label: 'Đã bán', type: 'int' },
      { key: 'returned', label: 'Đã trả', type: 'int' },
      { key: 'remaining', label: 'Còn lại', type: 'int' },
      { key: 'discountBp', label: 'Chiết khấu', type: 'percent' },
    ],
    rows,
    totals: sumRows(rows, ['received', 'sold', 'returned', 'remaining']),
  };
}

// =============================================================================================
// Tax and audit (FR-RPT-04)

export const TaxReportSchema = RangeSchema.extend({ view: z.enum(['vat', 'einvoices', 'shifts']) });

export async function tax(ctx: Ctx, input: z.input<typeof TaxReportSchema>): Promise<Table> {
  requirePermission(ctx, 'report.view');
  const q = TaxReportSchema.parse(input);
  const { start, end } = storeRange(q.from, q.to);

  if (q.view === 'vat') {
    // Output VAT by rate; returns reduce it by the VAT contained in the refund.
    const res = await ctx.db.execute<{ vat_bp: number; gross: string; vat: string; ret_gross: string; ret_vat: string }>(sql`
      with sold as (select l.vat_bp, sum(l.total_vnd) as gross, sum(l.vat_vnd) as vat
                    from sales.sale_line l join sales.sale s on s.id = l.sale_id
                    where s.status = 'completed' and s.sold_at >= ${tsParam(start)} and s.sold_at < ${tsParam(end)} group by l.vat_bp),
           ret as (select l.vat_bp, sum(rl.refund_vnd) as gross, sum(round(rl.refund_vnd::numeric * l.vat_bp / (10000 + l.vat_bp))) as vat
                   from sales.sale_return_line rl join sales.sale_return r on r.id = rl.return_id join sales.sale_line l on l.id = rl.sale_line_id
                   where r.created_at >= ${tsParam(start)} and r.created_at < ${tsParam(end)} group by l.vat_bp)
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
      from sales.einvoice_job j join sales.sale s on s.id = j.sale_id
      where s.sold_at >= ${tsParam(start)} and s.sold_at < ${tsParam(end)} order by s.sold_at`);
    const rows = res.map((r) => ({
      docNo: r.doc_no,
      soldAt: r.sold_at,
      invoiceNo: r.invoice_no,
      status: r.status,
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
  view: z.enum(['stock_ins', 'consignment']),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export async function purchasingReport(ctx: Ctx, input: z.input<typeof PurchasingReportSchema>): Promise<Table> {
  const actor = requirePermission(ctx, 'report.view');
  const q = PurchasingReportSchema.parse(input);

  if (q.view === 'consignment') {
    // Consignment settlement stays behind its own permission (FR-PUR-11).
    if (!can(actor, 'purchasing.payables')) throw errors.forbidden('purchasing.payables');
  }
  if (!q.from || !q.to) throw new AppError(400, 'range_required', 'Cần chọn khoảng thời gian.');
  const { start, end } = storeRange(q.from, q.to);
  if (q.view === 'consignment') {
    const res = await ctx.db.execute<{ doc_no: string; supplier: string; period: string; amount: string; status: string }>(sql`
      select st.doc_no, s.name as supplier, st.period, st.amount_due_vnd as amount, st.status
      from purchasing.consignment_statement st join purchasing.supplier s on s.id = st.supplier_id
      where st.created_at >= ${tsParam(start)} and st.created_at < ${tsParam(end)} order by st.period, s.name`);
    const rows = res.map((r) => ({ docNo: r.doc_no, supplier: r.supplier, period: r.period, amountDueVnd: n(r.amount), status: r.status }));
    return {
      title: 'Quyết toán hàng ký gửi',
      from: q.from,
      to: q.to,
      columns: [
        { key: 'docNo', label: 'Số bảng kê', type: 'text' },
        { key: 'supplier', label: 'Nhà cung cấp', type: 'text' },
        { key: 'period', label: 'Kỳ', type: 'text' },
        { key: 'amountDueVnd', label: 'Phải trả', type: 'vnd' },
        { key: 'status', label: 'Trạng thái', type: 'text' },
      ],
      rows,
      totals: sumRows(rows, ['amountDueVnd']),
    };
  }

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

export const ExportSchema = z.object({ format: z.enum(['xlsx', 'csv']).default('xlsx'), params: z.record(z.string(), z.unknown()).default({}) });

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

function toCsv(t: Table): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [t.columns.map((c) => esc(c.label)).join(',')];
  for (const r of t.rows) lines.push(t.columns.map((c) => esc(formatCell(r[c.key], c.type))).join(','));
  if (t.totals) lines.push(t.columns.map((c, i) => esc(i === 0 ? 'Tổng cộng' : formatCell(t.totals![c.key], c.type))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
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
  if (row.format === 'csv') return { bytes: new TextEncoder().encode(toCsv(table)), mime: 'text/csv; charset=utf-8', filename: `${base}.csv` };
  const header = table.columns.map((c) => c.label);
  const body = table.rows.map((r) => table.columns.map((c) => formatCell(r[c.key], c.type)));
  if (table.totals) body.push(table.columns.map((c, i) => (i === 0 ? 'Tổng cộng' : formatCell(table.totals![c.key], c.type))));
  const filter = `${table.title}${table.from ? ` · Từ ${table.from} đến ${table.to}` : ''}`;
  return { bytes: await writeTable(table.title.slice(0, 31), header, body, filter), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${base}.xlsx` };
}

// =============================================================================================
// Menu count badges (FR-ADM-08, TDD §4.12)

/** Per-menu counts, each only with the matching permission. Orders and to-notify tasks arrive in R2. */
export async function badges(ctx: Ctx) {
  if (!ctx.actor) throw errors.unauthenticated();
  const out: Record<string, number> = {};
  if (can(ctx.actor, 'einvoice.manage')) {
    const [r] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from sales.einvoice_job where status = 'failed'`);
    out.einvoicesFailed = r!.n;
  }
  return out;
}
