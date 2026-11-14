import { foldText } from '@bookstore/domain';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { can, errors, tsParam, type Ctx } from '../platform/index.js';

/**
 * The Orders screen (“Đơn hàng”, FR-ORD-01, FR-ORD-05, TDD §6.2): every order of the store in one
 * list – counter sales and online orders; pre-orders have their own screen (FR-POS-09) and show here
 * once collected, as the counter sale. Each kind keeps its own table and record;
 * this is a read-only union. Rows the user may not see are left out per kind.
 */

export const ORDER_TYPES = ['counter', 'online'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

const csv = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (Array.isArray(v) ? v : v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined));

export const AllOrdersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  type: csv.pipe(z.array(z.enum(ORDER_TYPES)).min(1).optional()),
  /** Status values of any kind (sale: completed/voided; online statuses as stored). */
  status: csv.pipe(z.array(z.string().max(40)).min(1).optional()),
  source: csv.pipe(z.array(z.string().max(40)).min(1).optional()),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(40),
});

export interface AllOrdersRow {
  type: OrderType;
  id: string;
  docNo: string;
  source: string;
  channelName: string | null;
  customerName: string | null;
  phone: string | null;
  totalVnd: number;
  payment: string[];
  paidAt: string | null;
  status: string;
  reviewReasons: string[];
  /** Online orders waiting for confirmation (or a return decision) – listed first, counted on the menu. */
  needsAction: boolean;
  unread: boolean;
  at: string;
}

export async function listAllOrders(ctx: Ctx, input: z.input<typeof AllOrdersQuery>) {
  const actor = ctx.actor;
  if (!actor) throw errors.unauthenticated();
  const q = AllOrdersQuery.parse(input);
  const seeSales = can(actor, 'sale.view_all') || can(actor, 'sale.create');
  const seeOnline = can(actor, 'online.manage') || can(actor, 'online.confirm');
  if (!seeSales && !seeOnline) throw errors.forbidden('online.confirm');

  const parts: SQL[] = [];
  if (seeSales) {
    // Without sale.view_all a cashier sees their own sales only (TDD §6.2, GET /pos/sales).
    const own = can(actor, 'sale.view_all') ? sql`true` : sql`s.cashier_id = ${actor.userId}`;
    parts.push(sql`
      select 'counter'::text as type, s.id, s.doc_no, s.channel as source, null::text as channel_name,
             c.name as customer_name, c.phone_e164 as phone, s.total_vnd,
             coalesce((select array_agg(distinct p.method) from sales.sale_payment p where p.sale_id = s.id), '{}') as payment,
             s.sold_at as paid_at, s.status, '{}'::text[] as review_reasons, false as needs_action, false as unread, s.sold_at as at
      from sales.sale s left join crm.customer c on c.id = s.customer_id
      where ${own}`);
  }
  if (seeOnline) {
    parts.push(sql`
      select 'online'::text as type, o.id, o.doc_no, o.source, ch.name as channel_name,
             o.recipient ->> 'name' as customer_name, o.recipient ->> 'phone' as phone, o.total_vnd,
             array[o.payment_method] as payment, o.paid_at, o.status, o.review_reasons,
             o.status in ('new', 'pending_review', 'return_requested') as needs_action, o.read_at is null as unread, o.created_at as at
      from orders.web_order o left join orders.channel ch on ch.id = o.channel_id`);
  }
  const union = sql.join(parts, sql` union all `);

  const where: SQL[] = [];
  if (q.from) where.push(sql`u.at >= ${tsParam(new Date(q.from))}`);
  if (q.to) where.push(sql`u.at <= ${tsParam(new Date(q.to))}`);
  if (q.source) where.push(sql`u.source in (${sql.join(q.source.map((s) => sql`${s}`), sql`, `)})`);
  if (q.q) {
    const digits = q.q.replace(/\D/g, '');
    where.push(sql`(
      u.doc_no ilike ${`%${q.q}%`}
      or lower(public.f_unaccent(coalesce(u.customer_name, ''))) like ${`%${foldText(q.q)}%`}
      ${digits.length >= 4 ? sql`or u.phone like ${`%${digits.slice(-9)}%`}` : sql``}
      or (u.type = 'online' and exists (select 1 from orders.shipment sh where sh.order_id = u.id and sh.tracking_no ilike ${`%${q.q}%`})))`);
  }
  const base = where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``;
  const filters = [...where];
  if (q.type) filters.push(sql`u.type in (${sql.join(q.type.map((t) => sql`${t}`), sql`, `)})`);
  if (q.status) filters.push(sql`u.status in (${sql.join(q.status.map((s) => sql`${s}`), sql`, `)})`);
  const filtered = filters.length ? sql`where ${sql.join(filters, sql` and `)}` : sql``;

  const typeCounts = await ctx.db.execute<{ type: OrderType; n: number }>(sql`select u.type, count(*)::int as n from (${union}) u ${base} group by u.type`);
  const rows = await ctx.db.execute<{
    type: OrderType;
    id: string;
    doc_no: string;
    source: string;
    channel_name: string | null;
    customer_name: string | null;
    phone: string | null;
    total_vnd: string | number;
    payment: string[];
    paid_at: Date | string | null;
    status: string;
    review_reasons: string[];
    needs_action: boolean;
    unread: boolean;
    at: Date | string;
  }>(sql`select u.* from (${union}) u ${filtered} order by u.needs_action desc, u.at desc, u.id desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`);
  const [total] = await ctx.db.execute<{ n: number }>(sql`select count(*)::int as n from (${union}) u ${filtered}`);
  const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());
  const items: AllOrdersRow[] = rows.map((r) => ({
    type: r.type,
    id: r.id,
    docNo: r.doc_no,
    source: r.source,
    channelName: r.channel_name,
    customerName: r.customer_name,
    phone: r.phone,
    totalVnd: Number(r.total_vnd),
    payment: r.payment ?? [],
    paidAt: iso(r.paid_at),
    status: r.status,
    reviewReasons: r.review_reasons ?? [],
    needsAction: r.needs_action,
    unread: r.unread,
    at: iso(r.at)!,
  }));
  return {
    items,
    page: q.page,
    total: total?.n ?? 0,
    counts: Object.fromEntries(typeCounts.map((c) => [c.type, c.n])) as Partial<Record<OrderType, number>>,
  };
}
