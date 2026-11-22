import { schema } from '@bookstore/db';
import type { Permission } from '@bookstore/domain';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { errors, type Ctx, type Tx } from '../platform/index.js';

/**
 * In-app notification centre (FR-ADM-08, TDD §4.12). Operational alerts go to the users holding
 * the matching permission; they are not dashboard tiles (FR-RPT-01).
 */

export type InAppTemplate = 'shift.variance_exceeded' | 'einvoice.failed' | 'order.needs_action' | 'preorder.created' | 'delivery.update' | 'consignment.deadline' | 'backup.problem' | 'library.loans_to_call' | 'pos.sync_exception';

/** Active users who hold any of `permissions` (owners always do), each once. */
async function holders(tx: Tx, permissions: Permission[]): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    select u.id from platform.app_user u join platform.role r on r.id = u.role_id
    where u.status = 'active'
      and (r.is_owner or exists (select 1 from platform.role_permission rp where rp.role_id = r.id and rp.permission in (${sql.join(
        permissions.map((p) => sql`${p}`),
        sql`, `,
      )})))`);
  return rows.map((r) => r.id);
}

/**
 * One in-app notification per user holding the permission (or any of the permissions); `except` leaves
 * out the user who caused it (e.g. who took a pre-order slip).
 */
export async function notifyHolders(
  tx: Tx,
  permission: Permission | Permission[],
  template: InAppTemplate,
  vars: Record<string, unknown>,
  opts: { except?: string | null } = {},
): Promise<number> {
  const users = (await holders(tx, Array.isArray(permission) ? permission : [permission])).filter((u) => u !== opts.except);
  if (users.length) {
    await tx.insert(schema.notification).values(users.map((to) => ({ channel: 'in_app', to, template, vars, status: 'sent', sentAt: new Date() })));
  }
  return users.length;
}

export async function list(ctx: Ctx, limit = 50) {
  if (!ctx.actor) throw errors.unauthenticated();
  const n = schema.notification;
  const items = await ctx.db
    .select({ id: n.id, template: n.template, vars: n.vars, createdAt: n.createdAt, readAt: n.readAt })
    .from(n)
    .where(and(eq(n.channel, 'in_app'), eq(n.to, ctx.actor.userId)))
    .orderBy(desc(n.createdAt))
    .limit(limit);
  return { items, unread: items.filter((i) => i.readAt === null).length };
}

export async function markRead(ctx: Ctx, ids: string[] | 'all') {
  if (!ctx.actor) throw errors.unauthenticated();
  const n = schema.notification;
  await ctx.db
    .update(n)
    .set({ readAt: ctx.clock.now() })
    .where(and(eq(n.channel, 'in_app'), eq(n.to, ctx.actor.userId), isNull(n.readAt), ids === 'all' ? undefined : inArray(n.id, ids)));
}
