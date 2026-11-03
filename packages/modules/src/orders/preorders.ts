import { schema } from '@bookstore/db';
import {
  canTransition,
  DELIVERY_MODES,
  DEPOSIT_METHODS,
  divRoundHalfUp,
  normalizePaymentRef,
  normalizePhone,
  ORDER_PAYMENT_METHODS,
  ORDER_SOURCES,
  PAYMENT_REF_ALPHABET,
  PAYMENT_REF_LENGTH,
  PREORDER,
  SPECIAL_ORDER,
} from '@bookstore/domain';
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as customers from '../customers/index.js';
import * as inventory from '../inventory/index.js';
import * as notifications from '../notifications/index.js';
import * as settings from '../settings/index.js';
import { AppError, emit, errors, nextDocNo, requirePermission, type Ctx, type Tx } from '../platform/index.js';
import { createContactTask, createOrderTx, CreateOrderSchema } from './index.js';

/**
 * Pre-orders and special orders (FR-ORD-14..16, FR-POS-09, TDD §4.5) and the to-notify worklist
 * (FR-ORD-18). The deposit is taken at the counter and held for the customer; collecting creates
 * an online order at the agreed price less the deposit.
 */

type Kind = 'preorder' | 'special_order';
type PreorderRow = typeof schema.preorder.$inferSelect;
type SpecialRow = typeof schema.specialOrder.$inferSelect;

const money = z.number().int().min(0);

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
  source: z.enum(ORDER_SOURCES).default('other'),
  customer: CustomerRef,
  variantId: z.uuid(),
  qty: z.number().int().positive().max(100),
  deposit: DepositSchema,
  note: z.string().trim().max(500).nullable().optional(),
});

export async function createPreorder(ctx: Ctx, input: z.input<typeof CreatePreorderSchema>) {
  const actor = requirePermission(ctx, 'online.manage');
  const data = CreatePreorderSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [v] = await tx
      .select({ id: schema.itemVariant.id, priceVnd: schema.itemVariant.priceVnd, status: schema.itemVariant.status })
      .from(schema.itemVariant)
      .where(eq(schema.itemVariant.id, data.variantId));
    if (!v || v.status !== 'active') throw errors.notFound('Sản phẩm');
    await checkDeposit(tx, ctx, v.priceVnd * data.qty, data.deposit.amountVnd);
    const customerId = await customerOf(tx, ctx, data.customer, data.source);
    const now = ctx.clock.now();
    const docNo = await nextDocNo(tx, 'PRE', now);
    const [row] = await tx
      .insert(schema.preorder)
      .values({ docNo, source: data.source, customerId, variantId: v.id, qty: data.qty, unitPriceVnd: v.priceVnd, ...(await takeDeposit(tx, ctx, docNo, data.deposit)), note: data.note ?? null, createdBy: actor.userId, createdAt: now })
      .returning({ id: schema.preorder.id });
    await audit.record(tx, ctx, { action: 'preorder.create', entity: 'preorder', entityId: row!.id, after: { docNo, qty: data.qty, depositVnd: data.deposit.amountVnd } });
    // A copy that is already in stock is allocated at once (oldest pre-order first).
    await allocateTx(tx, ctx, [v.id]);
    const [after] = await tx.select({ status: schema.preorder.status }).from(schema.preorder).where(eq(schema.preorder.id, row!.id));
    return { id: row!.id, docNo, status: after!.status };
  });
}

/**
 * `preorder.allocate` (on `stock_in.posted`): incoming stock goes to pre-orders oldest first; the
 * queue stops at the first one that does not fit, so a later order never jumps ahead.
 */
async function allocateTx(tx: Tx, ctx: Ctx, variantIds: string[]): Promise<number> {
  if (!variantIds.length) return 0;
  const cfg = await settings.snapshot(ctx, tx);
  const waiting = await tx.execute<{ id: string; variant_id: string; qty: number; doc_no: string; customer_id: string }>(sql`
    select id, variant_id, qty, doc_no, customer_id from orders.preorder
    where status in ('reserved', 'ordered') and variant_id in (${sql.join(variantIds.map((v) => sql`${v}::uuid`), sql`, `)})
    order by variant_id, created_at, id for update skip locked`);
  const blocked = new Set<string>();
  let n = 0;
  for (const p of waiting) {
    if (blocked.has(p.variant_id)) continue;
    if (!(await inventory.reserve(tx, ctx, 'preorder', p.id, p.variant_id, p.qty))) {
      blocked.add(p.variant_id);
      continue;
    }
    const now = ctx.clock.now();
    await tx.update(schema.preorder).set({ status: 'arrived', allocatedAt: now }).where(eq(schema.preorder.id, p.id));
    await notifyArrived(tx, ctx, 'preorder', p.id, p.doc_no, p.customer_id, cfg['contact_task.due_hours']);
    n++;
  }
  return n;
}

export async function allocatePreorders(ctx: Ctx, variantIds: string[]): Promise<number> {
  return ctx.db.transaction((tx) => allocateTx(tx, ctx, variantIds));
}

async function notifyArrived(tx: Tx, ctx: Ctx, kind: Kind, id: string, docNo: string, customerId: string, dueHours: number) {
  const [c] = await tx.select({ name: schema.customer.name, phone: schema.customer.phoneE164 }).from(schema.customer).where(eq(schema.customer.id, customerId));
  await createContactTask(tx, ctx, {
    reason: kind === 'preorder' ? 'preorder_arrived' : 'special_order_arrived',
    customerId,
    name: c?.name ?? '',
    phone: c?.phone ?? null,
    refType: kind,
    refId: id,
    refLabel: docNo,
    dueAt: new Date(ctx.clock.now().getTime() + dueHours * 3600_000),
  });
}

// =============================================================================================
// Special orders (FR-ORD-15)

export const CreateSpecialOrderSchema = z.object({
  source: z.enum(ORDER_SOURCES).default('other'),
  customer: CustomerRef,
  requestedTitle: z.string().trim().min(1, 'Cần nhập tên sách.').max(300),
  isbn: z.string().trim().max(20).nullable().optional(),
  qty: z.number().int().positive().max(100).default(1),
  quoteVnd: z.number().int().positive(),
  deposit: DepositSchema,
  note: z.string().trim().max(500).nullable().optional(),
});

export async function createSpecialOrder(ctx: Ctx, input: z.input<typeof CreateSpecialOrderSchema>) {
  const actor = requirePermission(ctx, 'online.manage');
  const data = CreateSpecialOrderSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    await checkDeposit(tx, ctx, data.quoteVnd * data.qty, data.deposit.amountVnd);
    const customerId = await customerOf(tx, ctx, data.customer, data.source);
    const now = ctx.clock.now();
    const docNo = await nextDocNo(tx, 'SPO', now);
    const [row] = await tx
      .insert(schema.specialOrder)
      .values({
        docNo,
        source: data.source,
        customerId,
        requestedTitle: data.requestedTitle,
        isbn: data.isbn ?? null,
        qty: data.qty,
        quoteVnd: data.quoteVnd,
        ...(await takeDeposit(tx, ctx, docNo, data.deposit)),
        note: data.note ?? null,
        createdBy: actor.userId,
        createdAt: now,
      })
      .returning({ id: schema.specialOrder.id });
    await audit.record(tx, ctx, { action: 'special_order.create', entity: 'special_order', entityId: row!.id, after: { docNo, quoteVnd: data.quoteVnd, depositVnd: data.deposit.amountVnd } });
    return { id: row!.id, docNo, status: 'requested' };
  });
}

// =============================================================================================
// Shared lifecycle

const TABLE = { preorder: schema.preorder, special_order: schema.specialOrder } as const;
const MACHINE = { preorder: PREORDER, special_order: SPECIAL_ORDER } as const;
const LABEL = { preorder: 'Phiếu đặt trước', special_order: 'Đơn đặt riêng' } as const;

async function lockRow(tx: Tx, kind: Kind, id: string): Promise<PreorderRow | SpecialRow> {
  const t = TABLE[kind];
  const [row] = await tx.select().from(t).where(eq(t.id, id)).for('update');
  if (!row) throw errors.notFound(LABEL[kind]);
  return row;
}

function assertTransition(kind: Kind, row: { status: string; docNo: string }, to: string) {
  const machine = MACHINE[kind] as Record<string, readonly string[]>;
  if (!canTransition(machine, row.status, to)) throw errors.conflict('invalid_transition', `${LABEL[kind]} ${row.docNo} không chuyển sang trạng thái này được.`, { from: row.status, to });
}

export async function markOrdered(ctx: Ctx, kind: Kind, id: string) {
  requirePermission(ctx, 'online.manage');
  return ctx.db.transaction(async (tx) => {
    const row = await lockRow(tx, kind, id);
    assertTransition(kind, row, 'ordered');
    await tx
      .update(TABLE[kind])
      .set({ status: 'ordered', ...(kind === 'special_order' && { orderedAt: ctx.clock.now() }) })
      .where(eq(TABLE[kind].id, id));
    return { id, status: 'ordered' };
  });
}

export const ArrivedSchema = z.object({ variantId: z.uuid() });

/** Special order arrived: linked to the product it was stocked in as, the copies held, customer to call. */
export async function specialOrderArrived(ctx: Ctx, id: string, input: z.input<typeof ArrivedSchema>) {
  requirePermission(ctx, 'online.manage');
  const { variantId } = ArrivedSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const row = (await lockRow(tx, 'special_order', id)) as SpecialRow;
    assertTransition('special_order', row, 'arrived');
    if (!(await inventory.reserve(tx, ctx, 'special_order', id, variantId, row.qty))) {
      throw new AppError(409, 'insufficient_stock', `Chưa có đủ ${row.qty} cuốn trong kho. Hãy nhập hàng cho sản phẩm này trước.`);
    }
    await tx.update(schema.specialOrder).set({ status: 'arrived', variantId, arrivedAt: ctx.clock.now() }).where(eq(schema.specialOrder.id, id));
    await notifyArrived(tx, ctx, 'special_order', id, row.docNo, row.customerId, (await settings.snapshot(ctx, tx))['contact_task.due_hours']);
    return { id, status: 'arrived' };
  });
}

/** Contacted from the worklist: the holding period starts (FR-ORD-16, BR-10). */
async function contactedTx(tx: Tx, ctx: Ctx, kind: Kind, id: string): Promise<void> {
  const row = await lockRow(tx, kind, id);
  if (row.status !== 'arrived') return;
  const now = ctx.clock.now();
  const days = (await settings.snapshot(ctx, tx))['preorder.hold_days'];
  await tx
    .update(TABLE[kind])
    .set({ status: 'contacted', contactedAt: now, expiresAt: new Date(now.getTime() + days * 86_400_000) })
    .where(eq(TABLE[kind].id, id));
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

export async function cancelHold(ctx: Ctx, kind: Kind, id: string, input: z.input<typeof CancelHoldSchema>) {
  requirePermission(ctx, 'online.manage');
  const data = CancelHoldSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const row = await lockRow(tx, kind, id);
    assertTransition(kind, row, 'cancelled');
    if (data.deposit === 'refund' && row.depositVnd > 0) {
      if (row.depositMethod === 'cash') {
        if (!data.shiftId) throw new AppError(400, 'shift_required', 'Hoàn cọc tiền mặt cần một ca đang mở.');
        await openShift(tx, data.shiftId);
        await tx.insert(schema.cashMovement).values({ shiftId: data.shiftId, direction: 'out', amountVnd: row.depositVnd, reason: `Hoàn cọc ${row.docNo}`, createdBy: ctx.actor!.userId, at: ctx.clock.now() });
      } else if (!data.refundRef) {
        throw new AppError(400, 'refund_ref_required', 'Cần nhập mã giao dịch hoàn tiền chuyển khoản hoặc thẻ.');
      }
    }
    await inventory.endReservations(tx, ctx, kind, id, 'released');
    await tx
      .update(TABLE[kind])
      .set({ status: 'cancelled', cancelReason: data.reason, depositOutcome: row.depositVnd > 0 ? (data.deposit === 'refund' ? 'refunded' : 'forfeited') : null, refundRef: data.refundRef ?? null })
      .where(eq(TABLE[kind].id, id));
    await tx.update(schema.contactTask).set({ status: 'cancelled' }).where(and(eq(schema.contactTask.refType, kind), eq(schema.contactTask.refId, id), eq(schema.contactTask.status, 'open')));
    await audit.record(tx, ctx, { action: `${kind}.cancel`, entity: kind, entityId: id, after: { reason: data.reason, deposit: data.deposit, depositVnd: row.depositVnd } });
    // A released copy may go to the next pre-order in the queue.
    const variantId = 'variantId' in row ? row.variantId : null;
    if (variantId) await allocateTx(tx, ctx, [variantId]);
    return { id, status: 'cancelled', depositOutcome: data.deposit };
  });
}

export const CollectSchema = z.object({
  delivery: z.enum(DELIVERY_MODES),
  address: z
    .object({ provinceId: z.number().int().optional(), wardCode: z.string().trim().max(20).optional(), line: z.string().trim().max(300).default('') })
    .nullable()
    .optional(),
  paymentMethod: z.enum(ORDER_PAYMENT_METHODS),
  shippingVnd: money.default(0),
  recipient: z.object({ name: z.string().trim().min(1).max(160), phone: z.string().trim().min(6) }).optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

/** Collect: the held copy becomes an online order at the agreed price less the deposit (FR-ORD-14). */
export async function collect(ctx: Ctx, kind: Kind, id: string, input: z.input<typeof CollectSchema>) {
  const actor = requirePermission(ctx, 'online.manage');
  const data = CollectSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const row = await lockRow(tx, kind, id);
    assertTransition(kind, row, 'collected');
    const variantId = 'unitPriceVnd' in row ? row.variantId : row.variantId!;
    const unitPrice = 'unitPriceVnd' in row ? row.unitPriceVnd : row.quoteVnd;
    const [c] = await tx.select({ name: schema.customer.name, phone: schema.customer.phoneE164 }).from(schema.customer).where(eq(schema.customer.id, row.customerId));
    const recipient = data.recipient ?? { name: c!.name, phone: c!.phone ?? '' };
    // The held copy moves from the pre-order to the order in this transaction.
    await inventory.endReservations(tx, ctx, kind, id, 'released');
    const order = await createOrderTx(
      tx,
      ctx,
      CreateOrderSchema.parse({
        source: row.source,
        customerId: row.customerId,
        recipient,
        delivery: data.delivery,
        address: data.address ?? null,
        paymentMethod: data.paymentMethod,
        shippingVnd: data.delivery === 'ship' ? data.shippingVnd : 0,
        lines: [{ variantId, qty: row.qty }],
        sourceRef: row.docNo,
        note: data.note ?? row.note,
      }),
      { createdBy: actor.userId, agreedPrices: new Map([[variantId, unitPrice]]), depositVnd: row.depositVnd },
    );
    await tx.update(TABLE[kind]).set({ status: 'collected', orderId: order.id }).where(eq(TABLE[kind].id, id));
    await tx
      .update(schema.contactTask)
      .set({ status: 'contacted', contactedAt: ctx.clock.now(), contactedBy: actor.userId })
      .where(and(eq(schema.contactTask.refType, kind), eq(schema.contactTask.refId, id), eq(schema.contactTask.status, 'open')));
    await emit(tx, `${kind}.collected`, { id, orderId: order.id });
    return { id, status: 'collected', order };
  });
}

// =============================================================================================
// Lists and records

export const HoldsQuery = z.object({
  status: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  overdue: z.enum(['true', 'false']).optional(),
});

export async function listPreorders(ctx: Ctx, input: z.input<typeof HoldsQuery>) {
  requirePermission(ctx, 'online.manage');
  const q = HoldsQuery.parse(input);
  const p = schema.preorder;
  const where: SQL[] = [];
  const statuses = q.status?.split(',').filter(Boolean);
  if (statuses?.length) where.push(inArray(p.status, statuses));
  if (q.overdue === 'true') where.push(and(eq(p.status, 'contacted'), lt(p.expiresAt, ctx.clock.now()))!);
  if (q.q) where.push(sql`(${p.docNo} ilike ${`%${q.q}%`} or ${schema.customer.searchText} like ${`%${q.q.toLowerCase()}%`} or ${schema.itemVariant.sku} = ${q.q})`);
  return ctx.db
    .select({
      id: p.id,
      docNo: p.docNo,
      status: p.status,
      createdAt: p.createdAt,
      qty: p.qty,
      unitPriceVnd: p.unitPriceVnd,
      depositVnd: p.depositVnd,
      contactedAt: p.contactedAt,
      expiresAt: p.expiresAt,
      orderId: p.orderId,
      customerId: p.customerId,
      customerName: schema.customer.name,
      customerPhone: schema.customer.phoneE164,
      sku: schema.itemVariant.sku,
      title: sql<string>`(select coalesce(nullif(i.i18n -> 'vi' ->> 'title', ''), i.i18n -> 'en' ->> 'title') from catalog.item i where i.id = ${schema.itemVariant.itemId})`,
    })
    .from(p)
    .innerJoin(schema.customer, eq(schema.customer.id, p.customerId))
    .innerJoin(schema.itemVariant, eq(schema.itemVariant.id, p.variantId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(p.createdAt))
    .limit(200);
}

export async function listSpecialOrders(ctx: Ctx, input: z.input<typeof HoldsQuery>) {
  requirePermission(ctx, 'online.manage');
  const q = HoldsQuery.parse(input);
  const s = schema.specialOrder;
  const where: SQL[] = [];
  const statuses = q.status?.split(',').filter(Boolean);
  if (statuses?.length) where.push(inArray(s.status, statuses));
  if (q.overdue === 'true') where.push(and(eq(s.status, 'contacted'), lt(s.expiresAt, ctx.clock.now()))!);
  if (q.q) where.push(sql`(${s.docNo} ilike ${`%${q.q}%`} or ${schema.customer.searchText} like ${`%${q.q.toLowerCase()}%`} or lower(public.f_unaccent(${s.requestedTitle})) like ${`%${q.q.toLowerCase()}%`} or ${s.isbn} = ${q.q})`);
  return ctx.db
    .select({
      id: s.id,
      docNo: s.docNo,
      status: s.status,
      createdAt: s.createdAt,
      requestedTitle: s.requestedTitle,
      isbn: s.isbn,
      qty: s.qty,
      quoteVnd: s.quoteVnd,
      depositVnd: s.depositVnd,
      variantId: s.variantId,
      contactedAt: s.contactedAt,
      expiresAt: s.expiresAt,
      orderId: s.orderId,
      customerId: s.customerId,
      customerName: schema.customer.name,
      customerPhone: schema.customer.phoneE164,
    })
    .from(s)
    .innerJoin(schema.customer, eq(schema.customer.id, s.customerId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(s.createdAt))
    .limit(200);
}

// =============================================================================================
// To-notify worklist (FR-ORD-18, UC-19)

export const TasksQuery = z.object({ reason: z.string().optional(), status: z.enum(['open', 'contacted', 'cancelled']).default('open') });

/** Card list sorted by deadline, overdue first (Design §12.8). */
export async function listTasks(ctx: Ctx, input: z.input<typeof TasksQuery>) {
  requirePermission(ctx, 'contact_task.manage');
  const q = TasksQuery.parse(input);
  const t = schema.contactTask;
  const reasons = q.reason?.split(',').filter(Boolean);
  const rows = await ctx.db
    .select()
    .from(t)
    .where(and(eq(t.status, q.status), reasons?.length ? inArray(t.reason, reasons) : undefined))
    .orderBy(q.status === 'open' ? asc(t.dueAt) : desc(t.contactedAt))
    .limit(200);
  const now = ctx.clock.now().getTime();
  return rows.map((r) => ({ ...r, overdue: r.status === 'open' && r.dueAt.getTime() < now }));
}

export const ContactNoteSchema = z.object({ note: z.string().trim().max(500).optional() });

export async function markContacted(ctx: Ctx, id: string, input: z.input<typeof ContactNoteSchema>) {
  const actor = requirePermission(ctx, 'contact_task.manage');
  const { note } = ContactNoteSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [task] = await tx.select().from(schema.contactTask).where(eq(schema.contactTask.id, id)).for('update');
    if (!task) throw errors.notFound('Việc cần liên hệ');
    if (task.status !== 'open') throw errors.conflict('task_closed', 'Việc này đã xong.');
    await tx
      .update(schema.contactTask)
      .set({ status: 'contacted', contactedBy: actor.userId, contactedAt: ctx.clock.now(), ...(note && { note: task.note ? `${task.note}\n${note}` : note }) })
      .where(eq(schema.contactTask.id, id));
    if (task.refType === 'preorder' || task.refType === 'special_order') await contactedTx(tx, ctx, task.refType, task.refId);
    return { id, status: 'contacted' };
  });
}

export const UnreachableSchema = z.object({ note: z.string().trim().min(1, 'Ghi chú lần gọi không được.').max(500) });

/** “Không liên lạc được”: the task stays open until its deadline (UC-19 3a). */
export async function markUnreachable(ctx: Ctx, id: string, input: z.input<typeof UnreachableSchema>) {
  requirePermission(ctx, 'contact_task.manage');
  const { note } = UnreachableSchema.parse(input);
  const [row] = await ctx.db
    .update(schema.contactTask)
    .set({ attempts: sql`${schema.contactTask.attempts} + 1`, note: sql`case when ${schema.contactTask.note} is null then ${note} else ${schema.contactTask.note} || E'\n' || ${note} end` })
    .where(and(eq(schema.contactTask.id, id), eq(schema.contactTask.status, 'open')))
    .returning({ id: schema.contactTask.id, attempts: schema.contactTask.attempts });
  if (!row) throw errors.conflict('task_closed', 'Việc này đã xong hoặc không tồn tại.');
  return row;
}

/** `contact_task.overdue` (hourly): one in-app notification per overdue task. */
export async function notifyOverdueTasks(ctx: Ctx): Promise<number> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const due = await tx
      .update(schema.contactTask)
      .set({ overdueNotifiedAt: now })
      .where(and(eq(schema.contactTask.status, 'open'), lt(schema.contactTask.dueAt, now), sql`${schema.contactTask.overdueNotifiedAt} is null`))
      .returning({ id: schema.contactTask.id, name: schema.contactTask.name, refLabel: schema.contactTask.refLabel, reason: schema.contactTask.reason });
    for (const t of due) await notifications.notifyHolders(tx, 'contact_task.manage', 'contact_task.overdue', { taskId: t.id, name: t.name, ref: t.refLabel, reason: t.reason });
    return due.length;
  });
}

/** `preorder.expire` (daily): alert once about holds past the holding period; staff decide (FR-ORD-16). */
export async function notifyExpiredHolds(ctx: Ctx): Promise<number> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    let n = 0;
    for (const kind of ['preorder', 'special_order'] as const) {
      const t = TABLE[kind];
      const rows = await tx
        .update(t)
        .set({ overdueNotifiedAt: now })
        .where(and(eq(t.status, 'contacted'), lt(t.expiresAt, now), sql`${t.overdueNotifiedAt} is null`))
        .returning({ id: t.id, docNo: t.docNo });
      for (const r of rows) await notifications.notifyHolders(tx, 'online.manage', 'order.needs_action', { kind, id: r.id, docNo: r.docNo, reason: 'hold_expired' });
      n += rows.length;
    }
    return n;
  });
}
