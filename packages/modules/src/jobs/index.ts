import { schema } from '@bookstore/db';
import { tierForSpend, vnd } from '@bookstore/domain';
import { asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import * as customers from '../customers/index.js';
import type { EInvoiceAdapter, IssueRequest } from '../integrations/einvoice.js';
import * as notifications from '../notifications/index.js';
import * as settings from '../settings/index.js';
import { tsParam, type Ctx, type Tx } from '../platform/index.js';

/**
 * Background job handlers (TDD §9.1). Each is idempotent and safe to run twice; the worker
 * schedules them with pg-boss, tests call them directly.
 */

// ---------------------------------------------------------------------------------------------
// einvoice.issue (FR-POS-15..17, TDD §8.3)

/** Automatic retries with backoff before a failed invoice waits for a manual retry. */
export const EINVOICE_MAX_AUTO_ATTEMPTS = 8;

function backoff(attempts: number, now: Date): Date {
  const minutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + minutes * 60_000);
}

async function invoiceRequest(tx: Tx, saleId: string, buyer: IssueRequest['buyer']): Promise<IssueRequest> {
  const [sale] = await tx.select().from(schema.sale).where(eq(schema.sale.id, saleId));
  const lines = await tx.select().from(schema.saleLine).where(eq(schema.saleLine.saleId, saleId)).orderBy(asc(schema.saleLine.lineNo));
  return {
    reference: sale!.docNo,
    issuedAt: sale!.soldAt,
    buyer,
    lines: lines.map((l) => ({
      description: l.description,
      qty: l.qty,
      unitPriceVnd: l.unitPriceVnd,
      discountVnd: l.discountVnd,
      totalVnd: l.totalVnd,
      vatBp: l.vatBp,
      vatVnd: l.vatVnd,
    })),
    totalVnd: sale!.totalVnd,
    vatVnd: sale!.vatVnd,
  };
}

export interface EinvoiceRunResult {
  issued: number;
  emailed: number;
  reissued: number;
  cancelled: number;
  failed: number;
}

export async function processEinvoices(ctx: Ctx, adapter: EInvoiceAdapter, limit = 20): Promise<EinvoiceRunResult> {
  const out: EinvoiceRunResult = { issued: 0, emailed: 0, reissued: 0, cancelled: 0, failed: 0 };
  const now = ctx.clock.now();
  const j = schema.einvoiceJob;
  const due = await ctx.db.execute<{ id: string }>(sql`
    select j.id from sales.einvoice_job j join sales.sale s on s.id = j.sale_id
    where (j.status = 'pending' and coalesce(j.next_attempt_at, now()) <= ${tsParam(now)})
       or (j.status = 'failed' and j.attempts < ${EINVOICE_MAX_AUTO_ATTEMPTS} and j.next_attempt_at <= ${tsParam(now)})
       or (j.status = 'issued' and (j.reissue_requested or s.status = 'voided' or (j.email_requested and j.email_status is null)))
    order by j.created_at limit ${limit}`);

  for (const { id } of due) {
    await ctx.db.transaction(async (tx) => {
      // Another worker may hold it; skip rather than wait.
      const [job] = await tx.select().from(j).where(eq(j.id, id)).for('update', { skipLocked: true });
      if (!job?.saleId) return;
      const [sale] = await tx.select({ status: schema.sale.status }).from(schema.sale).where(eq(schema.sale.id, job.saleId));
      const buyer = (job.buyer as IssueRequest['buyer']) ?? null;
      try {
        if (job.status === 'issued' && sale?.status === 'voided') {
          await adapter.cancel(job.providerRef!, 'Hủy đơn bán');
          await tx.update(j).set({ status: 'cancelled', reissueRequested: false, updatedAt: now }).where(eq(j.id, id));
          out.cancelled++;
          return;
        }
        if (job.status === 'issued' && job.reissueRequested) {
          const r = await adapter.replace(job.providerRef!, await invoiceRequest(tx, job.saleId, buyer));
          await tx.update(j).set({ providerRef: r.providerRef, invoiceNo: r.invoiceNo, reissueRequested: false, emailStatus: null, updatedAt: now }).where(eq(j.id, id));
          job.providerRef = r.providerRef;
          out.reissued++;
        } else if (job.status !== 'issued') {
          await tx.update(j).set({ status: 'sent', attempts: job.attempts + 1, updatedAt: now }).where(eq(j.id, id));
          const r = await adapter.issue(await invoiceRequest(tx, job.saleId, buyer));
          await tx.update(j).set({ status: 'issued', providerRef: r.providerRef, invoiceNo: r.invoiceNo, error: null, nextAttemptAt: null, updatedAt: now }).where(eq(j.id, id));
          job.providerRef = r.providerRef;
          out.issued++;
        }
        // Emailed by the provider only when the customer asked (FR-POS-16).
        if (job.emailRequested && buyer?.email) {
          await adapter.emailToBuyer(job.providerRef!, buyer.email);
          await tx.update(j).set({ emailStatus: 'sent', updatedAt: now }).where(eq(j.id, id));
          out.emailed++;
        }
      } catch (err) {
        const attempts = job.status === 'issued' ? job.attempts : job.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        if (job.status === 'issued') {
          // Issued but the follow-up (email, reissue, cancel) failed: keep it issued and retry later.
          await tx.update(j).set({ emailStatus: job.emailRequested ? 'failed' : job.emailStatus, error: message, updatedAt: now }).where(eq(j.id, id));
        } else {
          await tx.update(j).set({ status: 'failed', attempts, error: message, nextAttemptAt: backoff(attempts, now), updatedAt: now }).where(eq(j.id, id));
          // Failures surface as an in-app notification and badge, not a dashboard tile (FR-RPT-01, FR-ADM-08).
          if (job.status !== 'failed') {
            const [s] = await tx.select({ docNo: schema.sale.docNo }).from(schema.sale).where(eq(schema.sale.id, job.saleId));
            await notifications.notifyHolders(tx, 'einvoice.manage', 'einvoice.failed', { saleId: job.saleId, docNo: s?.docNo, error: message });
          }
        }
        out.failed++;
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// loyalty.points_expire and loyalty.tier_recalc (FR-CRM-04, FR-CRM-07, BR-07, BR-08)

/**
 * Points expire 12 months after they are earned. Debits consume the oldest points first, so the
 * points still to expire are max(0, earned-and-expired − all debits so far). Re-running writes
 * nothing new.
 */
export async function expirePoints(ctx: Ctx): Promise<number> {
  const now = ctx.clock.now();
  const rows = await ctx.db.execute<{ customer_id: string; to_expire: number }>(sql`
    select customer_id,
      greatest(0,
        coalesce(sum(delta) filter (where reason in ('earn', 'import') and expires_at is not null and expires_at <= ${tsParam(now)}), 0)
        + coalesce(sum(delta) filter (where delta < 0), 0)
      )::int as to_expire
    from crm.points_ledger group by customer_id`);
  let total = 0;
  for (const r of rows) {
    if (r.to_expire <= 0) continue;
    await ctx.db.transaction(async (tx) => {
      const delta = await customers.post(tx, ctx, { customerId: r.customer_id, delta: -r.to_expire, reason: 'expire' }, { floorAtZero: true });
      total += -delta;
    });
  }
  return total;
}

/** Tier from rolling 12-month net spend; history row on change; no message is sent (FR-CRM-07). */
export async function recalcTiers(ctx: Ctx): Promise<number> {
  const now = ctx.clock.now();
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const tiers = await ctx.db.select().from(schema.tier);
  if (!tiers.length) return 0;
  const spend = await ctx.db.execute<{ id: string; tier_id: string | null; spend: string }>(sql`
    select c.id, c.tier_id,
      coalesce((select sum(s.total_vnd) from sales.sale s where s.customer_id = c.id and s.status = 'completed' and not s.is_deposit and s.sold_at >= ${tsParam(since)}), 0)
      - coalesce((select sum(r.refund_vnd) from sales.sale_return r join sales.sale s on s.id = r.sale_id where s.customer_id = c.id and r.created_at >= ${tsParam(since)}), 0) as spend
    from crm.customer c where c.anonymised_at is null`);
  let changed = 0;
  for (const c of spend) {
    const def = tierForSpend(Number(c.spend), tiers.map((t) => ({ code: t.code, name: t.name, minSpendVnd: vnd(t.minSpendVnd) })));
    const tier = tiers.find((t) => t.code === def.code)!;
    if (tier.id === c.tier_id) continue;
    await ctx.db.transaction(async (tx) => {
      await tx.update(schema.customer).set({ tierId: tier.id }).where(eq(schema.customer.id, c.id));
      await tx.insert(schema.customerTierHistory).values({ customerId: c.id, tierId: tier.id, spend12mVnd: Number(c.spend), fromAt: now });
    });
    changed++;
  }
  return changed;
}

// ---------------------------------------------------------------------------------------------
// session.cleanup, outbox dispatch, integrity.check (TDD §9.1, §9.2, §5.4)

export async function cleanupSessions(ctx: Ctx): Promise<void> {
  const now = ctx.clock.now();
  await ctx.db.delete(schema.session).where(lt(schema.session.expiresAt, now));
  await ctx.db.delete(schema.approvalToken).where(lt(schema.approvalToken.expiresAt, now));
  await ctx.db.delete(schema.idempotencyKey).where(lt(schema.idempotencyKey.expiresAt, now));
  await ctx.db.delete(schema.loginAttempt).where(lt(schema.loginAttempt.at, new Date(now.getTime() - 30 * 86_400_000)));
}

export type OutboxHandler = (ctx: Ctx, event: { id: string; type: string; payload: Record<string, unknown> }) => Promise<void>;

/**
 * At-least-once delivery from the transactional outbox (TDD §9.2): rows are claimed with
 * SKIP LOCKED, handed to subscribers and marked processed; consumers deduplicate by event id.
 */
export async function dispatchOutbox(ctx: Ctx, handlers: Partial<Record<string, OutboxHandler[]>>, limit = 100): Promise<number> {
  const o = schema.outboxEvent;
  return ctx.db.transaction(async (tx) => {
    const rows = await tx.select().from(o).where(isNull(o.processedAt)).orderBy(asc(o.createdAt)).limit(limit).for('update', { skipLocked: true });
    const done: string[] = [];
    for (const r of rows) {
      try {
        for (const h of handlers[r.type] ?? []) await h(ctx, { id: r.id, type: r.type, payload: r.payload as Record<string, unknown> });
        done.push(r.id);
      } catch {
        await tx.update(o).set({ attempts: r.attempts + 1 }).where(eq(o.id, r.id));
      }
    }
    if (done.length) await tx.update(o).set({ processedAt: ctx.clock.now() }).where(inArray(o.id, done));
    return done.length;
  });
}

export interface Drift {
  check: string;
  ref: string;
  expected: number;
  actual: number;
}

/** Nightly invariants: ledgers equal balances (TDD §5.4). Drift is returned for alerting. */
export async function integrityCheck(ctx: Ctx): Promise<Drift[]> {
  const rows = await ctx.db.execute<{ check: string; ref: string; expected: string; actual: string }>(sql`
    select 'stock_level' as check, s.variant_id::text || '/' || s.location as ref,
           coalesce((select sum(qty_delta) from inventory.stock_movement m where m.variant_id = s.variant_id and m.location = s.location), 0) as expected,
           s.on_hand as actual
    from inventory.stock_level s
    where s.on_hand <> coalesce((select sum(qty_delta) from inventory.stock_movement m where m.variant_id = s.variant_id and m.location = s.location), 0)
    union all
    select 'points_balance', c.id::text, coalesce((select sum(delta) from crm.points_ledger l where l.customer_id = c.id), 0), c.points_balance
    from crm.customer c where c.points_balance <> coalesce((select sum(delta) from crm.points_ledger l where l.customer_id = c.id), 0)
    union all
    select 'store_credit', c.id::text, coalesce((select sum(delta_vnd) from crm.store_credit_ledger l where l.customer_id = c.id), 0), c.store_credit_vnd
    from crm.customer c where c.store_credit_vnd <> coalesce((select sum(delta_vnd) from crm.store_credit_ledger l where l.customer_id = c.id), 0)`);
  return rows.map((r) => ({ check: r.check, ref: r.ref, expected: Number(r.expected), actual: Number(r.actual) }));
}


// ---------------------------------------------------------------------------------------------
// consignment.deadline_alert (FR-PUR-13, TDD §4.3)

/** Notify payables holders once per lot whose deadline is near and that still has unsold stock. */
export async function consignmentDeadlineAlert(ctx: Ctx): Promise<number> {
  const now = ctx.clock.now();
  const cfg = await settings.snapshot(ctx);
  const until = new Date(now.getTime() + cfg['purchasing.consignment_alert_days'] * 86_400_000);
  const lots = await ctx.db.execute<{ id: string; sku: string; supplier: string; deadline_at: Date; remaining: number }>(sql`
    select l.id, v.sku, s.name as supplier, l.deadline_at, (l.qty_received - l.qty_sold - l.qty_returned)::int as remaining
    from purchasing.consignment_lot l join catalog.item_variant v on v.id = l.variant_id join purchasing.supplier s on s.id = l.supplier_id
    where l.deadline_at is not null and l.deadline_at <= ${tsParam(until)} and l.qty_received - l.qty_sold - l.qty_returned > 0
      and not exists (select 1 from platform.notification n where n.template = 'consignment.deadline' and n.vars ->> 'lotId' = l.id::text)`);
  for (const lot of lots) {
    await ctx.db.transaction((tx) =>
      notifications.notifyHolders(tx, 'purchasing.payables', 'consignment.deadline', { lotId: lot.id, sku: lot.sku, supplier: lot.supplier, deadlineAt: lot.deadline_at, remaining: lot.remaining }),
    );
  }
  return lots.length;
}
