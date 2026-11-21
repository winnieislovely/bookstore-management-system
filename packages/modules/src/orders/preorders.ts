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
import { AppError, can, errors, nextDocNo, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/**
 * Pre-orders (FR-ORD-14, FR-ORD-16, FR-POS-09, BR-10, TDD §4.5; revised 15 Nov 2026). One slip for books
 * kept for a customer, never edited once taken. A slip whose books are all on the shelf is a hold: its
 * copies are held at once and it starts at Contacted (Chờ nhận) with an optional deposit. A slip of books
 * to order takes its deposit when it is taken and starts at Quote (Chờ xác nhận); staff then set its
 * status by hand (Đang đặt hàng, Chờ nhận) and it is collected at the POS as a counter sale
 * (`preorderId` in the sales module).
 */

type PreorderRow = typeof schema.preorder.$inferSelect;
const OPEN = ['quote', 'confirmed', 'ordered', 'arrived', 'contacted'] as const;
const DAY = 86_400_000;

// =============================================================================================
// Deposits

export const DepositSchema = z
  .object({
    method: z.enum(DEPOSIT_METHODS),
    amountVnd: z.number().int().positive(),
    /** The staff member's open shift: cash goes into its drawer. */
    shiftId: z.uuid().optional(),
    /** Optional: a transfer needs no reference – staff confirming it means the money arrived; a card needs none (FR-POS-06). */
    ref: z.string().trim().max(40).optional(),
  })
  .superRefine((d, c) => {
    if (d.method === 'cash' && !d.shiftId) c.addIssue({ code: 'custom', path: ['shiftId'], message: 'Cần một ca đang mở để nhận tiền mặt.' });
    if (d.method === 'transfer' && d.ref) {
      const ref = normalizePaymentRef(d.ref);
      if (ref.length !== PAYMENT_REF_LENGTH || ![...ref].every((ch) => PAYMENT_REF_ALPHABET.includes(ch))) c.addIssue({ code: 'custom', path: ['ref'], message: 'Mã tham chiếu chuyển khoản không hợp lệ.' });
    }
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
    depositRef: d.method === 'transfer' && d.ref ? normalizePaymentRef(d.ref) : (d.ref ?? null),
    depositShiftId: d.method === 'cash' ? d.shiftId! : null,
  };
}

/** BR-10: at least `preorder.deposit_pct` of the value (`min`) up to full payment; a hold may take none (`min` = 0). */
async function minDeposit(tx: Tx, ctx: Ctx, valueVnd: number) {
  const pct = (await settings.snapshot(ctx, tx))['preorder.deposit_pct'];
  return { min: divRoundHalfUp(valueVnd * pct, 100), pct };
}

function checkDepositRange(depositVnd: number, min: number, max: number, pct: number) {
  if (depositVnd < min || depositVnd > max) {
    throw new AppError(422, 'deposit_out_of_range', min > 0 ? `Tiền cọc từ ${min} ₫ (${pct}%) đến ${max} ₫ (trả đủ).` : `Tiền cọc tối đa ${max} ₫.`, { minVnd: min, maxVnd: max });
  }
}

/** Holding days: longer with a deposit (BR-10). */
async function holdDays(tx: Tx, ctx: Ctx, depositVnd: number) {
  const cfg = await settings.snapshot(ctx, tx);
  return depositVnd > 0 ? cfg['preorder.hold_days'] : cfg['preorder.hold_days_no_deposit'];
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
// Lines

/** A book on a slip: a catalogue variant, or free text (title or ISBN) for a book not in the catalogue yet. */
export const LineInput = z.union([
  z.object({ variantId: z.uuid(), qty: z.number().int().positive().max(100) }),
  z.object({ title: z.string().trim().min(1, 'Cần nhập tên sách hoặc ISBN.').max(300), qty: z.number().int().positive().max(100) }),
]);
const Lines = z
  .array(LineInput)
  .min(1, 'Phiếu chưa có sách.')
  .max(30)
  .refine((ls) => {
    const ids = ls.flatMap((l) => ('variantId' in l ? [l.variantId] : []));
    return new Set(ids).size === ids.length;
  }, 'Mỗi sản phẩm chỉ một dòng.');

async function activePrices(tx: Tx, variantIds: string[]) {
  if (!variantIds.length) return new Map<string, number>();
  const rows = await tx
    .select({ id: schema.itemVariant.id, priceVnd: schema.itemVariant.priceVnd, status: schema.itemVariant.status })
    .from(schema.itemVariant)
    .where(inArray(schema.itemVariant.id, variantIds));
  const price = new Map(rows.filter((v) => v.status === 'active').map((v) => [v.id, v.priceVnd]));
  if (variantIds.some((id) => !price.has(id))) throw errors.notFound('Sản phẩm');
  return price;
}

async function linesOf(tx: Tx, preorderId: string) {
  return tx.select().from(schema.preorderLine).where(eq(schema.preorderLine.preorderId, preorderId)).orderBy(asc(schema.preorderLine.lineNo));
}

/** Hold copies on the shelf for the unheld catalogue lines of a slip; returns whether every line is held. */
async function holdShelfCopies(tx: Tx, ctx: Ctx, preorderId: string): Promise<boolean> {
  const lines = await linesOf(tx, preorderId);
  for (const l of lines) {
    if (l.reservedAt || !l.variantId) continue;
    if (await inventory.reserve(tx, ctx, 'preorder', preorderId, l.variantId, l.qty)) {
      await tx.update(schema.preorderLine).set({ reservedAt: ctx.clock.now() }).where(eq(schema.preorderLine.id, l.id));
    }
  }
  const after = await linesOf(tx, preorderId);
  return after.every((l) => l.reservedAt);
}

/** Whether `qty` copies are free on the shelf now (bundles: every component). */
async function onShelf(tx: Tx, variantId: string, qty: number): Promise<boolean> {
  const sl = schema.stockLevel;
  for (const u of await inventory.stockUnits(tx, variantId, qty)) {
    const [r] = await tx.select({ free: sql<number>`coalesce(sum(${sl.onHand} - ${sl.reserved}), 0)::int` }).from(sl).where(eq(sl.variantId, u.variantId));
    if ((r?.free ?? 0) < u.qty) return false;
  }
  return true;
}

/** A slip is a hold of books on the shelf or an order of books to order, never both (FR-ORD-14). */
const mixedSlip = () => new AppError(422, 'mixed_slip', 'Một phiếu chỉ gồm sách có sẵn (giữ sách) hoặc sách cần đặt. Bỏ bớt sách rồi tạo từng phiếu riêng.');

const valueOf = (lines: { qty: number; unitPriceVnd: number | null }[]) => lines.reduce((a, l) => a + l.qty * (l.unitPriceVnd ?? 0), 0);

/** A hold: every book is on the shelf; the customer is there, so the holding period starts now. */
async function startHolding(tx: Tx, ctx: Ctx, row: Pick<PreorderRow, 'id' | 'depositVnd'>, from = ctx.clock.now()) {
  const expiresAt = new Date(from.getTime() + (await holdDays(tx, ctx, row.depositVnd)) * DAY);
  await tx.update(schema.preorder).set({ status: 'contacted', contactedAt: from, expiresAt, overdueNotifiedAt: null }).where(eq(schema.preorder.id, row.id));
  return expiresAt;
}

// =============================================================================================
// Create (FR-ORD-14)

export const CreatePreorderSchema = z.object({
  /** Slips taken at the POS have no channel (`other`). */
  source: z.enum(ORDER_SOURCES).default('other'),
  customer: CustomerRef,
  lines: Lines,
  /** Optional for a hold; required for an order, at least `preorder.deposit_pct` of its catalogue books (BR-10). */
  deposit: DepositSchema.optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function createPreorder(ctx: Ctx, input: z.input<typeof CreatePreorderSchema>) {
  const actor = requirePermission(ctx, 'sale.create');
  const data = CreatePreorderSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const price = await activePrices(tx, data.lines.flatMap((l) => ('variantId' in l ? [l.variantId] : [])));
    // A hold (every book on the shelf) or an order (none on the shelf), never both (FR-ORD-14).
    const shelf = await Promise.all(data.lines.map((l) => ('variantId' in l ? onShelf(tx, l.variantId, l.qty) : Promise.resolve(false))));
    const hold = shelf.every(Boolean);
    if (!hold && shelf.some(Boolean)) throw mixedSlip();
    const customerId = await customerOf(tx, ctx, data.customer, data.source);
    const now = ctx.clock.now();
    const docNo = await nextDocNo(tx, 'PRE', now);
    const [row] = await tx
      .insert(schema.preorder)
      .values({ docNo, source: data.source, customerId, status: 'quote', note: data.note ?? null, createdBy: actor.userId, createdAt: now })
      .returning({ id: schema.preorder.id });
    const id = row!.id;
    await tx.insert(schema.preorderLine).values(
      data.lines.map((l, i) =>
        'variantId' in l
          ? { preorderId: id, lineNo: i + 1, variantId: l.variantId, qty: l.qty, unitPriceVnd: price.get(l.variantId)! }
          : { preorderId: id, lineNo: i + 1, variantId: null, requestedTitle: l.title, qty: l.qty, unitPriceVnd: null },
      ),
    );
    // A hold's copies are held at once; an order holds nothing until it is confirmed (FR-ORD-14).
    let status: string = 'quote';
    let expiresAt: Date | null = null;
    if (hold) {
      if (!(await holdShelfCopies(tx, ctx, id))) throw mixedSlip();
      // A hold: the deposit is optional, at most the value (BR-10).
      if (data.deposit) {
        const value = data.lines.reduce((a, l) => a + ('variantId' in l ? price.get(l.variantId)! * l.qty : 0), 0);
        checkDepositRange(data.deposit.amountVnd, 0, value, 0);
        await tx.update(schema.preorder).set(await takeDeposit(tx, ctx, docNo, data.deposit)).where(eq(schema.preorder.id, id));
      }
      expiresAt = await startHolding(tx, ctx, { id, depositVnd: data.deposit?.amountVnd ?? 0 }, now);
      status = 'contacted';
    } else {
      // An order: the deposit is taken with the slip – at least the minimum of its catalogue books, at most
      // their value when every book is priced; free-text books add nothing to the minimum (BR-10).
      const value = data.lines.reduce((a, l) => a + ('variantId' in l ? price.get(l.variantId)! * l.qty : 0), 0);
      const { min, pct } = await minDeposit(tx, ctx, value);
      const max = data.lines.every((l) => 'variantId' in l) ? value : Number.MAX_SAFE_INTEGER;
      if (!data.deposit && min > 0) throw new AppError(422, 'deposit_out_of_range', `Cần thu cọc từ ${min} ₫ (${pct}%).`, { minVnd: min, maxVnd: max });
      if (data.deposit) {
        checkDepositRange(data.deposit.amountVnd, min, max, pct);
        await tx.update(schema.preorder).set(await takeDeposit(tx, ctx, docNo, data.deposit)).where(eq(schema.preorder.id, id));
      }
    }
    await audit.record(tx, ctx, { action: 'preorder.create', entity: 'preorder', entityId: id, after: { docNo, lines: data.lines, depositVnd: data.deposit?.amountVnd ?? 0, status } });
    // Every new slip tells the other pre-order staff, not the one who took it (FR-ADM-08, TDD §4.12).
    const [who] = await tx.select({ name: schema.customer.name }).from(schema.customer).where(eq(schema.customer.id, customerId));
    await notifications.notifyHolders(tx, 'preorder.manage', 'preorder.created', { id, docNo, customerName: who?.name ?? null }, { except: actor.userId });
    return { id, docNo, status, expiresAt };
  });
}

// =============================================================================================
// Status by hand (FR-ORD-14)

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

export const PreorderStatusSchema = z.object({
  /** Chờ xác nhận, Đang đặt hàng or Chờ nhận; Đã nhận is the POS sale, Đã hủy is cancel. */
  status: z.enum(['quote', 'ordered', 'arrived']),
  /** Free-text books linked to catalogue products; required for every one of them to reach `arrived`. */
  links: z.array(z.object({ lineId: z.uuid(), variantId: z.uuid() })).max(30).default([]),
});
// Giao hàng is no longer a flag on the slip: an order slip at Chờ nhận becomes a delivery order (FR-ORD-14, POST /orders with preorderId).

/**
 * Staff set an order's status by hand (FR-ORD-14): nothing is read from stock or suppliers. Linking a
 * free-text book prices it at the product's selling price; Chờ nhận needs every book linked.
 */
export async function updatePreorderStatus(ctx: Ctx, id: string, input: z.input<typeof PreorderStatusSchema>) {
  requirePermission(ctx, 'sale.create');
  const data = PreorderStatusSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const row = await lockPreorder(tx, id);
    // A hold is Chờ nhận from the start: sent Chờ nhận, it stays Contacted.
    const to = row.status === 'contacted' && data.status === 'arrived' ? 'contacted' : data.status;
    if (row.status !== to) assertTransition(row, to);
    const lines = await linesOf(tx, id);
    const byId = new Map(lines.map((l) => [l.id, l]));
    for (const k of data.links) {
      const l = byId.get(k.lineId);
      if (!l || l.variantId) throw new AppError(422, 'link_line', 'Chỉ liên kết sách gõ tự do của phiếu này.');
    }
    const price = await activePrices(tx, data.links.map((k) => k.variantId));
    const taken = new Set(lines.flatMap((l) => (l.variantId ? [l.variantId] : [])));
    for (const k of data.links) {
      if (taken.has(k.variantId)) throw new AppError(422, 'link_line', 'Mỗi sản phẩm chỉ một dòng.');
      taken.add(k.variantId);
      await tx.update(schema.preorderLine).set({ variantId: k.variantId, unitPriceVnd: price.get(k.variantId)! }).where(eq(schema.preorderLine.id, k.lineId));
    }
    const linked = new Set(data.links.map((k) => k.lineId));
    if (data.status === 'arrived' && lines.some((l) => !l.variantId && !linked.has(l.id))) {
      throw new AppError(422, 'link_required', 'Chọn sản phẩm cho mọi sách gõ tự do trước khi chuyển sang Chờ nhận. Sách chưa có thì thêm ở trang Sản phẩm.');
    }
    await tx
      .update(schema.preorder)
      .set({ status: to, ...(to === 'arrived' && row.status !== 'arrived' && { allocatedAt: ctx.clock.now() }) })
      .where(eq(schema.preorder.id, id));
    await audit.record(tx, ctx, { action: 'preorder.status', entity: 'preorder', entityId: id, before: { status: row.status }, after: { status: to, links: data.links } });
    return { id, status: to };
  });
}

// =============================================================================================
// Cancel and expiry (FR-ORD-16)

export const CancelHoldSchema = z
  .object({
    reason: z.string().trim().min(1, 'Cần nhập lý do hủy.').max(500),
    /** Deposit policy (FR-ORD-16): give it back or keep it. Ignored without a deposit. */
    deposit: z.enum(['refund', 'forfeit']).default('refund'),
    shiftId: z.uuid().optional(),
    refundRef: z.string().trim().max(120).optional(),
  });

async function cancelTx(tx: Tx, ctx: Ctx, row: PreorderRow, data: z.infer<typeof CancelHoldSchema>) {
  if (row.depositVnd > 0 && data.deposit === 'refund') {
    if (row.depositMethod === 'cash') {
      if (!data.shiftId) throw new AppError(400, 'shift_required', 'Hoàn cọc tiền mặt cần một ca đang mở.');
      await openShift(tx, data.shiftId);
      await tx.insert(schema.cashMovement).values({ shiftId: data.shiftId, direction: 'out', amountVnd: row.depositVnd, reason: `Hoàn cọc ${row.docNo}`, createdBy: ctx.actor!.userId, at: ctx.clock.now() });
    } else if (!data.refundRef) {
      throw new AppError(400, 'refund_ref_required', 'Cần nhập mã giao dịch hoàn tiền chuyển khoản hoặc thẻ.');
    }
  }
  await inventory.endReservations(tx, ctx, 'preorder', row.id, 'released');
  await tx
    .update(schema.preorder)
    .set({ status: 'cancelled', cancelReason: data.reason, depositOutcome: row.depositVnd > 0 ? (data.deposit === 'refund' ? 'refunded' : 'forfeited') : null, refundRef: data.refundRef ?? null })
    .where(eq(schema.preorder.id, row.id));
  await audit.record(tx, ctx, { action: 'preorder.cancel', entity: 'preorder', entityId: row.id, after: { reason: data.reason, deposit: row.depositVnd > 0 ? data.deposit : null, depositVnd: row.depositVnd } });
}

/** Cancel with a reason; a slip with a deposit needs a manager, who refunds or keeps it (FR-ORD-16). */
export async function cancelPreorder(ctx: Ctx, id: string, input: z.input<typeof CancelHoldSchema>) {
  requirePermission(ctx, 'sale.create');
  const data = CancelHoldSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const row = await lockPreorder(tx, id);
    assertTransition(row, 'cancelled');
    if (row.depositVnd > 0 && !can(ctx.actor, 'preorder.manage')) throw new AppError(403, 'manager_required', 'Hủy phiếu có tiền cọc cần quản lý quyết hoàn hay giữ cọc.');
    await cancelTx(tx, ctx, row, data);
    return { id, status: 'cancelled', depositOutcome: row.depositVnd > 0 ? data.deposit : null };
  });
}

/**
 * `preorder.expire` (hourly, FR-ORD-16): a hold without a deposit past its date is cancelled and its
 * copies go back to stock; a slip with a deposit alerts managers once. Returns both counts.
 */
export async function expireHolds(ctx: Ctx): Promise<{ cancelled: number; alerted: number }> {
  const now = ctx.clock.now();
  const p = schema.preorder;
  const due = await ctx.db
    .select({ id: p.id })
    .from(p)
    .where(and(eq(p.status, 'contacted'), lt(p.expiresAt, now), eq(p.depositVnd, 0)));
  let cancelled = 0;
  for (const { id } of due) {
    await ctx.db.transaction(async (tx) => {
      const row = await lockPreorder(tx, id);
      if (row.status !== 'contacted' || row.depositVnd > 0 || !row.expiresAt || row.expiresAt >= now) return;
      await cancelTx(tx, ctx, row, { reason: 'Hết hạn giữ', deposit: 'refund' });
      cancelled++;
    });
  }
  const alerted = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .update(p)
      .set({ overdueNotifiedAt: now })
      .where(and(eq(p.status, 'contacted'), lt(p.expiresAt, now), sql`${p.depositVnd} > 0`, sql`${p.overdueNotifiedAt} is null`))
      .returning({ id: p.id, docNo: p.docNo });
    for (const r of rows) await notifications.notifyHolders(tx, 'preorder.manage', 'order.needs_action', { kind: 'preorder', id: r.id, docNo: r.docNo, reason: 'hold_expired' });
    return rows.length;
  });
  return { cancelled, alerted };
}

// =============================================================================================
// Lists: the Pre-orders screen, the by-title view, holds for the POS search

export const HoldsQuery = z.object({
  status: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  customer: z.uuid().optional(),
  /** Holding and past `expires_at` (Quá hạn). */
  overdue: z.enum(['true', 'false']).optional(),
  /** Every status that is not finished (the default view of the screen). */
  open: z.enum(['true', 'false']).optional(),
});

export async function listPreorders(ctx: Ctx, input: z.input<typeof HoldsQuery>) {
  requirePermission(ctx, 'sale.create');
  const q = HoldsQuery.parse(input);
  const p = schema.preorder;
  const now = ctx.clock.now();
  const where: SQL[] = [];
  const statuses = q.status?.split(',').filter(Boolean) ?? [];
  // “overdue” in the status list is the Quá hạn view of Holding.
  const plain = statuses.filter((s) => s !== 'overdue');
  const ors: SQL[] = [];
  if (plain.length) ors.push(inArray(p.status, plain));
  if (statuses.includes('overdue') || q.overdue === 'true') ors.push(and(eq(p.status, 'contacted'), lt(p.expiresAt, now))!);
  if (ors.length) where.push(ors.length === 1 ? ors[0]! : sql`(${sql.join(ors, sql` or `)})`);
  if (q.open === 'true') where.push(inArray(p.status, [...OPEN]));
  if (q.customer) where.push(eq(p.customerId, q.customer));
  if (q.q) {
    const digits = q.q.replace(/\D/g, '');
    where.push(
      sql`(${p.docNo} ilike ${`%${q.q}%`} or ${schema.customer.searchText} like ${`%${foldText(q.q)}%`} ${digits.length >= 4 ? sql`or ${schema.customer.phoneE164} like ${`%${digits.slice(-9)}%`}` : sql``}
           or exists (select 1 from orders.preorder_line l left join catalog.item_variant v on v.id = l.variant_id left join catalog.item i on i.id = v.item_id
                      where l.preorder_id = ${p.id} and (v.sku = ${q.q} or v.isbn13 = ${q.q.replace(/[^0-9Xx]/g, '')} or l.requested_title ilike ${`%${q.q}%`}
                        or exists (select 1 from catalog.barcode b where b.variant_id = v.id and b.code = ${q.q})
                        or i.search_text like ${`%${foldText(q.q)}%`})))`,
    );
  }
  return ctx.db
    .select({
      id: p.id,
      docNo: p.docNo,
      status: p.status,
      createdAt: p.createdAt,
      lines: sql<{ lineId: string; variantId: string | null; sku: string | null; title: string; freeText: boolean; qty: number; unitPriceVnd: number | null; held: boolean }[]>`(
        select coalesce(json_agg(json_build_object(
          'lineId', l.id, 'variantId', l.variant_id, 'sku', v.sku, 'qty', l.qty, 'unitPriceVnd', l.unit_price_vnd, 'held', l.reserved_at is not null,
          'freeText', l.variant_id is null,
          'title', coalesce(nullif(i.i18n -> 'vi' ->> 'title', ''), i.i18n -> 'en' ->> 'title', l.requested_title)) order by l.line_no), '[]'::json)
        from orders.preorder_line l left join catalog.item_variant v on v.id = l.variant_id left join catalog.item i on i.id = v.item_id
        where l.preorder_id = ${p.id})`,
      totalVnd: sql<number>`(select coalesce(sum(l.qty * l.unit_price_vnd), 0)::int from orders.preorder_line l where l.preorder_id = ${p.id})`,
      unpriced: sql<boolean>`exists (select 1 from orders.preorder_line l where l.preorder_id = ${p.id} and (l.unit_price_vnd is null or l.variant_id is null))`,
      depositVnd: p.depositVnd,
      depositMethod: p.depositMethod,
      quotedAt: p.quotedAt,
      confirmedAt: p.confirmedAt,
      contactedAt: p.contactedAt,
      expiresAt: p.expiresAt,
      extensions: p.extensions,
      note: p.note,
      saleId: p.saleId,
      /** The delivery order created from the slip (FR-ORD-14). */
      orderId: p.orderId,
      orderDocNo: sql<string | null>`(select o.doc_no from orders.web_order o where o.id = ${p.orderId})`,
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

/** “Theo sách”: books still to arrive on open slips – for ordering from suppliers (FR-POS-09). */
/** The BR-10 rules the pre-order form shows and applies (FR-ADM-04, TDD §4.5). */
export async function preorderConfig(ctx: Ctx) {
  requirePermission(ctx, 'sale.create');
  const cfg = await settings.snapshot(ctx);
  return { depositPct: cfg['preorder.deposit_pct'], holdDays: cfg['preorder.hold_days'], holdDaysNoDeposit: cfg['preorder.hold_days_no_deposit'] };
}

export async function preordersByTitle(ctx: Ctx) {
  requirePermission(ctx, 'sale.create');
  return ctx.db.execute<{ variantId: string | null; sku: string | null; title: string; qty: number; slips: number }>(sql`
    select l.variant_id as "variantId", v.sku,
           coalesce(nullif(i.i18n -> 'vi' ->> 'title', ''), i.i18n -> 'en' ->> 'title', l.requested_title) as title,
           sum(l.qty)::int as qty, count(distinct l.preorder_id)::int as slips
    from orders.preorder_line l join orders.preorder p on p.id = l.preorder_id
    left join catalog.item_variant v on v.id = l.variant_id left join catalog.item i on i.id = v.item_id
    where p.status in ('quote', 'confirmed', 'ordered') and l.reserved_at is null
    group by l.variant_id, v.sku, 3
    order by sum(l.qty) desc, 3`);
}

export const HoldLookupQuery = z.object({ variant: z.union([z.uuid(), z.array(z.uuid())]) });

/** Who copies are held for, for the POS search (FR-POS-09). */
export async function holdsOf(ctx: Ctx, input: z.input<typeof HoldLookupQuery>) {
  requirePermission(ctx, 'sale.create');
  const q = HoldLookupQuery.parse(input);
  const ids = Array.isArray(q.variant) ? q.variant : [q.variant];
  return ctx.db
    .select({
      variantId: schema.preorderLine.variantId,
      qty: schema.preorderLine.qty,
      preorderId: schema.preorder.id,
      docNo: schema.preorder.docNo,
      status: schema.preorder.status,
      expiresAt: schema.preorder.expiresAt,
      customerName: schema.customer.name,
      customerPhone: schema.customer.phoneE164,
    })
    .from(schema.preorderLine)
    .innerJoin(schema.preorder, eq(schema.preorder.id, schema.preorderLine.preorderId))
    .innerJoin(schema.customer, eq(schema.customer.id, schema.preorder.customerId))
    .where(and(inArray(schema.preorderLine.variantId, ids), sql`${schema.preorderLine.reservedAt} is not null`, inArray(schema.preorder.status, [...OPEN])))
    .orderBy(asc(schema.preorder.expiresAt));
}
