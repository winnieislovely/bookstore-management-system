import type { PriceCartResult } from '@bookstore/domain';
import { ApiError, get, post } from '../lib/api';
import type { CartApproval, CartCustomer, CartLine } from './cart';
import { kvGet, kvSet, type CachedItem } from './db';
import { deviceInfo } from './device';
import { enqueue } from './sync';

/**
 * POS actions: shifts and sale completion. Online first; when the network fails and this browser
 * is a registered device, the action is recorded in the outbox and synced later (FR-POS-23/24).
 */

export interface LocalShift {
  serverId: string | null;
  clientId: string | null;
  shiftNo: number | null;
  registerId: string;
  openedAt: string;
  floatVnd: number;
  /** Drawer tally kept on the device so an offline close can show expected cash. */
  cashSalesVnd: number;
  cashInVnd: number;
  cashOutVnd: number;
}

export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;

export async function getShift(): Promise<LocalShift | null> {
  return (await kvGet<LocalShift>('shift')) ?? null;
}

async function saveShift(s: LocalShift | null) {
  await kvSet('shift', s);
}

/** Pick up a shift opened elsewhere (another device or the back office) for this register. */
export async function refreshShift(registerId: string): Promise<LocalShift | null> {
  try {
    const r = await get<{ shift: { id: string; shiftNo: number; openedAt: string; floatVnd: number } | null }>('/api/v1/pos/shifts/current', { register: registerId });
    const local = await getShift();
    if (!r.shift) {
      // Keep a shift opened offline that the server does not know yet.
      if (local?.clientId && !local.serverId) return local;
      await saveShift(null);
      return null;
    }
    if (local?.serverId === r.shift.id) return local;
    const s: LocalShift = { serverId: r.shift.id, clientId: null, shiftNo: r.shift.shiftNo, registerId, openedAt: r.shift.openedAt, floatVnd: r.shift.floatVnd, cashSalesVnd: 0, cashInVnd: 0, cashOutVnd: 0 };
    await saveShift(s);
    return s;
  } catch (e) {
    if (isNetworkError(e)) return getShift();
    throw e;
  }
}

export async function openShift(registerId: string, floatVnd: number, openedBy: string): Promise<LocalShift> {
  try {
    const r = await post<{ id: string; shiftNo: number; openedAt: string }>('/api/v1/pos/shifts/open', { registerId, floatVnd });
    const s: LocalShift = { serverId: r.id, clientId: null, shiftNo: r.shiftNo, registerId, openedAt: r.openedAt, floatVnd, cashSalesVnd: 0, cashInVnd: 0, cashOutVnd: 0 };
    await saveShift(s);
    return s;
  } catch (e) {
    if (!isNetworkError(e) || !(await deviceInfo())) throw e;
    const clientId = crypto.randomUUID();
    const openedAt = new Date().toISOString();
    await enqueue('shift.opened', () => ({ clientShiftId: clientId, floatVnd, openedBy, openedAt }));
    const s: LocalShift = { serverId: null, clientId, shiftNo: null, registerId, openedAt, floatVnd, cashSalesVnd: 0, cashInVnd: 0, cashOutVnd: 0 };
    await saveShift(s);
    return s;
  }
}

export function expectedLocal(s: LocalShift): number {
  return s.floatVnd + s.cashSalesVnd + s.cashInVnd - s.cashOutVnd;
}

/** Expected cash: the server's shift report when online, the device tally otherwise. */
export async function expectedCash(s: LocalShift): Promise<{ expectedVnd: number; source: 'server' | 'device' }> {
  if (s.serverId) {
    try {
      const r = await get<{ cash: { expectedVnd: number } }>(`/api/v1/pos/shifts/${s.serverId}`);
      return { expectedVnd: r.cash.expectedVnd, source: 'server' };
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  return { expectedVnd: expectedLocal(s), source: 'device' };
}

export async function closeShift(s: LocalShift, countedVnd: number, denominations: Record<string, number> | undefined, varianceReason: string | undefined, closedBy: string) {
  if (s.serverId && navigator.onLine) {
    try {
      const r = await post<{ varianceVnd: number; expectedVnd: number }>('/api/v1/pos/shifts/close', { shiftId: s.serverId, countedVnd, ...(denominations && { denominations }), ...(varianceReason && { varianceReason }) });
      await saveShift(null);
      return r;
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  if (!(await deviceInfo())) throw new ApiError(0, 'network_error', 'Cần kết nối mạng để đóng ca trên máy chưa đăng ký.');
  const expected = expectedLocal(s);
  await enqueue('shift.closed', () => ({
    clientShiftId: s.clientId ?? s.serverId,
    countedVnd,
    ...(denominations && { denominations }),
    ...(varianceReason && { varianceReason }),
    closedBy,
    closedAt: new Date().toISOString(),
  }));
  await saveShift(null);
  return { varianceVnd: countedVnd - expected, expectedVnd: expected };
}

export async function cashMovement(s: LocalShift, direction: 'in' | 'out', amountVnd: number, reason: string, by: string) {
  try {
    if (!s.serverId) throw new ApiError(0, 'network_error', '');
    await post('/api/v1/pos/cash-movements', { shiftId: s.serverId, direction, amountVnd, reason });
  } catch (e) {
    if (!isNetworkError(e) || !(await deviceInfo())) throw e;
    await enqueue('cash.movement', () => ({ clientShiftId: s.clientId ?? s.serverId, direction, amountVnd, reason, by, at: new Date().toISOString() }));
  }
  await saveShift({ ...s, ...(direction === 'in' ? { cashInVnd: s.cashInVnd + amountVnd } : { cashOutVnd: s.cashOutVnd + amountVnd }) });
}

// ---------------------------------------------------------------------------------------------
// Sale completion

export type Payment =
  | { method: 'cash'; amountVnd: number; tenderedVnd: number }
  | { method: 'transfer'; amountVnd: number; ref: string }
  | { method: 'card'; amountVnd: number; ref: string };

export interface SaleInput {
  shift: LocalShift;
  cashierId: string;
  lines: CartLine[];
  customer: CartCustomer | null;
  couponCode: string;
  redeemPoints: number;
  approvals: CartApproval[];
  payments: Payment[];
  priced: PriceCartResult;
  items: Map<string, CachedItem>;
  /** Collecting a pre-order (FR-POS-09): needs the server. */
  preorderId?: string | null;
}

export interface SaleOutcome {
  docNo: string;
  saleId: string | null;
  totalVnd: number;
  changeVnd: number;
  pointsEarned: number | null;
  offline: boolean;
  printSlip: boolean;
}

export async function completeSale(input: SaleInput, idempotencyKey: string): Promise<SaleOutcome> {
  const changeVnd = input.payments.reduce((a, p) => a + (p.method === 'cash' ? p.tenderedVnd - p.amountVnd : 0), 0);
  const cashVnd = input.payments.reduce((a, p) => a + (p.method === 'cash' ? p.amountVnd : 0), 0);
  const tallyCash = async () => {
    const s = await getShift();
    if (s) await saveShift({ ...s, cashSalesVnd: s.cashSalesVnd + cashVnd });
  };
  if (input.preorderId && !input.shift.serverId) throw new ApiError(0, 'network_error', 'Cần kết nối mạng để nhận hàng đặt trước.');
  if (input.shift.serverId) {
    try {
      const approvals = Object.fromEntries(input.approvals.filter((a) => a.token).map((a) => [a.action, a.token!]));
      const r = await fetch('/api/v1/pos/sales', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-bms-request': '1', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({
          shiftId: input.shift.serverId,
          lines: input.lines.map((l) => ({ lineId: l.lineId, variantId: l.variantId, qty: l.qty, priceOverrideVnd: l.priceOverrideVnd ?? null, manualDiscount: l.manualDiscount ?? null, ...(l.note && { note: l.note }) })),
          customerId: input.customer?.id ?? null,
          couponCode: input.couponCode || null,
          redeemPoints: input.redeemPoints,
          approvals,
          payments: input.payments.map((p) => (p.method === 'cash' ? { method: 'cash', amountVnd: p.amountVnd, tenderedVnd: p.tenderedVnd } : p)),
          ...(input.preorderId && { preorderId: input.preorderId }),
        }),
      }).catch(() => {
        throw new ApiError(0, 'network_error', '');
      });
      const body = (await r.json()) as { docNo: string; id: string; totalVnd: number; pointsEarned: number; printSlip: boolean; error?: { code: string; message: string; details?: unknown } };
      if (!r.ok) throw new ApiError(r.status, body.error?.code ?? 'http_error', body.error?.message ?? '', body.error?.details);
      await tallyCash();
      return { docNo: body.docNo, saleId: body.id, totalVnd: body.totalVnd, changeVnd, pointsEarned: body.pointsEarned, offline: false, printSlip: body.printSlip };
    } catch (e) {
      if (input.preorderId && isNetworkError(e)) throw new ApiError(0, 'network_error', 'Cần kết nối mạng để nhận hàng đặt trước.');
      if (!isNetworkError(e) || !(await deviceInfo())) throw e;
    }
  }
  if (!(await deviceInfo())) throw new ApiError(0, 'network_error', 'Mất kết nối và máy này chưa được đăng ký bán ngoại tuyến.');
  // Offline: the device price is the fact (TDD §7.6); the server recomputes points.
  const p = input.priced;
  const { docNo } = await enqueue(
    'sale.completed',
    (no) => ({
      docNo: no,
      ...(input.shift.clientId ? { clientShiftId: input.shift.clientId } : { shiftId: input.shift.serverId }),
      cashierId: input.cashierId,
      customerId: input.customer?.id ?? null,
      soldAt: new Date().toISOString(),
      lines: p.lines.map((l) => ({
        variantId: l.variantId,
        description: input.items.get(l.variantId)?.title ?? '',
        qty: l.qty,
        unitPriceVnd: l.unitPriceVnd,
        discountVnd: l.discountVnd,
        totalVnd: l.totalVnd,
        vatBp: l.vatBp,
        vatVnd: l.vatVnd,
        promotionVersionIds: l.promotionVersionIds,
      })),
      payments: input.payments.map((x) => (x.method === 'cash' ? { method: 'cash', amountVnd: x.amountVnd, tenderedVnd: x.tenderedVnd } : x)),
      subtotalVnd: p.subtotalVnd,
      discountVnd: p.discountVnd,
      totalVnd: p.totalVnd,
      vatVnd: p.vatVnd,
      redeemPoints: p.redeemPoints,
      pointsDiscountVnd: p.redeemValueVnd,
      ...(input.couponCode && p.couponApplied && { couponCode: input.couponCode }),
      approvals: input.approvals.filter((a) => a.approverId).map((a) => ({ approverId: a.approverId, action: a.action })),
    }),
    true,
  );
  await tallyCash();
  const settings = await kvGet<{ printSalesSlip: boolean }>('settings');
  return { docNo: docNo!, saleId: null, totalVnd: p.totalVnd, changeVnd, pointsEarned: null, offline: true, printSlip: settings?.printSalesSlip ?? false };
}
