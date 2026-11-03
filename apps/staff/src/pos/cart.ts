import { foldText, normalizePhone, priceCart, vnd, type CartLineInput, type ManualDiscount, type PriceCartResult, type PromotionSnapshot } from '@bookstore/domain';
import { argon2Verify } from 'hash-wasm';
import { create } from 'zustand';
import { ApiError, get, post } from '../lib/api';
import { db, kvGet, kvSet, type CachedCustomer, type CachedItem } from './db';
import type { PosSettings } from './sync';

/**
 * Cart (FR-POS-01..05): lines, customer, coupon and points; priced with the same pure engine the
 * server uses (TDD §4.4), from the cached catalogue, promotions and tiers.
 */

export interface CartLine {
  lineId: string;
  variantId: string;
  qty: number;
  priceOverrideVnd?: number | null;
  manualDiscount?: ManualDiscount | null;
  note?: string;
}

export interface CartCustomer {
  id: string;
  name: string;
  phoneE164: string | null;
  tierCode: string | null;
  pointsBalance: number;
}

/** A pre-order recalled into the cart (FR-POS-09): its lines keep the agreed prices and quantities; the deposit counts as paid. */
export interface CartPreorder {
  id: string;
  docNo: string;
  lines: { variantId: string; qty: number; unitPriceVnd: number }[];
  depositVnd: number;
}

/** An unpaid library charge of the customer, sold as a service line (FR-POS-08): never discounted, no points. */
export interface CartLibraryCharge {
  id: string;
  description: string;
  amountVnd: number;
}

/** Supervisor approvals for this cart: an online token or an offline approver id (FR-ADM-09). */
export interface CartApproval {
  action: 'discount_over_limit' | 'price_override';
  token?: string;
  approverId?: string;
  approverName: string;
}

interface CartState {
  lines: CartLine[];
  customer: CartCustomer | null;
  couponCode: string;
  redeemPoints: number;
  approvals: CartApproval[];
  preorder: CartPreorder | null;
  libraryCharges: CartLibraryCharge[];
  /** Last added line, for the 600 ms highlight (Design §7.4). */
  flashLineId: string | null;
  add: (variantId: string, qty?: number) => void;
  setQty: (lineId: string, qty: number) => void;
  update: (lineId: string, patch: Partial<CartLine>) => void;
  remove: (lineId: string) => void;
  setCustomer: (c: CartCustomer | null) => void;
  setCoupon: (code: string) => void;
  setRedeem: (points: number) => void;
  addApproval: (a: CartApproval) => void;
  addLibraryCharges: (charges: CartLibraryCharge[]) => void;
  removeLibraryCharge: (id: string) => void;
  load: (s: Pick<CartState, 'lines' | 'customer' | 'couponCode' | 'redeemPoints'>) => void;
  /** Start a new cart from a pre-order (FR-POS-09). */
  loadPreorder: (p: CartPreorder, customer: CartCustomer) => void;
  clear: () => void;
}

/** Cart lines that came from the recalled pre-order. */
export const isPreorderLine = (lineId: string) => lineId.startsWith('pre-');

export const useCart = create<CartState>((set) => ({
  lines: [],
  customer: null,
  couponCode: '',
  redeemPoints: 0,
  approvals: [],
  preorder: null,
  libraryCharges: [],
  flashLineId: null,
  add: (variantId, qty = 1) =>
    set((s) => {
      // A pre-order line keeps its quantity: more copies of the same item go on a line of their own.
      const existing = s.lines.find((l) => l.variantId === variantId && !l.priceOverrideVnd && !l.manualDiscount && !isPreorderLine(l.lineId));
      if (existing) return { lines: s.lines.map((l) => (l === existing ? { ...l, qty: l.qty + qty } : l)), flashLineId: existing.lineId };
      const lineId = crypto.randomUUID().slice(0, 8);
      return { lines: [...s.lines, { lineId, variantId, qty }], flashLineId: lineId };
    }),
  setQty: (lineId, qty) => set((s) => ({ lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, qty: Math.max(1, qty) } : l)) })),
  update: (lineId, patch) => set((s) => ({ lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)), approvals: [] })),
  remove: (lineId) => set((s) => ({ lines: s.lines.filter((l) => l.lineId !== lineId) })),
  // Library charges belong to the customer: another customer drops them.
  setCustomer: (customer) => set((s) => ({ customer, redeemPoints: 0, libraryCharges: customer?.id === s.customer?.id ? s.libraryCharges : [] })),
  setCoupon: (couponCode) => set({ couponCode }),
  setRedeem: (redeemPoints) => set({ redeemPoints }),
  addApproval: (a) => set((s) => ({ approvals: [...s.approvals.filter((x) => x.action !== a.action), a] })),
  addLibraryCharges: (charges) => set((s) => ({ libraryCharges: [...s.libraryCharges, ...charges.filter((c) => !s.libraryCharges.some((x) => x.id === c.id))] })),
  removeLibraryCharge: (id) => set((s) => ({ libraryCharges: s.libraryCharges.filter((c) => c.id !== id) })),
  load: (c) => set({ ...c, approvals: [], preorder: null, libraryCharges: [], flashLineId: null }),
  loadPreorder: (p, customer) => set({ lines: p.lines.map((l, i) => ({ lineId: `pre-${i + 1}`, variantId: l.variantId, qty: l.qty })), customer, couponCode: '', redeemPoints: 0, approvals: [], preorder: p, libraryCharges: [], flashLineId: null }),
  clear: () => set({ lines: [], customer: null, couponCode: '', redeemPoints: 0, approvals: [], preorder: null, libraryCharges: [], flashLineId: null }),
}));

// ---------------------------------------------------------------------------------------------
// Catalogue lookups (NFR-PERF-01: barcode lookup locally in IndexedDB)

export async function findByCode(code: string): Promise<CachedItem | undefined> {
  const c = code.trim();
  const hit = await db.barcodes.get(c);
  return hit ? db.items.get(hit.variantId) : undefined;
}

export async function searchItems(q: string, limit = 20): Promise<CachedItem[]> {
  const term = foldText(q);
  if (!term) return [];
  const words = term.split(/\s+/);
  return db.items.filter((i) => words.every((w) => i.search.includes(w))).limit(limit).toArray();
}

export async function findCustomerByPhone(phone: string, online: boolean): Promise<CartCustomer | null> {
  const e164 = normalizePhone(phone);
  if (!e164) return null;
  if (online) {
    try {
      const r = await get<{ items: (CartCustomer & { tierCode: string | null })[] }>('/api/v1/customers', { phone: e164 });
      const c = r.items[0];
      return c ? { id: c.id, name: c.name, phoneE164: c.phoneE164, tierCode: c.tierCode, pointsBalance: c.pointsBalance } : null;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 0)) throw e;
    }
  }
  const cached: CachedCustomer | undefined = await db.customers.where('phoneE164').equals(e164).first();
  return cached ?? null;
}

/** Name search without accents (FR-POS-04); offline it runs on the cached customer list (TDD §7.1). */
export async function searchCustomersByName(q: string, online: boolean, limit = 8): Promise<CartCustomer[]> {
  const term = foldText(q).trim();
  if (term.length < 2) return [];
  if (online) {
    try {
      const r = await get<{ items: CartCustomer[] }>('/api/v1/customers', { q: term });
      return r.items.slice(0, limit).map((c) => ({ id: c.id, name: c.name, phoneE164: c.phoneE164, tierCode: c.tierCode, pointsBalance: c.pointsBalance }));
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 0)) throw e;
    }
  }
  const words = term.split(/\s+/);
  return db.customers.filter((c) => words.every((w) => foldText(c.name).includes(w))).limit(limit).toArray();
}

// ---------------------------------------------------------------------------------------------
// Local pricing

export interface PricedCart {
  result: PriceCartResult;
  items: Map<string, CachedItem>;
}

export async function priceLocally(cart: Pick<CartState, 'lines' | 'customer' | 'couponCode' | 'redeemPoints' | 'preorder' | 'libraryCharges'>, grants: { discountUnlimited: boolean; priceOverride: boolean }): Promise<PricedCart | null> {
  const settings = await kvGet<PosSettings>('settings');
  // A cart of library charges only still prices (an empty goods cart).
  if (!settings || (!cart.lines.length && !cart.libraryCharges.length)) return null;
  const items = new Map((await db.items.bulkGet(cart.lines.map((l) => l.variantId))).filter((i): i is CachedItem => !!i).map((i) => [i.variantId, i]));
  const promotions = (await kvGet<PromotionSnapshot[]>('promotions')) ?? [];
  const tiers = (await kvGet<{ code: string; benefits: { discountBp: number; pointsMultiplierBp: number } }[]>('tiers')) ?? [];
  const tier = cart.customer ? tiers.find((t) => t.code === cart.customer!.tierCode) : undefined;
  const lines: CartLineInput[] = cart.lines
    .filter((l) => items.has(l.variantId))
    .map((l) => {
      const i = items.get(l.variantId)!;
      return {
        lineId: l.lineId,
        variantId: l.variantId,
        itemClass: 'goods',
        categoryIds: i.categoryIds,
        publisherId: i.publisherId,
        brandId: i.brandId,
        qty: l.qty,
        // The pre-order's agreed price, as the server prices it (FR-POS-09).
        unitPriceVnd: vnd((isPreorderLine(l.lineId) && cart.preorder?.lines.find((x) => x.variantId === l.variantId)?.unitPriceVnd) || i.priceVnd),
        vatBp: i.vatBp,
        priceOverrideVnd: l.priceOverrideVnd == null ? null : vnd(l.priceOverrideVnd),
        manualDiscount: l.manualDiscount ?? null,
      };
    });
  const result = priceCart({
    lines,
    channel: 'counter',
    customer: cart.customer
      ? { tierCode: cart.customer.tierCode ?? 'standard', tierDiscountBp: tier?.benefits.discountBp ?? 0, pointsMultiplierBp: tier?.benefits.pointsMultiplierBp ?? 10000, pointsBalance: cart.customer.pointsBalance }
      : null,
    promotions,
    couponCode: cart.couponCode || null,
    redeemPoints: cart.redeemPoints,
    settings: {
      cashierDiscountMaxBp: settings.cashierDiscountMaxBp,
      earnVndPerPoint: settings.earnVndPerPoint,
      pointValueVnd: settings.pointValueVnd,
      minRedeemPoints: settings.minRedeemPoints,
      categoryMaxDiscountBp: {},
    },
    grants,
  });
  return { result, items };
}

// ---------------------------------------------------------------------------------------------
// Supervisor approval (FR-ADM-09, TDD §7.6–7.7)

const MAX_OFFLINE_ATTEMPTS = 5;

export async function approveOnline(approverUsername: string, pin: string, action: CartApproval['action']): Promise<CartApproval> {
  const r = await post<{ approvalToken: string; approverName: string }>('/api/v1/auth/approve', { approverUsername, pin, action });
  return { action, token: r.approvalToken, approverName: r.approverName };
}

/** Offline: verify against the cached salted, slow verifier; 5 wrong attempts lock out, surviving restarts. */
export async function approveOffline(approverUsername: string, pin: string, action: CartApproval['action']): Promise<CartApproval> {
  const failures = (await kvGet<number>('approvalFailures')) ?? 0;
  if (failures >= MAX_OFFLINE_ATTEMPTS) throw new ApiError(429, 'too_many_attempts', 'Nhập sai quá nhiều lần. Cần kết nối mạng để duyệt.');
  const a = await db.approvers.where('username').equalsIgnoreCase(approverUsername.trim()).first();
  const ok = !!a && a.actions.includes(action) && (await argon2Verify({ password: pin, hash: a.pinVerifier }).catch(() => false));
  if (!ok) {
    await kvSet('approvalFailures', failures + 1);
    throw new ApiError(401, 'invalid_approval', `Thông tin duyệt không đúng (còn ${MAX_OFFLINE_ATTEMPTS - failures - 1} lần).`);
  }
  await kvSet('approvalFailures', 0);
  return { action, approverId: a!.userId, approverName: a!.displayName };
}
