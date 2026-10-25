import { schema } from '@bookstore/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import * as audit from '../audit/index.js';
import { AppError, errors, requirePermission, type Ctx, type Tx } from '../platform/index.js';
import { post, postCredit } from './index.js';

/**
 * Every column that references a customer (TDD §4.9 `customer_ref_registry`). A test compares this
 * with the database's foreign keys, so a new table that references customers fails until it is
 * listed here. `ledger` tables are immutable: their balances move through new ledger rows instead.
 */
export const CUSTOMER_REFS: { table: string; column: string; mode: 'move' | 'ledger' | 'self' }[] = [
  { table: 'crm.customer_contact', column: 'customer_id', mode: 'move' },
  { table: 'crm.customer_consent', column: 'customer_id', mode: 'move' },
  { table: 'crm.customer_tier_history', column: 'customer_id', mode: 'move' },
  { table: 'crm.promotion_usage', column: 'customer_id', mode: 'move' },
  { table: 'sales.sale', column: 'customer_id', mode: 'move' },
  { table: 'crm.points_ledger', column: 'customer_id', mode: 'ledger' },
  { table: 'crm.store_credit_ledger', column: 'customer_id', mode: 'ledger' },
  { table: 'crm.customer', column: 'merged_into', mode: 'self' },
];

/** Merge `sourceId` into `targetId` (FR-CRM-02, TDD §4.9). Irreversible; audited. */
export async function merge(ctx: Ctx, targetId: string, sourceId: string) {
  requirePermission(ctx, 'customer.manage');
  if (targetId === sourceId) throw new AppError(400, 'same_customer', 'Hãy chọn hai khách hàng khác nhau.');
  return ctx.db.transaction(async (tx) => {
    // Lock both in id order to avoid deadlocks (TDD §3.6).
    const ids = [targetId, sourceId].sort();
    const rows = await tx.select().from(schema.customer).where(sql`${schema.customer.id} in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`).for('update');
    const target = rows.find((r) => r.id === targetId);
    const source = rows.find((r) => r.id === sourceId);
    if (!target || !source) throw errors.notFound('Khách hàng');
    if (target.anonymisedAt || source.anonymisedAt) throw errors.conflict('customer_erased', 'Không thể gộp khách hàng đã xóa dữ liệu.');

    for (const ref of CUSTOMER_REFS.filter((r) => r.mode === 'move')) {
      await tx.execute(sql`update ${sql.raw(ref.table)} set ${sql.raw(ref.column)} = ${targetId}::uuid where ${sql.raw(ref.column)} = ${sourceId}::uuid`);
    }
    // Earlier merges into the source now point at the target.
    await tx.update(schema.customer).set({ mergedInto: targetId }).where(eq(schema.customer.mergedInto, sourceId));

    const note = `Gộp từ khách hàng ${source.name}`;
    if (source.pointsBalance > 0) {
      await post(tx, ctx, { customerId: sourceId, delta: -source.pointsBalance, reason: 'adjust', refType: 'customer_merge', refId: targetId, note });
      await post(tx, ctx, { customerId: targetId, delta: source.pointsBalance, reason: 'adjust', refType: 'customer_merge', refId: sourceId, note });
    }
    if (source.storeCreditVnd > 0) {
      await postCredit(tx, ctx, { customerId: sourceId, deltaVnd: -source.storeCreditVnd, reason: 'adjust', refType: 'customer_merge', refId: targetId, note });
      await postCredit(tx, ctx, { customerId: targetId, deltaVnd: source.storeCreditVnd, reason: 'adjust', refType: 'customer_merge', refId: sourceId, note });
    }
    // Keep the source phone reachable on the target.
    if (source.phoneE164 && source.phoneE164 !== target.phoneE164) {
      await tx.insert(schema.customerContact).values({ customerId: targetId, kind: 'phone', value: source.phoneE164 });
    }
    const addresses = [...(target.addresses as unknown[]), ...(source.addresses as unknown[])];
    await tx
      .update(schema.customer)
      .set({
        email: target.email ?? source.email,
        birthDate: target.birthDate ?? source.birthDate,
        addresses,
        tags: [...new Set([...target.tags, ...source.tags])],
        note: [target.note, source.note].filter(Boolean).join('\n') || null,
        updatedAt: ctx.clock.now(),
        version: target.version + 1,
      })
      .where(eq(schema.customer.id, targetId));
    await tx
      .update(schema.customer)
      .set({ name: 'Đã gộp vào khách hàng khác', phoneE164: null, email: null, birthDate: null, addresses: [], tags: [], note: null, searchText: '', mergedInto: targetId, anonymisedAt: ctx.clock.now() })
      .where(eq(schema.customer.id, sourceId));
    await audit.record(tx, ctx, {
      action: 'customer.merge',
      entity: 'customer',
      entityId: targetId,
      before: { source: { id: source.id, name: source.name, phone: source.phoneE164, points: source.pointsBalance, credit: source.storeCreditVnd } },
      after: { target: targetId },
    });
    return { id: targetId, mergedFrom: sourceId, pointsMoved: source.pointsBalance, creditMovedVnd: source.storeCreditVnd };
  });
}

// ---------------------------------------------------------------------------------------------
// Purchase history (FR-CRM-03) and personal-data export (FR-CRM-08)

async function purchaseRows(tx: Tx, customerId: string) {
  return tx.execute<{ id: string; doc_no: string; sold_at: Date; channel: string; total_vnd: string; status: string; returns_vnd: string; points_earned: number }>(sql`
    select s.id, s.doc_no, s.sold_at, s.channel, s.total_vnd, s.status, s.points_earned,
           coalesce((select sum(r.refund_vnd) from sales.sale_return r where r.sale_id = s.id), 0) as returns_vnd
    from sales.sale s where s.customer_id = ${customerId}::uuid order by s.sold_at desc, s.id desc`);
}

/** Purchases across channels with totals; online orders, events and library join in R2–R4. */
export async function purchases(ctx: Ctx, customerId: string) {
  requirePermission(ctx, 'customer.view');
  const [c] = await ctx.db.select({ id: schema.customer.id }).from(schema.customer).where(eq(schema.customer.id, customerId));
  if (!c) throw errors.notFound('Khách hàng');
  const rows = await purchaseRows(ctx.db, customerId);
  const items = rows.map((r) => ({
    id: r.id,
    docNo: r.doc_no,
    soldAt: r.sold_at,
    channel: r.channel,
    status: r.status,
    totalVnd: Number(r.total_vnd),
    returnsVnd: Number(r.returns_vnd),
    pointsEarned: r.points_earned,
  }));
  const completed = items.filter((i) => i.status === 'completed');
  return {
    items,
    totals: {
      orders: completed.length,
      grossVnd: completed.reduce((a, i) => a + i.totalVnd, 0),
      returnsVnd: completed.reduce((a, i) => a + i.returnsVnd, 0),
      netVnd: completed.reduce((a, i) => a + i.totalVnd - i.returnsVnd, 0),
    },
  };
}

/** Everything the store holds about a customer, for a data-subject request (Decree 13/2023). */
export async function exportData(ctx: Ctx, customerId: string) {
  requirePermission(ctx, 'customer.erase');
  const [c] = await ctx.db.select().from(schema.customer).where(and(eq(schema.customer.id, customerId), isNull(schema.customer.mergedInto)));
  if (!c) throw errors.notFound('Khách hàng');
  const contacts = await ctx.db.select().from(schema.customerContact).where(eq(schema.customerContact.customerId, customerId));
  const consents = await ctx.db.select().from(schema.customerConsent).where(eq(schema.customerConsent.customerId, customerId));
  const points = await ctx.db.select().from(schema.pointsLedger).where(eq(schema.pointsLedger.customerId, customerId)).orderBy(desc(schema.pointsLedger.at));
  const credit = await ctx.db.select().from(schema.storeCreditLedger).where(eq(schema.storeCreditLedger.customerId, customerId)).orderBy(desc(schema.storeCreditLedger.at));
  const history = await purchases({ ...ctx, actor: ctx.actor }, customerId);
  await audit.record(ctx.db, ctx, { action: 'customer.export', entity: 'customer', entityId: customerId });
  return {
    exportedAt: ctx.clock.now(),
    profile: {
      name: c.name,
      phone: c.phoneE164,
      email: c.email,
      birthDate: c.birthDate,
      addresses: c.addresses,
      tags: c.tags,
      note: c.note,
      source: c.source,
      createdAt: c.createdAt,
      pointsBalance: c.pointsBalance,
      storeCreditVnd: c.storeCreditVnd,
    },
    contacts: contacts.map(({ kind, value }) => ({ kind, value })),
    consents: consents.map(({ purpose, channel, grantedAt, withdrawnAt }) => ({ purpose, channel, grantedAt, withdrawnAt })),
    pointsLedger: points.map(({ delta, reason, at, expiresAt }) => ({ delta, reason, at, expiresAt })),
    storeCreditLedger: credit.map(({ deltaVnd, reason, at }) => ({ deltaVnd, reason, at })),
    purchases: history,
  };
}
