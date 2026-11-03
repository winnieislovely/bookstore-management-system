import { schema } from '@bookstore/db';
import { formatVnd } from '@bookstore/domain';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as settings from '../settings/index.js';
import { errors, requirePermission, type Ctx } from '../platform/index.js';

/** Product share card for chats and posts (FR-SOC-04): title, price, availability and link. */

export const ShareCardSchema = z.object({ variantId: z.uuid() });

export async function shareCard(ctx: Ctx, input: z.input<typeof ShareCardSchema>) {
  requirePermission(ctx, 'online.manage');
  const { variantId } = ShareCardSchema.parse(input);
  const [v] = await ctx.db
    .select({ sku: schema.itemVariant.sku, priceVnd: schema.itemVariant.priceVnd, slug: schema.item.slug, i18n: schema.item.i18n, releaseDate: schema.item.releaseDate })
    .from(schema.itemVariant)
    .innerJoin(schema.item, eq(schema.item.id, schema.itemVariant.itemId))
    .where(eq(schema.itemVariant.id, variantId));
  if (!v) throw errors.notFound('Sản phẩm');
  const [lvl] = await ctx.db.execute<{ available: number }>(sql`select coalesce(sum(on_hand - reserved), 0)::int as available from inventory.stock_level where variant_id = ${variantId}::uuid`);
  const cfg = await settings.snapshot(ctx);
  const available = lvl?.available ?? 0;
  const upcoming = v.releaseDate !== null && v.releaseDate > ctx.clock.now().toISOString().slice(0, 10);
  // The labels the website shows (FR-WEB-38); the exact count stays with staff.
  const availability = upcoming ? 'Sắp phát hành – nhận đặt trước' : available <= 0 ? 'Hết hàng – nhận đặt trước' : available <= cfg['web.stock_low_threshold'] ? 'Sắp hết hàng' : 'Còn hàng';
  const title = v.i18n.vi?.title || v.i18n.en.title;
  const url = cfg['web.product_url'] ? cfg['web.product_url'].replace('{slug}', encodeURIComponent(v.slug)) : null;
  const text = [title, `Giá: ${formatVnd(v.priceVnd)}`, availability, url].filter(Boolean).join('\n');
  return { title, priceVnd: v.priceVnd, availability, url, text };
}
