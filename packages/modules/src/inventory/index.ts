import { schema } from '@bookstore/db';
import { adjustmentValue, movingAverageCost, STOCK_COUNT, canTransition, vnd, type MovementType } from '@bookstore/domain';
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as identity from '../identity/index.js';
import * as masterdata from '../masterdata/index.js';
import * as settings from '../settings/index.js';
import { AppError, can, emit, errors, nextDocNo, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/**
 * Inventory (FR-INV-01..11, TDD §4.2). `apply` is the single write path for stock: it inserts the
 * immutable movement and updates `stock_level` in the caller's transaction.
 */

export type Location = 'floor' | 'back';

export interface MovementInput {
  variantId: string;
  location?: Location;
  type: MovementType;
  qtyDelta: number;
  /** Unit cost for stock-in (moving average) or the cost recorded on outbound movements. */
  unitCostVnd?: number | null;
  refType: string;
  refId: string;
  note?: string | null;
  /**
   * Allow available stock to go negative: offline sync (TDD §7.6) and counter sales when
   * `inventory.allow_negative_pos` is on (FR-INV-05). Counts and adjustments set it too, since they
   * record a physical fact.
   */
  force?: boolean;
  /** For inbound movements: whether the unit cost feeds the moving average (not for consignment). */
  affectsCost?: boolean;
}

export interface Applied {
  movementId: string;
  onHand: number;
  reserved: number;
  avgCostVnd: number;
  /** Cost per unit at the time of an outbound movement (for margin reports). */
  costVnd: number;
}

export class InsufficientStock extends AppError {
  constructor(readonly variantId: string, readonly availableQty: number, requested: number) {
    super(
      409,
      'insufficient_stock',
      `Chỉ còn ${availableQty} sản phẩm có thể bán (yêu cầu ${requested}). Giảm số lượng hoặc chuyển thành đơn đặt trước.`,
      { variantId, available: availableQty, requested },
    );
  }
}

export async function apply(tx: Tx, ctx: Ctx, m: MovementInput): Promise<Applied> {
  if (!Number.isSafeInteger(m.qtyDelta) || m.qtyDelta === 0) throw new RangeError('qtyDelta must be a non-zero integer');
  const location = m.location ?? 'floor';
  const now = ctx.clock.now();
  await tx.insert(schema.stockLevel).values({ variantId: m.variantId, location }).onConflictDoNothing();
  const sl = schema.stockLevel;
  const key = and(eq(sl.variantId, m.variantId), eq(sl.location, location));

  let level: typeof sl.$inferSelect | undefined;
  if (m.qtyDelta > 0) {
    // Inbound: lock the row to update the moving average consistently (TDD §4.2).
    const [cur] = await tx.select().from(sl).where(key).for('update');
    const affectsCost = m.affectsCost ?? (m.type === 'stock_in');
    const avg =
      affectsCost && m.unitCostVnd != null
        ? movingAverageCost(cur!.onHand, vnd(cur!.avgCostVnd), m.qtyDelta, vnd(m.unitCostVnd))
        : cur!.avgCostVnd;
    [level] = await tx
      .update(sl)
      .set({ onHand: sql`${sl.onHand} + ${m.qtyDelta}`, avgCostVnd: avg, updatedAt: now })
      .where(key)
      .returning();
  } else {
    // Outbound: one atomic conditional statement, so concurrent sales cannot oversell (TDD §4.2).
    const q = -m.qtyDelta;
    const guard = m.force ? sql`true` : sql`${sl.onHand} - ${sl.reserved} >= ${q}`;
    [level] = await tx
      .update(sl)
      .set({ onHand: sql`${sl.onHand} - ${q}`, updatedAt: now, ...(m.type === 'sale' && { lastSaleAt: now }) })
      .where(and(key, guard))
      .returning();
    if (!level) {
      const [cur] = await tx.select().from(sl).where(key);
      throw new InsufficientStock(m.variantId, (cur?.onHand ?? 0) - (cur?.reserved ?? 0), q);
    }
  }
  const [mv] = await tx
    .insert(schema.stockMovement)
    .values({
      variantId: m.variantId,
      location,
      type: m.type,
      qtyDelta: m.qtyDelta,
      unitCostVnd: m.unitCostVnd ?? (m.qtyDelta < 0 ? level!.avgCostVnd : null),
      refType: m.refType,
      refId: m.refId,
      actorId: ctx.actor?.userId ?? null,
      at: now,
      note: m.note ?? null,
    })
    .returning({ id: schema.stockMovement.id });
  await emit(tx, 'stock.changed', { variantId: m.variantId });
  return { movementId: mv!.id, onHand: level!.onHand, reserved: level!.reserved, avgCostVnd: level!.avgCostVnd, costVnd: level!.avgCostVnd };
}

// ---------------------------------------------------------------------------------------------
// Reads

export async function levels(ctx: Ctx, variantIds: string[]) {
  requirePermission(ctx, 'inventory.view');
  if (!variantIds.length) return [];
  const showCost = can(ctx.actor, 'catalog.view_cost');
  const rows = await ctx.db.select().from(schema.stockLevel).where(inArray(schema.stockLevel.variantId, variantIds));
  return rows.map((r) => ({
    variantId: r.variantId,
    location: r.location,
    onHand: r.onHand,
    reserved: r.reserved,
    available: r.onHand - r.reserved,
    ...(showCost && { avgCostVnd: r.avgCostVnd }),
  }));
}

export const MovementQuery = z.object({
  variant: z.uuid(),
  type: z.string().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  cursor: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(40),
});

/** Item history page: every movement, filterable by type and date (FR-INV-11). */
export async function movements(ctx: Ctx, input: z.input<typeof MovementQuery>) {
  requirePermission(ctx, 'inventory.view');
  const q = MovementQuery.parse(input);
  const m = schema.stockMovement;
  const where: SQL[] = [eq(m.variantId, q.variant)];
  if (q.type) where.push(eq(m.type, q.type));
  if (q.from) where.push(sql`${m.at} >= ${new Date(q.from)}`);
  if (q.to) where.push(sql`${m.at} <= ${new Date(q.to)}`);
  if (q.cursor) where.push(lt(m.at, new Date(q.cursor)));
  const showCost = can(ctx.actor, 'catalog.view_cost');
  // Source document number (stock-in entry, sale, return) and supplier, for the product's stock page (Design §12.1).
  const rows = await ctx.db
    .select({
      m,
      refDocNo: sql<string | null>`case ${m.refType}
        when 'stock_in' then (select e.entry_no from purchasing.stock_in_entry e where e.id::text = ${m.refId}::text)
        when 'sale' then (select s.doc_no from sales.sale s where s.id::text = ${m.refId}::text)
        when 'sale_void' then (select s.doc_no from sales.sale s where s.id::text = ${m.refId}::text)
        when 'sale_return' then (select r.doc_no from sales.sale_return r where r.id::text = ${m.refId}::text)
        end`,
      supplierName: sql<string | null>`case when ${m.refType} = 'stock_in' then (select sp.name from purchasing.stock_in_entry e join purchasing.supplier sp on sp.id = e.supplier_id where e.id::text = ${m.refId}::text) end`,
    })
    .from(m)
    .where(and(...where))
    .orderBy(desc(m.at), desc(m.id))
    .limit(q.limit + 1);
  const page = rows.slice(0, q.limit).map(({ m: { unitCostVnd, ...r }, refDocNo, supplierName }) => ({ ...r, refDocNo, supplierName, ...(showCost && { unitCostVnd }) }));
  return { items: page, nextCursor: rows.length > q.limit ? page[page.length - 1]!.at.toISOString() : null };
}

/** Items below their minimum level (FR-INV-09, dashboard low-stock list). */
export async function lowStock(ctx: Ctx, limit = 40) {
  requirePermission(ctx, 'inventory.view');
  return ctx.db.execute<{ variant_id: string; sku: string; title: string; available: number; min_stock: number }>(sql`
    select v.id as variant_id, v.sku, i.i18n -> 'en' ->> 'title' as title,
           coalesce(sum(s.on_hand - s.reserved), 0)::int as available, v.min_stock
    from catalog.item_variant v
    join catalog.item i on i.id = v.item_id
    left join inventory.stock_level s on s.variant_id = v.id
    where v.min_stock is not null and v.status = 'active'
    group by v.id, i.id
    having coalesce(sum(s.on_hand - s.reserved), 0) <= v.min_stock
    order by available asc
    limit ${limit}`);
}

/** Stock valuation at moving-average cost (FR-INV-08); cost requires `catalog.view_cost`. */
export async function valuation(ctx: Ctx) {
  requirePermission(ctx, 'catalog.view_cost');
  const rows = await ctx.db.execute<{ variant_id: string; sku: string; on_hand: number; avg_cost_vnd: number; value_vnd: number }>(sql`
    select v.id as variant_id, v.sku, sum(s.on_hand)::int as on_hand, max(s.avg_cost_vnd)::bigint as avg_cost_vnd,
           sum(greatest(s.on_hand, 0) * s.avg_cost_vnd)::bigint as value_vnd
    from inventory.stock_level s join catalog.item_variant v on v.id = s.variant_id
    group by v.id order by v.sku`);
  const items = rows.map((r) => ({ ...r, avg_cost_vnd: Number(r.avg_cost_vnd), value_vnd: Number(r.value_vnd) }));
  return { items, totalVnd: items.reduce((a, r) => a + r.value_vnd, 0) };
}

// ---------------------------------------------------------------------------------------------
// Adjustments (FR-INV-07)

export const AdjustmentSchema = z.object({
  variantId: z.uuid(),
  location: z.enum(['floor', 'back']).default('floor'),
  qtyDelta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Số lượng điều chỉnh phải khác 0.'),
  /** Reason codes are master data (FR-ADM-10), e.g. `damaged`, `lost`, `found`, `correction`. */
  reasonCode: z.string().trim().min(1, 'Cần chọn lý do điều chỉnh.'),
  note: z.string().trim().max(500).optional(),
  writeOff: z.boolean().default(false),
  approvalToken: z.string().optional(),
});

/**
 * Manual adjustment with a reason code. Above `inventory.adjust_approval_vnd` it needs approval by
 * a user holding `inventory.count_approve`: either the actor holds it, or a supervisor approval
 * token is supplied (FR-ADM-09).
 */
export async function adjust(ctx: Ctx, input: z.input<typeof AdjustmentSchema>) {
  const actor = requirePermission(ctx, 'inventory.adjust');
  const data = AdjustmentSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    if (!(await masterdata.isActive(tx, 'reason_code', data.reasonCode))) {
      throw new AppError(400, 'invalid_reason_code', 'Lý do điều chỉnh không có trong danh mục. Hãy chọn một lý do có sẵn.');
    }
    const cfg = await settings.snapshot(ctx, tx);
    const [level] = await tx
      .select()
      .from(schema.stockLevel)
      .where(and(eq(schema.stockLevel.variantId, data.variantId), eq(schema.stockLevel.location, data.location)));
    const value = adjustmentValue(data.qtyDelta, vnd(level?.avgCostVnd ?? 0));
    let approvedBy: string | null = null;
    if (value > cfg['inventory.adjust_approval_vnd']) {
      if (can(actor, 'inventory.count_approve')) approvedBy = actor.userId;
      else if (data.approvalToken) approvedBy = await identity.consumeApproval(tx, ctx, data.approvalToken, 'stock_adjustment', data.variantId);
      else {
        throw new AppError(403, 'approval_required', 'Điều chỉnh vượt hạn mức, cần quản lý duyệt.', {
          action: 'stock_adjustment',
          valueVnd: value,
          thresholdVnd: cfg['inventory.adjust_approval_vnd'],
        });
      }
    }
    const docNo = await nextDocNo(tx, 'ADJ', ctx.clock.now());
    const [adj] = await tx
      .insert(schema.stockAdjustment)
      .values({
        docNo,
        variantId: data.variantId,
        location: data.location,
        qtyDelta: data.qtyDelta,
        reasonCode: data.reasonCode,
        note: data.note ?? null,
        valueVnd: value,
        requestedBy: actor.userId,
        approvedBy,
      })
      .returning({ id: schema.stockAdjustment.id });
    const applied = await apply(tx, ctx, {
      variantId: data.variantId,
      location: data.location,
      type: data.writeOff && data.qtyDelta < 0 ? 'write_off' : 'adjustment',
      qtyDelta: data.qtyDelta,
      refType: 'stock_adjustment',
      refId: adj!.id,
      note: data.note ?? data.reasonCode,
      force: true,
    });
    await tx.update(schema.stockAdjustment).set({ movementId: applied.movementId }).where(eq(schema.stockAdjustment.id, adj!.id));
    await audit.record(tx, ctx, {
      action: 'stock.adjust',
      entity: 'item_variant',
      entityId: data.variantId,
      before: { onHand: applied.onHand - data.qtyDelta },
      after: { onHand: applied.onHand, reasonCode: data.reasonCode, valueVnd: value, approvedBy, docNo },
    });
    return { id: adj!.id, docNo, onHand: applied.onHand };
  });
}

// ---------------------------------------------------------------------------------------------
// Stock counts (FR-INV-06, UC-07)

export const CountScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('full') }),
  z.object({ kind: z.literal('category'), categoryIds: z.array(z.uuid()).min(1) }),
  z.object({ kind: z.literal('variants'), variantIds: z.array(z.uuid()).min(1) }),
  /** Product types (books, stationery, other goods), optionally narrowed to categories (FR-INV-06). */
  z.object({ kind: z.literal('types'), itemKinds: z.array(z.enum(['book', 'stationery', 'other', 'bundle'])).min(1), categoryIds: z.array(z.uuid()).optional() }),
]);

/** Above this many lines, counted quantities come from the count sheet only (FR-INV-06). */
export const COUNT_SHEET_REQUIRED_ABOVE = 50;

export const CreateCountSchema = z.object({
  scope: CountScope,
  location: z.enum(['floor', 'back']).default('floor'),
  blind: z.boolean().default(false),
});

export async function createCount(ctx: Ctx, input: z.input<typeof CreateCountSchema>) {
  const actor = requirePermission(ctx, 'inventory.count');
  const data = CreateCountSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const docNo = await nextDocNo(tx, 'CNT', ctx.clock.now());
    const [count] = await tx
      .insert(schema.stockCount)
      .values({ docNo, scope: data.scope, location: data.location, blind: data.blind, createdBy: actor.userId })
      .returning({ id: schema.stockCount.id });
    // Snapshot expected quantities for every active variant in scope.
    const inCategories = (ids: string[]) => sql`exists (with recursive tree as (
                select id from catalog.category where id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
                union all select c.id from catalog.category c join tree on c.parent_id = tree.id)
              select 1 from catalog.item_category ic where ic.item_id = v.item_id and ic.category_id in (select id from tree))`;
    const scope = data.scope;
    const scopeSql =
      scope.kind === 'full'
        ? sql`true`
        : scope.kind === 'variants'
          ? sql`v.id in (${sql.join(scope.variantIds.map((id) => sql`${id}::uuid`), sql`, `)})`
          : scope.kind === 'category'
            ? inCategories(scope.categoryIds)
            : sql`exists (select 1 from catalog.item i where i.id = v.item_id and i.kind in (${sql.join(scope.itemKinds.map((k) => sql`${k}`), sql`, `)}))${scope.categoryIds?.length ? sql` and ${inCategories(scope.categoryIds)}` : sql``}`;
    await tx.execute(sql`
      insert into inventory.stock_count_line (count_id, variant_id, expected)
      select ${count!.id}::uuid, v.id, coalesce(s.on_hand, 0)
      from catalog.item_variant v
      left join inventory.stock_level s on s.variant_id = v.id and s.location = ${data.location}
      where v.status = 'active' and ${scopeSql}`);
    return { id: count!.id, docNo };
  });
}

/** Stock counts, newest first, with progress (TDD §6.2 GET /inventory/counts). */
export async function listCounts(ctx: Ctx, status?: string) {
  requirePermission(ctx, 'inventory.count');
  const c = schema.stockCount;
  return ctx.db
    .select({
      id: c.id,
      docNo: c.docNo,
      scope: c.scope,
      location: c.location,
      blind: c.blind,
      status: c.status,
      createdAt: c.createdAt,
      approvedAt: c.approvedAt,
      createdBy: schema.appUser.displayName,
      lines: sql<number>`(select count(*)::int from inventory.stock_count_line l where l.count_id = ${c.id})`,
      counted: sql<number>`(select count(*)::int from inventory.stock_count_line l where l.count_id = ${c.id} and l.counted is not null)`,
    })
    .from(c)
    .leftJoin(schema.appUser, eq(schema.appUser.id, c.createdBy))
    .where(status ? eq(c.status, status) : undefined)
    .orderBy(desc(c.createdAt))
    .limit(100);
}

/** Blind mode hides expected quantities in the API response for non-approvers (TDD §4.2). */
export async function getCount(ctx: Ctx, id: string) {
  requirePermission(ctx, 'inventory.count');
  const [count] = await ctx.db.select().from(schema.stockCount).where(eq(schema.stockCount.id, id));
  if (!count) throw errors.notFound('Phiếu kiểm kho');
  const showExpected = !count.blind || can(ctx.actor, 'inventory.count_approve');
  const lines = await ctx.db
    .select({
      variantId: schema.stockCountLine.variantId,
      sku: schema.itemVariant.sku,
      title: sql<string>`${schema.item.i18n} -> 'en' ->> 'title'`,
      expected: schema.stockCountLine.expected,
      counted: schema.stockCountLine.counted,
    })
    .from(schema.stockCountLine)
    .innerJoin(schema.itemVariant, eq(schema.itemVariant.id, schema.stockCountLine.variantId))
    .innerJoin(schema.item, eq(schema.item.id, schema.itemVariant.itemId))
    .where(eq(schema.stockCountLine.countId, id))
    .orderBy(asc(schema.itemVariant.sku));
  return {
    ...count,
    lines: lines.map(({ expected, ...l }) => ({
      ...l,
      ...(showExpected && { expected, variance: l.counted === null ? null : l.counted - expected }),
    })),
  };
}

export const CountLineSchema = z.object({
  variantId: z.uuid(),
  /** `add` for each scan (increments), `set` for typed quantities. */
  mode: z.enum(['add', 'set']).default('add'),
  qty: z.number().int().min(0),
});

export async function recordCount(ctx: Ctx, countId: string, input: z.input<typeof CountLineSchema>) {
  requirePermission(ctx, 'inventory.count');
  const data = CountLineSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [count] = await tx.select().from(schema.stockCount).where(eq(schema.stockCount.id, countId)).for('update');
    if (!count) throw errors.notFound('Phiếu kiểm kho');
    if (count.status !== 'open') throw errors.conflict('count_not_open', 'Phiếu kiểm kho đã nộp, không thể đếm thêm.');
    const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from inventory.stock_count_line where count_id = ${countId}::uuid`)) as unknown as [{ n: number }];
    if (n > COUNT_SHEET_REQUIRED_ABOVE) {
      throw errors.conflict('count_sheet_required', `Phiếu có hơn ${COUNT_SHEET_REQUIRED_ABOVE} sản phẩm: hãy tải phiếu đếm về, điền số đếm rồi tải lên.`);
    }
    const l = schema.stockCountLine;
    const newCounted = data.mode === 'add' ? sql`coalesce(${l.counted}, 0) + ${data.qty}` : sql`${data.qty}`;
    let [line] = await tx
      .update(l)
      .set({ counted: newCounted, updatedAt: ctx.clock.now() })
      .where(and(eq(l.countId, countId), eq(l.variantId, data.variantId)))
      .returning({ counted: l.counted });
    if (!line) {
      // An item found on the shelf that was not in the snapshot (for example outside the category).
      const [level] = await tx
        .select({ onHand: schema.stockLevel.onHand })
        .from(schema.stockLevel)
        .where(and(eq(schema.stockLevel.variantId, data.variantId), eq(schema.stockLevel.location, count.location)));
      [line] = await tx
        .insert(l)
        .values({ countId, variantId: data.variantId, expected: level?.onHand ?? 0, counted: data.qty })
        .returning({ counted: l.counted });
    }
    return { variantId: data.variantId, counted: line!.counted };
  });
}

async function transitionCount(tx: Tx, id: string, to: 'submitted' | 'approved' | 'cancelled' | 'open') {
  const [count] = await tx.select().from(schema.stockCount).where(eq(schema.stockCount.id, id)).for('update');
  if (!count) throw errors.notFound('Phiếu kiểm kho');
  if (!canTransition(STOCK_COUNT, count.status as keyof typeof STOCK_COUNT, to)) {
    throw errors.conflict('invalid_transition', 'Không thể chuyển phiếu kiểm kho sang trạng thái này.');
  }
  return count;
}

export async function submitCount(ctx: Ctx, id: string) {
  requirePermission(ctx, 'inventory.count');
  await ctx.db.transaction(async (tx) => {
    await transitionCount(tx, id, 'submitted');
    await tx.update(schema.stockCount).set({ status: 'submitted' }).where(eq(schema.stockCount.id, id));
  });
}

/** Cancel a count that is not approved yet (FR-INV-06). */
export async function cancelCount(ctx: Ctx, id: string) {
  requirePermission(ctx, 'inventory.count');
  await ctx.db.transaction(async (tx) => {
    const count = await transitionCount(tx, id, 'cancelled');
    await tx.update(schema.stockCount).set({ status: 'cancelled' }).where(eq(schema.stockCount.id, id));
    await audit.record(tx, ctx, { action: 'stock_count.cancel', entity: 'stock_count', entityId: id, after: { docNo: count.docNo } });
  });
}

/** Approval posts one `count` movement per variance (TDD §4.2); uncounted lines are left as they are. */
export async function approveCount(ctx: Ctx, id: string) {
  const actor = requirePermission(ctx, 'inventory.count_approve');
  return ctx.db.transaction(async (tx) => {
    const count = await transitionCount(tx, id, 'approved');
    const lines = await tx.select().from(schema.stockCountLine).where(eq(schema.stockCountLine.countId, id));
    let posted = 0;
    for (const line of lines) {
      if (line.counted === null) continue;
      // Variance against the stock at approval time, adjusted for movements since the snapshot,
      // equals counted − expected; post that difference.
      const delta = line.counted - line.expected;
      if (delta === 0) continue;
      await apply(tx, ctx, {
        variantId: line.variantId,
        location: count.location as Location,
        type: 'count',
        qtyDelta: delta,
        refType: 'stock_count',
        refId: id,
        note: count.docNo,
        force: true,
      });
      posted++;
    }
    await tx.update(schema.stockCount).set({ status: 'approved', approvedBy: actor.userId, approvedAt: ctx.clock.now() }).where(eq(schema.stockCount.id, id));
    await audit.record(tx, ctx, { action: 'stock_count.approve', entity: 'stock_count', entityId: id, after: { docNo: count.docNo, adjustments: posted } });
    return { posted };
  });
}

/**
 * Undo the moving-average effect of an inbound quantity that is being taken back out (import
 * rollback): avg_before = (H × avg − qty × unit) ÷ (H − qty), when stock remains afterwards.
 */
export async function restoreAverageCost(tx: Tx, variantId: string, location: Location, qty: number, unitCostVnd: number): Promise<void> {
  const sl = schema.stockLevel;
  const [cur] = await tx.select().from(sl).where(and(eq(sl.variantId, variantId), eq(sl.location, location))).for('update');
  if (!cur || cur.onHand - qty <= 0) return;
  const before = Math.round((cur.onHand * cur.avgCostVnd - qty * unitCostVnd) / (cur.onHand - qty));
  if (before >= 0) await tx.update(sl).set({ avgCostVnd: before }).where(and(eq(sl.variantId, variantId), eq(sl.location, location)));
}
