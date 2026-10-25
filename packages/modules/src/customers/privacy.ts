import { schema } from '@bookstore/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import { AppError, errors, requirePermission, type Ctx } from '../platform/index.js';
import { post } from './index.js';

/** Manual points adjustment and erasure on request (FR-CRM-06, FR-CRM-08, TDD §4.9). */

export const PointsAdjustSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Số điểm điều chỉnh phải khác 0.'),
  reason: z.string().trim().min(1, 'Cần nhập lý do điều chỉnh.').max(300),
});

export async function adjustPoints(ctx: Ctx, customerId: string, input: z.input<typeof PointsAdjustSchema>) {
  requirePermission(ctx, 'customer.adjust_points');
  const data = PointsAdjustSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [c] = await tx.select({ id: schema.customer.id, balance: schema.customer.pointsBalance }).from(schema.customer).where(eq(schema.customer.id, customerId));
    if (!c) throw errors.notFound('Khách hàng');
    await post(tx, ctx, { customerId, delta: data.delta, reason: 'adjust', note: data.reason });
    await audit.record(tx, ctx, { action: 'points.adjust', entity: 'customer', entityId: customerId, before: { balance: c.balance }, after: { delta: data.delta, reason: data.reason } });
    return { pointsBalance: c.balance + data.delta };
  });
}

export const EraseSchema = z.object({ reason: z.string().trim().min(1, 'Cần ghi lý do (yêu cầu của khách).').max(300) });

/**
 * Anonymise personal fields on request and keep the id and the financial history (FR-CRM-08,
 * Decree 13/2023). Contacts are removed and consents withdrawn. Irreversible.
 */
export async function erase(ctx: Ctx, customerId: string, input: z.input<typeof EraseSchema>) {
  requirePermission(ctx, 'customer.erase');
  const data = EraseSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const now = ctx.clock.now();
    const [row] = await tx
      .update(schema.customer)
      .set({
        name: 'Khách hàng đã xóa dữ liệu',
        phoneE164: null,
        email: null,
        birthDate: null,
        addresses: [],
        tags: [],
        note: null,
        searchText: '',
        anonymisedAt: now,
        updatedAt: now,
      })
      .where(and(eq(schema.customer.id, customerId), isNull(schema.customer.anonymisedAt)))
      .returning({ id: schema.customer.id });
    if (!row) {
      const [exists] = await tx.select({ id: schema.customer.id }).from(schema.customer).where(eq(schema.customer.id, customerId));
      if (!exists) throw errors.notFound('Khách hàng');
      throw new AppError(409, 'already_erased', 'Dữ liệu cá nhân của khách hàng này đã được xóa.');
    }
    await tx.delete(schema.customerContact).where(eq(schema.customerContact.customerId, customerId));
    await tx
      .update(schema.customerConsent)
      .set({ withdrawnAt: now })
      .where(and(eq(schema.customerConsent.customerId, customerId), isNull(schema.customerConsent.withdrawnAt)));
    await audit.record(tx, ctx, { action: 'customer.erase', entity: 'customer', entityId: customerId, after: { reason: data.reason } });
    return { id: customerId, anonymisedAt: now };
  });
}
