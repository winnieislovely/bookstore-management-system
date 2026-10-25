import { schema } from '@bookstore/db';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import { AppError, emit, errors, requirePermission, type Ctx } from '../platform/index.js';

/**
 * Bundles (FR-CAT-12, TDD §4.1): a bundle variant has its own price but no stock; selling it
 * deducts its components (`bundle_use`). Its availability is computed from the components.
 */

/** Available quantity of a variant: its own stock, or for a bundle ⌊component available ÷ qty⌋ (min). */
export function availableSql(variantId: SQL | string): SQL {
  const v = typeof variantId === 'string' ? sql`${variantId}::uuid` : variantId;
  return sql`(case when exists (select 1 from catalog.bundle_component bc where bc.bundle_variant_id = ${v})
    then coalesce((select min(floor(coalesce((select sum(s.on_hand - s.reserved) from inventory.stock_level s where s.variant_id = bc.component_variant_id), 0)::numeric / bc.qty))
                   from catalog.bundle_component bc where bc.bundle_variant_id = ${v}), 0)
    else coalesce((select sum(s.on_hand - s.reserved) from inventory.stock_level s where s.variant_id = ${v}), 0) end)::int`;
}

export const ComponentsSchema = z.object({
  components: z.array(z.object({ variantId: z.uuid(), qty: z.number().int().positive() })).min(2, 'Combo cần ít nhất hai sản phẩm.').max(20),
});

export async function setComponents(ctx: Ctx, bundleVariantId: string, input: z.input<typeof ComponentsSchema>) {
  requirePermission(ctx, 'catalog.edit');
  const data = ComponentsSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [b] = await tx
      .select({ id: schema.itemVariant.id, itemId: schema.itemVariant.itemId, kind: schema.item.kind })
      .from(schema.itemVariant)
      .innerJoin(schema.item, eq(schema.item.id, schema.itemVariant.itemId))
      .where(eq(schema.itemVariant.id, bundleVariantId));
    if (!b) throw errors.notFound('Combo');
    if (b.kind !== 'bundle') throw new AppError(400, 'not_a_bundle', 'Chỉ sản phẩm loại combo mới có thành phần.');
    const ids = data.components.map((c) => c.variantId);
    if (new Set(ids).size !== ids.length) throw new AppError(400, 'duplicate_component', 'Mỗi sản phẩm chỉ xuất hiện một lần trong combo.');
    if (ids.includes(bundleVariantId)) throw new AppError(400, 'self_component', 'Combo không thể chứa chính nó.');
    const comps = await tx
      .select({ id: schema.itemVariant.id, kind: schema.item.kind })
      .from(schema.itemVariant)
      .innerJoin(schema.item, eq(schema.item.id, schema.itemVariant.itemId))
      .where(inArray(schema.itemVariant.id, ids));
    if (comps.length !== ids.length) throw errors.notFound('Sản phẩm thành phần');
    if (comps.some((c) => c.kind === 'bundle')) throw new AppError(400, 'nested_bundle', 'Combo không chứa combo khác.');
    const [own] = await tx.execute<{ n: number }>(sql`select coalesce(sum(on_hand), 0)::int as n from inventory.stock_level where variant_id = ${bundleVariantId}::uuid`);
    if (own!.n !== 0) throw new AppError(409, 'bundle_has_stock', 'Combo đang có tồn kho riêng; hãy điều chỉnh về 0 trước.');
    await tx.delete(schema.bundleComponent).where(eq(schema.bundleComponent.bundleVariantId, bundleVariantId));
    await tx.insert(schema.bundleComponent).values(data.components.map((c) => ({ bundleVariantId, componentVariantId: c.variantId, qty: c.qty })));
    await tx.insert(schema.catalogChange).values({ entity: 'item', entityId: b.itemId, op: 'upsert' });
    await emit(tx, 'item.changed', { itemId: b.itemId });
    await audit.record(tx, ctx, { action: 'bundle.components', entity: 'item_variant', entityId: bundleVariantId, after: data });
    const [avail] = await tx.execute<{ a: number }>(sql`select ${availableSql(bundleVariantId)} as a`);
    return { bundleVariantId, components: data.components, available: avail!.a };
  });
}
