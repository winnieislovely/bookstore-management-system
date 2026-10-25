import { schema } from '@bookstore/db';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import { AppError, errors, requirePermission, type Ctx, type Tx } from '../platform/index.js';

/**
 * Master data (FR-ADM-10, TDD §4.12): configurable lists referenced by code, so labels can be
 * renamed without code changes. Staff-only labels are Vietnamese (`{ vi: { name } }`, TDD §5.1).
 */
export const MASTER_KINDS = ['unit', 'reason_code', 'payment_method', 'order_source', 'holiday', 'location'] as const;
export type MasterKind = (typeof MASTER_KINDS)[number];

/** Kinds whose codes are fixed by the system: only the label, order and active flag can change. */
const FIXED_CODES: Partial<Record<MasterKind, readonly string[]>> = {
  payment_method: ['cash', 'transfer', 'card', 'store_credit'],
  location: ['floor', 'back'],
};

const DEFAULTS: Record<MasterKind, [string, string][]> = {
  unit: [
    ['cuon', 'Cuốn'],
    ['cai', 'Cái'],
    ['hop', 'Hộp'],
    ['bo', 'Bộ'],
    ['quyen', 'Quyển'],
  ],
  reason_code: [
    ['damaged', 'Hư hỏng'],
    ['lost', 'Mất'],
    ['found', 'Tìm thấy'],
    ['correction', 'Điều chỉnh sai sót'],
    ['expired', 'Hết hạn sử dụng'],
    ['gift', 'Tặng / khuyến mãi'],
    ['import_rollback', 'Hoàn tác nhập dữ liệu'],
  ],
  payment_method: [
    ['cash', 'Tiền mặt'],
    ['transfer', 'Chuyển khoản'],
    ['card', 'Thẻ'],
    ['store_credit', 'Tiền ghi có'],
  ],
  order_source: [
    ['website', 'Website'],
    ['facebook', 'Facebook'],
    ['zalo', 'Zalo'],
    ['instagram', 'Instagram'],
    ['tiktok', 'TikTok'],
    ['marketplace', 'Sàn thương mại điện tử'],
    ['phone', 'Điện thoại'],
    ['other', 'Khác'],
  ],
  holiday: [],
  location: [
    ['floor', 'Quầy kệ'],
    ['back', 'Kho sau'],
  ],
};

export async function seed(tx: Tx): Promise<void> {
  for (const kind of MASTER_KINDS) {
    const rows = DEFAULTS[kind].map(([code, name], sort) => ({ kind, code, i18n: { vi: { name } }, sort }));
    if (rows.length) await tx.insert(schema.masterData).values(rows).onConflictDoNothing();
  }
}

export async function list(ctx: Ctx, kind: MasterKind, includeInactive = false) {
  if (!ctx.actor) throw errors.unauthenticated();
  const m = schema.masterData;
  return ctx.db
    .select()
    .from(m)
    .where(and(eq(m.kind, kind), includeInactive ? undefined : eq(m.active, true)))
    .orderBy(asc(m.sort), asc(m.code));
}

export const EntrySchema = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).default(0),
  /** Holidays: the date (`YYYY-MM-DD`), used by payroll overtime (BR-18). */
  date: z.iso.date().optional(),
});

export async function upsert(ctx: Ctx, kind: MasterKind, code: string, input: z.input<typeof EntrySchema>) {
  requirePermission(ctx, 'settings.manage');
  const data = EntrySchema.parse(input);
  if (!/^[a-z0-9_-]{1,40}$/.test(code)) throw new AppError(400, 'invalid_code', 'Mã chỉ gồm chữ thường, số, gạch nối hoặc gạch dưới.');
  const fixed = FIXED_CODES[kind];
  if (fixed && !fixed.includes(code)) throw new AppError(409, 'fixed_codes', 'Danh sách này chỉ đổi được tên, thứ tự và trạng thái.');
  if (kind === 'holiday' && !data.date) throw new AppError(400, 'date_required', 'Ngày lễ cần có ngày.');
  return ctx.db.transaction(async (tx) => {
    const m = schema.masterData;
    const [before] = await tx.select().from(m).where(and(eq(m.kind, kind), eq(m.code, code)));
    const i18n = { vi: { name: data.name, ...(data.date && { date: data.date }) } };
    await tx
      .insert(m)
      .values({ kind, code, i18n, active: data.active, sort: data.sort })
      .onConflictDoUpdate({ target: [m.kind, m.code], set: { i18n, active: data.active, sort: data.sort } });
    await audit.record(tx, ctx, { action: 'master_data.upsert', entity: 'master_data', entityId: `${kind}:${code}`, before: before ?? null, after: { i18n, active: data.active, sort: data.sort } });
    return { kind, code };
  });
}

/** True when `code` is an active entry of `kind` (validation of references, TDD §4.12). */
export async function isActive(tx: Tx, kind: MasterKind, code: string): Promise<boolean> {
  const [row] = await tx.select({ active: schema.masterData.active }).from(schema.masterData).where(and(eq(schema.masterData.kind, kind), eq(schema.masterData.code, code)));
  return row?.active === true;
}
