import { schema } from '@bookstore/db';
import { AUDIT_GROUPS, type AuditGroup } from '@bookstore/domain';
import { and, desc, eq, getTableColumns, gte, isNull, lt, lte, not, or, sql, type SQL } from 'drizzle-orm';
import { requirePermission, type Ctx, type Tx } from '../platform/index.js';

/**
 * Audit log (FR-ADM-05, TDD §10.5): who did what and when, with before/after values. Insert-only,
 * enforced by a database trigger. Callers pass their transaction so the entry commits with the change.
 */
export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function record(tx: Tx, ctx: Ctx, entry: AuditInput): Promise<void> {
  await tx.insert(schema.auditEntry).values({
    actorId: ctx.actor?.userId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    at: ctx.clock.now(),
    ip: ctx.ip,
    requestId: ctx.requestId,
  });
}

export interface AuditQuery {
  entity?: string | undefined;
  entityId?: string | undefined;
  /** A staff id, or `system` for entries without a person. */
  actorId?: string | undefined;
  action?: string | undefined;
  /** A kind of action (Design §12.11). */
  group?: AuditGroup | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  /** Keyset cursor: the `at` of the last row of the previous page (ISO string). */
  cursor?: string | undefined;
  limit?: number | undefined;
}

const a = schema.auditEntry;
const matches = (prefixes: readonly string[]) => or(...prefixes.map((p) => sql`${a.action} like ${`${p}%`}`))!;

/** In this group and in no group before it, as `auditGroup` decides (packages/domain). */
function groupSql(key: AuditGroup): SQL {
  const i = AUDIT_GROUPS.findIndex((g) => g.key === key);
  const earlier = AUDIT_GROUPS.slice(0, i).flatMap((g) => g.prefixes);
  return earlier.length ? and(matches(AUDIT_GROUPS[i]!.prefixes), not(matches(earlier)))! : matches(AUDIT_GROUPS[i]!.prefixes);
}

/**
 * The object's number or name, read from its table so the log reads as a sentence (Design §12.11);
 * falls back to what the entry itself carries.
 */
const labelSql = sql<string | null>`coalesce(case ${a.entity}
  when 'sale' then (select doc_no from sales.sale where id::text = ${a.entityId})
  when 'web_order' then (select doc_no from orders.web_order where id::text = ${a.entityId})
  when 'preorder' then (select doc_no from orders.preorder where id::text = ${a.entityId})
  when 'stock_count' then (select doc_no from inventory.stock_count where id::text = ${a.entityId})
  when 'stock_in_entry' then (select entry_no from purchasing.stock_in_entry where id::text = ${a.entityId})
  when 'consignment_statement' then (select doc_no from purchasing.consignment_statement where id::text = ${a.entityId})
  when 'item_variant' then (select v.sku || ' · ' || coalesce(i.i18n -> 'vi' ->> 'title', i.i18n -> 'en' ->> 'title') from catalog.item_variant v join catalog.item i on i.id = v.item_id where v.id::text = ${a.entityId})
  when 'item' then (select coalesce(i18n -> 'vi' ->> 'title', i18n -> 'en' ->> 'title') from catalog.item where id::text = ${a.entityId})
  when 'category' then (select coalesce(i18n -> 'vi' ->> 'name', i18n -> 'en' ->> 'name') from catalog.category where id::text = ${a.entityId})
  when 'customer' then (select name from crm.customer where id::text = ${a.entityId})
  when 'promotion' then (select name from crm.promotion where id::text = ${a.entityId})
  when 'supplier' then (select name from purchasing.supplier where id::text = ${a.entityId})
  when 'app_user' then (select display_name from platform.app_user where id::text = ${a.entityId})
  when 'role' then (select name from platform.role where id::text = ${a.entityId})
  when 'register' then (select code || ' · ' || name from sales.register where id::text = ${a.entityId})
  when 'pos_device' then (select device_code from sales.pos_device where id::text = ${a.entityId})
  when 'lib_title' then (select title from library.lib_title where id::text = ${a.entityId})
  when 'lib_copy' then (select barcode from library.lib_copy where id::text = ${a.entityId})
  when 'loan' then (select c.barcode || ' · ' || t.title from library.loan l join library.lib_copy c on c.id = l.copy_id join library.lib_title t on t.id = c.title_id where l.id::text = ${a.entityId})
  when 'lib_count' then (select doc_no from library.lib_count where id::text = ${a.entityId})
  when 'lib_payment' then (select doc_no from library.lib_payment where id::text = ${a.entityId})
  when 'setting' then ${a.entityId}
  when 'master_data' then coalesce(${a.after} #>> '{i18n,vi,name}', ${a.before} #>> '{i18n,vi,name}', ${a.entityId})
end, ${a.after} ->> 'docNo', ${a.after} ->> 'entryNo', ${a.after} ->> 'name', ${a.after} ->> 'title', ${a.before} ->> 'name')`;

/** The id to open: the product for a variant, the entry's own object otherwise. */
const refSql = sql<string | null>`case when ${a.entity} = 'item_variant' then (select item_id::text from catalog.item_variant where id::text = ${a.entityId}) else ${a.entityId} end`;

export async function search(ctx: Ctx, q: AuditQuery) {
  requirePermission(ctx, 'audit.view');
  const where: SQL[] = [];
  if (q.entity) where.push(eq(a.entity, q.entity));
  if (q.entityId) where.push(eq(a.entityId, q.entityId));
  if (q.actorId) where.push(q.actorId === 'system' ? isNull(a.actorId) : eq(a.actorId, q.actorId));
  if (q.action) where.push(sql`${a.action} like ${`${q.action}%`}`);
  if (q.group) where.push(groupSql(q.group));
  if (q.from) where.push(gte(a.at, q.from));
  if (q.to) where.push(lte(a.at, q.to));
  if (q.cursor) where.push(lt(a.at, new Date(q.cursor)));
  const limit = Math.min(q.limit ?? 40, 200);
  const rows = await ctx.db
    .select({ ...getTableColumns(a), actorName: schema.appUser.displayName, label: labelSql, refId: refSql })
    .from(a)
    .leftJoin(schema.appUser, eq(schema.appUser.id, a.actorId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(a.at), desc(a.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return { items: page, nextCursor: rows.length > limit ? page[page.length - 1]!.at.toISOString() : null };
}
