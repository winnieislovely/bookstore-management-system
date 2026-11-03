import { schema, type Tx } from '@bookstore/db';
import { divRoundHalfUp, pointsToReverse } from '@bookstore/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as customers from '../customers/index.js';
import * as sales from '../sales/index.js';
import { AppError, emit, errors, requirePermission, type Ctx } from '../platform/index.js';
import { amountPaid, transition } from './index.js';

/**
 * Returns of online orders (FR-ORD-17, TDD §4.5): requested by the customer or staff, approved,
 * received and inspected (restock or write off, BR-04), refunded outside the system and recorded.
 */

type OrderRow = typeof schema.webOrder.$inferSelect;
const REF = 'web_order';

async function lockOrder(tx: Tx, id: string): Promise<OrderRow> {
  const [o] = await tx.select().from(schema.webOrder).where(eq(schema.webOrder.id, id)).for('update');
  if (!o) throw errors.notFound('Đơn hàng');
  return o;
}

async function openReturn(tx: Tx, orderId: string) {
  const [r] = await tx
    .select()
    .from(schema.returnRequest)
    .where(and(eq(schema.returnRequest.orderId, orderId), inArray(schema.returnRequest.status, ['requested', 'approved'])))
    .orderBy(desc(schema.returnRequest.createdAt))
    .limit(1)
    .for('update');
  return r;
}

export const ReturnRequestSchema = z.object({
  reason: z.string().trim().min(1, 'Cần nhập lý do trả hàng.').max(500),
  lines: z.array(z.object({ orderLineId: z.uuid(), qty: z.number().int().positive() })).min(1),
  returnShippingPaidBy: z.enum(['store', 'customer']),
});

export async function requestReturn(ctx: Ctx, id: string, input: z.input<typeof ReturnRequestSchema>) {
  const actor = requirePermission(ctx, 'online.manage');
  const data = ReturnRequestSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== 'shipping' && o.status !== 'done') throw errors.conflict('invalid_transition', `Chỉ trả được đơn đang giao hoặc đã hoàn tất.`);
    const lines = await tx.select().from(schema.orderLine).where(eq(schema.orderLine.orderId, id));
    for (const l of data.lines) {
      const line = lines.find((x) => x.id === l.orderLineId);
      if (!line) throw new AppError(400, 'line_not_in_order', 'Dòng hàng không thuộc đơn này.');
      if (l.qty > line.qty) throw new AppError(422, 'return_exceeds_sold', `Chỉ có ${line.qty} sản phẩm '${line.description}' trong đơn.`);
    }
    const [r] = await tx
      .insert(schema.returnRequest)
      .values({ orderId: id, reason: data.reason, lines: data.lines, returnShippingPaidBy: data.returnShippingPaidBy, requestedBy: actor.userId, createdAt: ctx.clock.now() })
      .returning({ id: schema.returnRequest.id });
    await transition(tx, ctx, o, 'return_requested', data.reason);
    return { id: r!.id, orderStatus: o.status };
  });
}

/** GHN brought the parcel back: an approved whole-order return, shipping paid by the store. */
export async function carrierReturnTx(tx: Tx, ctx: Ctx, o: OrderRow): Promise<void> {
  const lines = await tx.select({ id: schema.orderLine.id, qty: schema.orderLine.qty }).from(schema.orderLine).where(eq(schema.orderLine.orderId, o.id));
  const reason = 'GHN hoàn hàng (giao không thành công)';
  await tx.insert(schema.returnRequest).values({
    orderId: o.id,
    reason,
    status: 'approved',
    lines: lines.map((l) => ({ orderLineId: l.id, qty: l.qty })),
    returnShippingPaidBy: 'store',
    createdAt: ctx.clock.now(),
  });
  await transition(tx, ctx, o, 'return_requested', reason);
  await transition(tx, ctx, o, 'return_approved', reason);
}

export async function approveReturn(ctx: Ctx, id: string) {
  requirePermission(ctx, 'online.manage');
  return ctx.db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    const r = await openReturn(tx, id);
    if (!r || r.status !== 'requested') throw errors.conflict('no_return_request', `Đơn ${o.docNo} không có yêu cầu trả hàng chờ duyệt.`);
    await tx.update(schema.returnRequest).set({ status: 'approved' }).where(eq(schema.returnRequest.id, r.id));
    await transition(tx, ctx, o, 'return_approved');
    return { id, status: o.status };
  });
}

export const RejectReturnSchema = z.object({ reason: z.string().trim().min(1, 'Cần nhập lý do từ chối.').max(500) });

/** A refused request leaves the order Done (SRS B.1: Return requested → Done). */
export async function rejectReturn(ctx: Ctx, id: string, input: z.input<typeof RejectReturnSchema>) {
  requirePermission(ctx, 'online.manage');
  const { reason } = RejectReturnSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    const r = await openReturn(tx, id);
    if (!r || r.status !== 'requested') throw errors.conflict('no_return_request', `Đơn ${o.docNo} không có yêu cầu trả hàng chờ duyệt.`);
    await tx.update(schema.returnRequest).set({ status: 'rejected' }).where(eq(schema.returnRequest.id, r.id));
    await transition(tx, ctx, o, 'done', `Từ chối trả hàng: ${reason}`, o.doneAt ? {} : { doneAt: ctx.clock.now() });
    return { id, status: o.status };
  });
}

export const ReceiveReturnSchema = z.object({
  /** Per returned line: back to stock, or written off as damaged (BR-04). */
  lines: z.array(z.object({ orderLineId: z.uuid(), restock: z.boolean() })).min(1),
  refundVnd: z.number().int().min(0),
  refundRef: z.string().trim().max(120).nullable().optional(),
});

/** Goods back and inspected: stock, consignment and points reversed; the refund recorded (→ Returned). */
export async function receiveReturn(ctx: Ctx, id: string, input: z.input<typeof ReceiveReturnSchema>) {
  const actor = requirePermission(ctx, 'online.manage');
  const data = ReceiveReturnSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    const r = await openReturn(tx, id);
    if (!r || r.status !== 'approved' || o.status !== 'return_approved') throw errors.conflict('no_approved_return', `Đơn ${o.docNo} chưa có yêu cầu trả hàng đã duyệt.`);
    const lines = await tx.select().from(schema.orderLine).where(eq(schema.orderLine.orderId, id));
    // An order that never reached Done was never paid by COD: nothing to refund then.
    const paidVnd = amountPaid(o);
    if (data.refundVnd > paidVnd) throw new AppError(422, 'refund_exceeds_paid', `Số tiền hoàn tối đa là ${paidVnd} ₫.`);
    const returned = r.lines.map((rl) => {
      const line = lines.find((l) => l.id === rl.orderLineId)!;
      const inspected = data.lines.find((x) => x.orderLineId === rl.orderLineId);
      if (!inspected) throw new AppError(400, 'line_not_inspected', `Cần kiểm tra '${line.description}': nhập kho lại hay hủy.`);
      return { line, qty: rl.qty, restock: inspected.restock };
    });
    const now = ctx.clock.now();
    for (const x of returned) {
      if (x.restock) await sales.restock(tx, ctx, 'order_return', r.id, x.line.variantId, x.qty, x.line.costVnd ? divRoundHalfUp(x.line.costVnd, x.line.qty) : 0);
      await sales.reverseConsignment(tx, x.line.id, x.qty);
    }
    // Points earned at Done are reversed on the share returned; redeemed points come back the same way (BR-19).
    let pointsReversed = 0;
    if (o.customerId && o.doneAt) {
      const total = lines.reduce((a, l) => a + l.totalVnd, 0);
      const back = returned.reduce((a, x) => a + divRoundHalfUp(x.line.totalVnd * x.qty, x.line.qty), 0);
      pointsReversed = pointsToReverse(o.pointsEarned, total, back);
      if (pointsReversed > 0) await customers.post(tx, ctx, { customerId: o.customerId, delta: -pointsReversed, reason: 'return_reversal', refType: 'order_return', refId: r.id }, { floorAtZero: true });
      const redeemedBack = pointsToReverse(o.pointsRedeemed, total, back);
      if (redeemedBack > 0) await customers.post(tx, ctx, { customerId: o.customerId, delta: redeemedBack, reason: 'redeem_refund', refType: 'order_return', refId: r.id });
    } else if (o.customerId && o.pointsRedeemed > 0) {
      await customers.post(tx, ctx, { customerId: o.customerId, delta: o.pointsRedeemed, reason: 'redeem_refund', refType: 'order_return', refId: r.id });
    }
    await tx
      .update(schema.returnRequest)
      .set({ status: 'received', lines: returned.map((x) => ({ orderLineId: x.line.id, qty: x.qty, restock: x.restock })), refundVnd: data.refundVnd, refundRef: data.refundRef ?? null, pointsReversed, receivedBy: actor.userId, receivedAt: now })
      .where(eq(schema.returnRequest.id, r.id));
    await transition(tx, ctx, o, 'returned', data.refundVnd ? `Hoàn ${data.refundVnd} ₫` : null);
    await audit.record(tx, ctx, { action: 'order.return_received', entity: REF, entityId: id, after: { returnId: r.id, refundVnd: data.refundVnd, refundRef: data.refundRef ?? null } });
    await emit(tx, 'order.returned', { orderId: id, returnId: r.id, refundVnd: data.refundVnd });
    return { id, status: o.status, refundVnd: data.refundVnd, pointsReversed };
  });
}
