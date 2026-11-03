import { schema } from '@bookstore/db';
import {
  canTransition,
  DEPOSIT_METHODS,
  divRoundHalfUp,
  foldText,
  normalizePaymentRef,
  normalizePhone,
  ORDER_SOURCES,
  PAYMENT_REF_ALPHABET,
  PAYMENT_REF_LENGTH,
  PREORDER,
} from '@bookstore/domain';
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as customers from '../customers/index.js';
import * as inventory from '../inventory/index.js';
import * as notifications from '../notifications/index.js';
import * as settings from '../settings/index.js';
import { AppError, errors, nextDocNo, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/**
 * Pre-orders at the POS (FR-POS-09, FR-ORD-14..16, TDD §4.5). The deposit is taken at the counter and held for the customer; collecting is a
 * counter sale with `preorderId` (sales module), at the agreed price with the deposit counted as paid.
 */

type PreorderRow = typeof schema.preorder.$inferSelect;

// =============================================================================================
// Deposits at the counter

export const DepositSchema = z
  .object({
    method: z.enum(DEPOSIT_METHODS),
    amountVnd: z.number().int().positive(),
    /** The staff member's open shift: cash goes into its drawer. */
    shiftId: z.uuid().optional(),
    /** Transfer payment reference the customer typed, or the card approval code. */
    ref: z.string().trim().max(40).optional(),
  })
  .superRefine((d, c) => {
    if (d.method === 'cash' && !d.shiftId) c.addIssue({ code: 'custom', path: ['shiftId'], message: 'Cần một ca đang mở để nhận tiền mặt.' });
    if (d.method === 'transfer') {
      const ref = normalizePaymentRef(d.ref ?? '');
      if (ref.length !== PAYMENT_REF_LENGTH || ![...ref].every((ch) => PAYMENT_REF_ALPHABET.includes(ch))) c.addIssue({ code: 'custom', path: ['ref'], message: 'Mã tham chiếu chuyển khoản không hợp lệ.' });
    }
    if (d.method === 'card' && !d.ref) c.addIssue({ code: 'custom', path: ['ref'], message: 'Cần nhập mã chuẩn chi của máy POS thẻ.' });
  });

async function openShift(tx: Tx, shiftId: string) {
  const [s] = await tx.select({ id: schema.shift.id, closedAt: schema.shift.closedAt }).from(schema.shift).where(eq(schema.shift.id, shiftId));
  if (!s || s.closedAt) throw errors.conflict('shift_closed', 'Ca làm đã đóng. Hãy mở ca ở màn hình Bán hàng để nhận hoặc trả tiền mặt.');
  return s.id;
}

async function takeDeposit(tx: Tx, ctx: Ctx, docNo: string, d: z.infer<typeof DepositSchema>) {
  if (d.method === 'cash') {
    await openShift(tx, d.shiftId!);
    await tx.insert(schema.cashMovement).values({ shiftId: d.shiftId!, direction: 'in', amountVnd: d.amountVnd, reason: `Cọc ${docNo}`, createdBy: ctx.actor!.userId, at: ctx.clock.now() });
  }
  return {
    depositVnd: d.amountVnd,
    depositMethod: d.method,
    depositRef: d.method === 'transfer' ? normalizePaymentRef(d.ref!) : (d.ref ?? null),
    depositShiftId: d.method === 'cash' ? d.shiftId! : null,
  };
}

/** BR-10: a deposit of at least `preorder.deposit_pct` of the value, or full payment. */
async function checkDeposit(tx: Tx, ctx: Ctx, valueVnd: number, depositVnd: number) {
  const pct = (await settings.snapshot(ctx, tx))['preorder.deposit_pct'];
  const min = divRoundHalfUp(valueVnd * pct, 100);
  if (depositVnd < min || depositVnd > valueVnd) {
    throw new AppError(422, 'deposit_out_of_range', `Tiền cọc từ ${min} ₫ (${pct}%) đến ${valueVnd} ₫ (trả đủ).`, { minVnd: min, maxVnd: valueVnd });
  }
}

const CustomerRef = z.union([z.object({ customerId: z.uuid() }), z.object({ name: z.string().trim().min(1).max(160), phone: z.string().trim().min(6) })]);

async function customerOf(tx: Tx, ctx: Ctx, c: z.infer<typeof CustomerRef>, source: string): Promise<string> {
  if ('customerId' in c) {
    const [row] = await tx.select({ id: schema.customer.id }).from(schema.customer).where(eq(schema.customer.id, c.customerId));
    if (!row) throw errors.notFound('Khách hàng');
    return row.id;
  }
  const phoneE164 = normalizePhone(c.phone);
  if (!phoneE164) throw new AppError(400, 'invalid_phone', `Số điện thoại '${c.phone}' không hợp lệ.`);
  const [found] = await tx.select({ id: schema.customer.id }).from(schema.customer).where(eq(schema.customer.phoneE164, phoneE164));
  if (found) return found.id;
  return (await customers.createCustomerTx(tx, ctx, { name: c.name, phone: c.phone, source })).id;
}

// =============================================================================================
// Pre-orders (FR-ORD-14)

export const CreatePreorderSchema = z.object({
  /** Pre-orders taken at the POS have no channel (`other`). */
  source: z.enum(ORDER_SOURCES).default('other'),
  customer: CustomerRef,
  lines: z
    .array(z.object({ variantId: z.uuid(), qty: z.number().int().positive().max(100) }))
    .min(1, 'Phiếu chưa có sản phẩm.')
    .max(30)
    .refine((ls) => new Set(ls.map((l) => l.variantId)).size === ls.length, 'Mỗi sản phẩm chỉ một dòng.'),
  deposit: DepositSchema,
  note: z.string().trim().max(500).nullable().optional(),
});

export async function createPreorder(ctx: Ctx, input: z.input<typeof CreatePreorderSchema>) {
  const actor = requirePermission(ctx, 'sale.create');
  const data = CreatePreorderSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const variants = await tx
      .select({ id: schema.itemVariant.id, priceVnd: schema.itemVariant.priceVnd, status: schema.itemVariant.status })
      .from(schema.itemVariant)
      .where(inArray(schema.itemVariant.id, data.lines.map((l) => l.variantId)));
    const price = new Map(variants.filter((v) => v.status === 'active').map((v) => [v.id, v.priceVnd]));
    if (data.lines.some((l) => !price.has(l.variantId))) throw errors.notFound('Sản phẩm');
    await checkDeposit(tx, ctx, data.lines.reduce((a, l) => a + price.get(l.variantId)! * l.qty, 0), data.deposit.amountVnd);
    const customerId = await customerOf(tx, ctx, data.customer, data.source);
    const now = ctx.clock.now();
    const docNo = await nextDocNo(tx, 'PRE', now);
    const [row] = await tx
      .insert(schema.preorder)
      .values({ docNo, source: data.source, customerId, ...(await takeDeposit(tx, ctx, docNo, data.deposit)), note: data.note ?? null, createdBy: actor.userId, createdAt: now })
      .returning({ id: schema.preorder.id });
    await tx.insert(schema.preorderLine).values(data.lines.map((l, i) => ({ preorderId: row!.id, lineNo: i + 1, variantId: l.variantId, qty: l.qty, unitPriceVnd: price.get(l.variantId)! })));
    await audit.record(tx, ctx, { action: 'preorder.create', entity: 'preorder', entityId: row!.id, after: { docNo, lines: data.lines, depositVnd: data.deposit.amountVnd } });
    // Copies already in stock are held at once (oldest pre-order first).
    await allocateTx(tx, ctx, data.lines.map((l) => l.variantId));
    const [after] = await tx.select({ status: schema.preorder.status }).from(schema.preorder).where(eq(schema.preorder.id, row!.id));
    return { id: row!.id, docNo, status: after!.status };
  });
}

/**
 * `preorder.allocate` (on `stock_in.posted`): incoming stock goes to the waiting lines oldest
 * pre-order first; per variant the queue stops at the first line that does not fit, so a later
 * pre-order never jumps ahead. A pre-order whose lines are all held becomes Arrived. Returns how
 * many pre-orders became Arrived.
 */
async function allocateTx(tx: Tx, ctx: Ctx, variantIds: string[]): Promise<number> {
  if (!variantIds.length) return 0;
  const waiting = await tx.execute<{ line_id: string; preorder_id: string; variant_id: string; qty: number }>(sql`
    select l.id as line_id, l.preorder_id, l.variant_id, l.qty
    from orders.preorder_line l join orders.preorder p on p.id = l.preorder_id
    where p.status in ('reserved', 'ordered') and l.reserved_at is null
      and l.variant_id in (${sql.join([...new Set(variantIds)].map((v) => sql`${v}::uuid`), sql`, `)})
    order by l.variant_id, p.created_at, p.id for update of l skip locked`);
  const blocked = new Set<string>();
  const touched = new Set<string>();
  for (const l of waiting) {
    if (blocked.has(l.variant_id)) continue;
    if (!(await inventory.reserve(tx, ctx, 'preorder', l.preorder_id, l.variant_id, l.qty))) {
      blocked.add(l.variant_id);
      continue;
    }
    await tx.update(schema.preorderLine).set({ reservedAt: ctx.clock.now() }).where(eq(schema.preorderLine.id, l.line_id));
    touched.add(l.preorder_id);
  }
  let n = 0;
  for (const id of touched) {
    const [left] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from orders.preorder_line where preorder_id = ${id}::uuid and reserved_at is null`);
    if (left!.n > 0) continue;
    // Arrived: staff call the customer from the pre-order (FR-ORD-14).
    await tx.update(schema.preorder).set({ status: 'arrived', allocatedAt: ctx.clock.now() }).where(eq(schema.preorder.id, id));
    n++;
  }
  return n;
}

async function linesOf(tx: Tx, preorderId: string) {
  return tx.select().from(schema.preorderLine).where(eq(schema.preorderLine.preorderId, preorderId)).orderBy(asc(schema.preorderLine.lineNo));
}

export async function allocatePreorders(ctx: Ctx, variantIds: string[]): Promise<number> {
  return ctx.db.transaction((tx) => allocateTx(tx, ctx, variantIds));
}

async function lockPreorder(tx: Tx, id: string): Promise<PreorderRow> {
  const [row] = await tx.select().from(schema.preorder).where(eq(schema.preorder.id, id)).for('update');
  if (!row) throw errors.notFound('Phiếu đặt trước');
  return row;
}

function assertTransition(row: { status: string; docNo: string }, to: string) {
  if (!canTransition(PREORDER as Record<string, readonly string[]>, row.status, to)) {
    throw errors.conflict('invalid_transition', `Phiếu đặt trước ${row.docNo} không chuyển sang trạng thái này được.`, { from: row.status, to });
  }
}

export async function markOrdered(ctx: Ctx, id: string) {
  requirePermission(ctx, 'sale.create');
  return ctx.db.transaction(async (tx) => {
    const row = await lockPreorder(tx, id);
    assertTransition(row, 'ordered');
    await tx.update(schema.preorder).set({ status: 'ordered' }).where(eq(schema.preorder.id, id));
    return { id, status: 'ordered' };
  });
}

/** “Đã liên hệ”: staff called the customer; the holding period starts (FR-ORD-16, BR-10). */
export async function markPreorderContacted(ctx: Ctx, id: string) {
  requirePermission(ctx, 'sale.create');
  return ctx.db.transaction((tx) => contactedTx(tx, ctx, id));
}

async function contactedTx(tx: Tx, ctx: Ctx, id: string) {
  const row = await lockPreorder(tx, id);
  assertTransition(row, 'contacted');
  const now = ctx.clock.now();
  const days = (await settings.snapshot(ctx, tx))['preorder.hold_days'];
  const expiresAt = new Date(now.getTime() + days * 86_400_000);
  await tx.update(schema.preorder).set({ status: 'contacted', contactedAt: now, expiresAt }).where(eq(schema.preorder.id, id));
  return { id, status: 'contacted', expiresAt };
}

export const CancelHoldSchema = z
  .object({
    reason: z.string().trim().min(1, 'Cần nhập lý do hủy.').max(500),
    /** Deposit policy (FR-ORD-16): give it back or keep it. */
    deposit: z.enum(['refund', 'forfeit']),
    shiftId: z.uuid().optional(),
    refundRef: z.string().trim().max(120).optional(),
  })
  .refine((d) => d.deposit === 'forfeit' || d.shiftId || d.refundRef, { message: 'Hoàn cọc tiền mặt cần một ca đang mở; chuyển khoản hoặc thẻ cần mã giao dịch hoàn tiền.', path: ['refundRef'] });

export async function cancelPreorder(ctx: Ctx, id: string, input: z.input<typeof CancelHoldSchema>) {
  requirePermission(ctx, 'sale.create');
  const data = CancelHoldSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const row = await lockPreorder(tx, id);
    assertTransition(row, 'cancelled');
    if (data.deposit === 'refund' && row.depositVnd > 0) {
      if (row.depositMethod === 'cash') {
        if (!data.shiftId) throw new AppError(400, 'shift_required', 'Hoàn cọc tiền mặt cần một ca đang mở.');
        await openShift(tx, data.shiftId);
        await tx.insert(schema.cashMovement).values({ shiftId: data.shiftId, direction: 'out', amountVnd: row.depositVnd, reason: `Hoàn cọc ${row.docNo}`, createdBy: ctx.actor!.userId, at: ctx.clock.now() });
      } else if (!data.refundRef) {
        throw new AppError(400, 'refund_ref_required', 'Cần nhập mã giao dịch hoàn tiền chuyển khoản hoặc thẻ.');
      }
    }
    await inventory.endReservations(tx, ctx, 'preorder', id, 'released');
    await tx
      .update(schema.preorder)
      .set({ status: 'cancelled', cancelReason: data.reason, depositOutcome: row.depositVnd > 0 ? (data.deposit === 'refund' ? 'refunded' : 'forfeited') : null, refundRef: data.refundRef ?? null })
      .where(eq(schema.preorder.id, id));
    await audit.record(tx, ctx, { action: 'preorder.cancel', entity: 'preorder', entityId: id, after: { reason: data.reason, deposit: data.deposit, depositVnd: row.depositVnd } });
    // Released copies may go to the next pre-orders in the queue.
    await allocateTx(tx, ctx, (await linesOf(tx, id)).map((l) => l.variantId));
    return { id, status: 'cancelled', depositOutcome: data.deposit };
  });
}

// =============================================================================================
// List for the POS pre-order dialog

export const HoldsQuery = z.object({
  status: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  overdue: z.enum(['true', 'false']).optional(),
});

export async function listPreorders(ctx: Ctx, input: z.input<typeof HoldsQuery>) {
  requirePermission(ctx, 'sale.create');
  const q = HoldsQuery.parse(input);
  const p = schema.preorder;
  const where: SQL[] = [];
  const statuses = q.status?.split(',').filter(Boolean);
  if (statuses?.length) where.push(inArray(p.status, statuses));
  if (q.overdue === 'true') where.push(and(eq(p.status, 'contacted'), lt(p.expiresAt, ctx.clock.now()))!);
  if (q.q) {
    const digits = q.q.replace(/\D/g, '');
    where.push(
      sql`(${p.docNo} ilike ${`%${q.q}%`} or ${schema.customer.searchText} like ${`%${foldText(q.q)}%`} ${digits.length >= 4 ? sql`or ${schema.customer.phoneE164} like ${`%${digits.slice(-9)}%`}` : sql``}
           or exists (select 1 from orders.preorder_line l join catalog.item_variant v on v.id = l.variant_id where l.preorder_id = ${p.id} and v.sku = ${q.q}))`,
    );
  }
  return ctx.db
    .select({
      id: p.id,
      docNo: p.docNo,
      status: p.status,
      createdAt: p.createdAt,
      lines: sql<{ variantId: string; sku: string; title: string; qty: number; unitPriceVnd: number; held: boolean }[]>`(
        select coalesce(json_agg(json_build_object(
          'variantId', l.variant_id, 'sku', v.sku, 'qty', l.qty, 'unitPriceVnd', l.unit_price_vnd, 'held', l.reserved_at is not null,
          'title', coalesce(nullif(i.i18n -> 'vi' ->> 'title', ''), i.i18n -> 'en' ->> 'title')) order by l.line_no), '[]'::json)
        from orders.preorder_line l join catalog.item_variant v on v.id = l.variant_id join catalog.item i on i.id = v.item_id
        where l.preorder_id = ${p.id})`,
      totalVnd: sql<number>`(select coalesce(sum(l.qty * l.unit_price_vnd), 0)::int from orders.preorder_line l where l.preorder_id = ${p.id})`,
      depositVnd: p.depositVnd,
      depositMethod: p.depositMethod,
      contactedAt: p.contactedAt,
      expiresAt: p.expiresAt,
      saleId: p.saleId,
      customerId: p.customerId,
      customerName: schema.customer.name,
      customerPhone: schema.customer.phoneE164,
      customerTierCode: sql<string | null>`(select t.code from crm.tier t where t.id = ${schema.customer.tierId})`,
      customerPoints: schema.customer.pointsBalance,
    })
    .from(p)
    .innerJoin(schema.customer, eq(schema.customer.id, p.customerId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(p.createdAt))
    .limit(200);
}

/** `preorder.expire` (daily): alert once about holds past the holding period; staff decide (FR-ORD-16). */
export async function notifyExpiredHolds(ctx: Ctx): Promise<number> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const p = schema.preorder;
    const rows = await tx
      .update(p)
      .set({ overdueNotifiedAt: now })
      .where(and(eq(p.status, 'contacted'), lt(p.expiresAt, now), sql`${p.overdueNotifiedAt} is null`))
      .returning({ id: p.id, docNo: p.docNo });
    for (const r of rows) await notifications.notifyHolders(tx, 'sale.create', 'order.needs_action', { kind: 'preorder', id: r.id, docNo: r.docNo, reason: 'hold_expired' });
    return rows.length;
  });
}
