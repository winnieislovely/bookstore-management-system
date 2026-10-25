import { schema } from '@bookstore/db';
import { and, desc, eq, gte, lt, lte, sql, type SQL } from 'drizzle-orm';
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
  actorId?: string | undefined;
  action?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  /** Keyset cursor: the `at` of the last row of the previous page (ISO string). */
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function search(ctx: Ctx, q: AuditQuery) {
  requirePermission(ctx, 'audit.view');
  const a = schema.auditEntry;
  const where: SQL[] = [];
  if (q.entity) where.push(eq(a.entity, q.entity));
  if (q.entityId) where.push(eq(a.entityId, q.entityId));
  if (q.actorId) where.push(eq(a.actorId, q.actorId));
  if (q.action) where.push(sql`${a.action} like ${`${q.action}%`}`);
  if (q.from) where.push(gte(a.at, q.from));
  if (q.to) where.push(lte(a.at, q.to));
  if (q.cursor) where.push(lt(a.at, new Date(q.cursor)));
  const limit = Math.min(q.limit ?? 40, 200);
  const rows = await ctx.db
    .select()
    .from(a)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(a.at), desc(a.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return { items: page, nextCursor: rows.length > limit ? page[page.length - 1]!.at.toISOString() : null };
}
