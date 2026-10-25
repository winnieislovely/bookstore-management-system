import { allocate, applyBp, BP_100, vnd, type Bp, type Vnd } from './money.js';
import type { PromotionRule, SalesChannel } from './promotions.js';
import { vatIncluded } from './vat.js';

/**
 * Pricing engine (TDD §4.4): `priceCart` is a PURE function. The same code runs on the server and
 * in the offline POS. Inputs are the cart lines, the customer's tier, a snapshot of active
 * promotion versions and the settings it needs; output is every line's discounts and VAT, and the
 * totals. All amounts are integer VND and VAT-inclusive (BR-02).
 *
 * Order of application per line:
 *   1. price override (permission `sale.price_override`)
 *   2. automatic promotions (FR-POS-05), highest priority first, with stacking rules (FR-PRM-03)
 *   3. tier discount (FR-CRM-05)
 *   4. the per-category maximum discount caps 2 + 3 (FR-PRM-05)
 *   5. the cashier's manual line discount, checked against the role limit (FR-POS-02, BR-05)
 *   6. order-level promotions spread across lines proportionally; fixed-amount promotions are
 *      always taken once per order, whatever the scope (FR-PRM-01)
 *   7. redeemed loyalty points: a discount, not a payment (FR-POS-05, BR-07), spread over the
 *      point-earning lines
 */

/** Item classes; event tickets, deposits and fines earn no points (FR-CRM-04, BR-07). */
export type ItemClass = 'goods' | 'event_ticket' | 'library_deposit' | 'library_fine' | 'library_charge';

const EARNS_POINTS: Record<ItemClass, boolean> = {
  goods: true,
  event_ticket: false,
  library_deposit: false,
  library_fine: false,
  library_charge: false,
};

/** Service items are never discounted by goods promotions or tiers. */
const DISCOUNTABLE: Record<ItemClass, boolean> = {
  goods: true,
  event_ticket: true,
  library_deposit: false,
  library_fine: false,
  library_charge: false,
};

export type ManualDiscount = { kind: 'percent'; bp: Bp } | { kind: 'amount'; vnd: Vnd };

export interface CartLineInput {
  lineId: string;
  variantId: string;
  itemClass: ItemClass;
  categoryIds: readonly string[];
  publisherId?: string | null;
  brandId?: string | null;
  qty: number;
  /** Current selling price (VAT inclusive). */
  unitPriceVnd: Vnd;
  vatBp: Bp;
  priceOverrideVnd?: Vnd | null;
  manualDiscount?: ManualDiscount | null;
}

export interface PromotionSnapshot {
  promotionId: string;
  versionId: string;
  name: string;
  rule: PromotionRule;
  /** Usage limits are counted on the server; the snapshot says whether they are already used up. */
  usageExhausted?: boolean;
}

export interface CustomerPricing {
  tierCode: string;
  tierDiscountBp: Bp;
  pointsMultiplierBp: Bp;
  pointsBalance: number;
}

export interface PricingSettings {
  cashierDiscountMaxBp: Bp;
  earnVndPerPoint: number;
  pointValueVnd: number;
  minRedeemPoints: number;
  /** FR-PRM-05: category id → maximum promotional discount (bp). Absent = no cap (default). */
  categoryMaxDiscountBp: Readonly<Record<string, Bp>>;
}

export interface PriceCartInput {
  lines: readonly CartLineInput[];
  channel: SalesChannel;
  customer?: CustomerPricing | null;
  promotions: readonly PromotionSnapshot[];
  couponCode?: string | null;
  redeemPoints?: number;
  shippingVnd?: Vnd;
  settings: PricingSettings;
  /** Caller's grants that change what is allowed without approval. */
  grants: { discountUnlimited: boolean; priceOverride: boolean };
}

export interface PricedLine {
  lineId: string;
  variantId: string;
  qty: number;
  unitPriceVnd: Vnd;
  grossVnd: Vnd;
  promoDiscountVnd: Vnd;
  tierDiscountVnd: Vnd;
  manualDiscountVnd: Vnd;
  orderDiscountVnd: Vnd;
  pointsDiscountVnd: Vnd;
  discountVnd: Vnd;
  totalVnd: Vnd;
  vatBp: Bp;
  vatVnd: Vnd;
  promotionVersionIds: string[];
  savings: { promotionId: string; label: string; amountVnd: Vnd }[];
}

export type ApprovalReason =
  | { code: 'discount_over_limit'; lineId: string; discountBp: Bp; limitBp: Bp }
  | { code: 'price_override'; lineId: string };

export type PricingIssue =
  | { code: 'coupon_not_found'; couponCode: string }
  | { code: 'coupon_not_eligible'; couponCode: string }
  | { code: 'points_below_minimum'; minimum: number }
  | { code: 'points_exceed_balance'; balance: number }
  | { code: 'points_exceed_total' };

export interface PriceCartResult {
  lines: PricedLine[];
  subtotalVnd: Vnd;
  discountVnd: Vnd;
  totalVnd: Vnd;
  vatVnd: Vnd;
  shippingVnd: Vnd;
  shippingDiscountVnd: Vnd;
  gifts: { variantId: string; qty: number; promotionId: string }[];
  appliedPromotionVersionIds: string[];
  couponApplied: boolean;
  redeemPoints: number;
  redeemValueVnd: Vnd;
  pointsToEarn: number;
  approvalsRequired: ApprovalReason[];
  issues: PricingIssue[];
}

interface WorkLine {
  input: CartLineInput;
  unit: Vnd;
  gross: number;
  promo: number;
  tier: number;
  manual: number;
  order: number;
  points: number;
  /** True once a non-stackable promotion took this line. */
  locked: boolean;
  promoted: boolean;
  versionIds: string[];
  savings: { promotionId: string; label: string; amountVnd: Vnd }[];
}

function lineInScope(line: CartLineInput, rule: PromotionRule): boolean {
  if (!DISCOUNTABLE[line.itemClass]) return false;
  const s = rule.scope;
  switch (s.kind) {
    case 'order':
    case 'tier':
      return line.itemClass === 'goods';
    case 'product':
      return s.variantIds.includes(line.variantId);
    case 'category':
      return line.categoryIds.some((c) => s.categoryIds.includes(c));
    case 'publisher':
      return line.publisherId != null && s.publisherIds.includes(line.publisherId);
    case 'brand':
      return line.brandId != null && s.brandIds.includes(line.brandId);
    case 'event_ticket':
      return line.itemClass === 'event_ticket';
  }
}

function isOrderLevel(rule: PromotionRule): boolean {
  if (rule.type === 'fixed') return true; // once per order, whatever the scope (FR-PRM-01)
  return rule.type === 'percent' && (rule.scope.kind === 'order' || rule.scope.kind === 'tier');
}

function remaining(l: WorkLine): number {
  return l.gross - l.promo;
}

/** Expand units of the given lines, cheapest first, for buy-X-get-Y. */
function unitsCheapestFirst(lines: WorkLine[]): { line: WorkLine; price: number }[] {
  const units: { line: WorkLine; price: number }[] = [];
  for (const l of lines) for (let i = 0; i < l.input.qty; i++) units.push({ line: l, price: l.unit });
  return units.sort((a, b) => a.price - b.price);
}

export function priceCart(input: PriceCartInput): PriceCartResult {
  const issues: PricingIssue[] = [];
  const approvals: ApprovalReason[] = [];
  const coupon = input.couponCode?.trim().toUpperCase() || null;

  const work: WorkLine[] = input.lines.map((l) => {
    if (!Number.isSafeInteger(l.qty) || l.qty < 1) throw new RangeError(`Invalid quantity on line ${l.lineId}`);
    const overridden = l.priceOverrideVnd != null && l.priceOverrideVnd !== l.unitPriceVnd;
    if (overridden && !input.grants.priceOverride) approvals.push({ code: 'price_override', lineId: l.lineId });
    const unit = overridden ? l.priceOverrideVnd! : l.unitPriceVnd;
    return {
      input: l,
      unit,
      gross: unit * l.qty,
      promo: 0,
      tier: 0,
      manual: 0,
      order: 0,
      points: 0,
      locked: false,
      promoted: false,
      versionIds: [],
      savings: [],
    };
  });

  const goodsSubtotal = work.reduce((a, l) => a + (l.input.itemClass === 'goods' ? l.gross : 0), 0);

  // Eligibility (FR-PRM-03): channel, minimum order value, coupon, usage limits, tier scope.
  let couponMatched = false;
  const eligible = input.promotions.filter((p) => {
    const c = p.rule.conditions;
    if (p.usageExhausted) return false;
    if (c.channels && !c.channels.includes(input.channel)) return false;
    if (c.couponCode) {
      if (coupon !== c.couponCode.toUpperCase()) return false;
      couponMatched = true;
    }
    if (c.minOrderVnd != null && goodsSubtotal < c.minOrderVnd) {
      if (c.couponCode) issues.push({ code: 'coupon_not_eligible', couponCode: coupon! });
      return false;
    }
    if (p.rule.scope.kind === 'tier' && !(input.customer && p.rule.scope.tierCodes.includes(input.customer.tierCode))) {
      return false;
    }
    return true;
  });
  if (coupon && !couponMatched) issues.push({ code: 'coupon_not_found', couponCode: coupon });

  const sorted = [...eligible].sort((a, b) => b.rule.priority - a.rule.priority || a.versionId.localeCompare(b.versionId));
  const gifts: PriceCartResult['gifts'] = [];
  let shippingDiscount = 0;
  const shipping = input.shippingVnd ?? vnd(0);
  const orderLevel: PromotionSnapshot[] = [];

  const record = (l: WorkLine, p: PromotionSnapshot, amount: number) => {
    if (amount <= 0) return;
    l.promo += amount;
    l.promoted = true;
    if (!p.rule.stackable) l.locked = true;
    if (!l.versionIds.includes(p.versionId)) l.versionIds.push(p.versionId);
    l.savings.push({ promotionId: p.promotionId, label: p.name, amountVnd: vnd(amount) });
  };

  // 2. Line-level promotions.
  for (const p of sorted) {
    const rule = p.rule;
    if (rule.type === 'free_shipping') {
      shippingDiscount = shipping;
      continue;
    }
    if (rule.type === 'gift') {
      gifts.push({ variantId: rule.giftVariantId, qty: rule.giftQty, promotionId: p.promotionId });
      continue;
    }
    if (isOrderLevel(rule)) {
      orderLevel.push(p);
      continue;
    }
    const targets = work.filter(
      (l) => lineInScope(l.input, rule) && !l.locked && (rule.stackable || !l.promoted) && remaining(l) > 0,
    );
    if (targets.length === 0) continue;

    switch (rule.type) {
      case 'percent':
        for (const l of targets) record(l, p, Math.min(remaining(l), applyBp(vnd(remaining(l)), rule.percentBp)));
        break;
      case 'buy_x_get_y': {
        const units = unitsCheapestFirst(targets);
        const groups = Math.floor(units.length / (rule.buyQty + rule.getQty));
        const free = units.slice(0, groups * rule.getQty);
        const perLine = new Map<WorkLine, number>();
        for (const u of free) perLine.set(u.line, (perLine.get(u.line) ?? 0) + applyBp(vnd(u.price), rule.getDiscountBp));
        for (const [l, amount] of perLine) record(l, p, Math.min(remaining(l), amount));
        break;
      }
      case 'bundle_price': {
        const units = unitsCheapestFirst(targets).reverse(); // bundle the dearest units first
        const bundles = Math.floor(units.length / rule.bundleQty);
        for (let b = 0; b < bundles; b++) {
          const group = units.slice(b * rule.bundleQty, (b + 1) * rule.bundleQty);
          const groupTotal = group.reduce((a, u) => a + u.price, 0);
          const saving = groupTotal - rule.bundlePriceVnd;
          if (saving <= 0) continue;
          const parts = allocate(vnd(saving), group.map((u) => u.price));
          const perLine = new Map<WorkLine, number>();
          group.forEach((u, i) => perLine.set(u.line, (perLine.get(u.line) ?? 0) + parts[i]!));
          for (const [l, amount] of perLine) record(l, p, Math.min(remaining(l), amount));
        }
        break;
      }
    }
  }

  // 3. Tier discount (goods only) and 4. category cap.
  for (const l of work) {
    if (input.customer && input.customer.tierDiscountBp > 0 && l.input.itemClass === 'goods') {
      l.tier = Math.min(remaining(l), applyBp(vnd(remaining(l)), input.customer.tierDiscountBp));
    }
    const caps = l.input.categoryIds
      .map((c) => input.settings.categoryMaxDiscountBp[c])
      .filter((v): v is Bp => v !== undefined);
    if (caps.length > 0) {
      const cap = applyBp(vnd(l.gross), Math.min(...caps));
      const auto = l.promo + l.tier;
      if (auto > cap) {
        const excess = auto - cap;
        const fromTier = Math.min(l.tier, excess);
        l.tier -= fromTier;
        l.promo -= excess - fromTier;
      }
    }
  }

  // 5. Manual line discount against the role limit (BR-05).
  for (const l of work) {
    const md = l.input.manualDiscount;
    if (!md) continue;
    const base = l.gross - l.promo - l.tier;
    const amount = md.kind === 'percent' ? applyBp(vnd(base), md.bp) : md.vnd;
    l.manual = Math.max(0, Math.min(base, amount));
    const effectiveBp = l.gross === 0 ? 0 : Math.ceil((l.manual * BP_100) / l.gross);
    if (!input.grants.discountUnlimited && effectiveBp > input.settings.cashierDiscountMaxBp) {
      approvals.push({
        code: 'discount_over_limit',
        lineId: l.input.lineId,
        discountBp: effectiveBp,
        limitBp: input.settings.cashierDiscountMaxBp,
      });
    }
  }

  // 6. Order-level promotions and every fixed amount, allocated across the lines in scope in
  // proportion to their remaining amount.
  for (const p of orderLevel) {
    const rule = p.rule;
    const targets = work.filter((l) => lineInScope(l.input, rule) && !l.locked && (rule.stackable || !l.promoted));
    const weights = targets.map((l) => l.gross - l.promo - l.tier - l.manual - l.order);
    const base = weights.reduce((a, b) => a + b, 0);
    if (base <= 0) continue;
    const discount =
      rule.type === 'percent' ? applyBp(vnd(base), rule.percentBp) : rule.type === 'fixed' ? Math.min(base, rule.amountVnd) : 0;
    if (discount <= 0) continue;
    const parts = allocate(vnd(discount), weights);
    targets.forEach((l, i) => {
      const amount = parts[i]!;
      if (amount <= 0) return;
      l.order += amount;
      l.promoted = true;
      if (!rule.stackable) l.locked = true;
      if (!l.versionIds.includes(p.versionId)) l.versionIds.push(p.versionId);
      l.savings.push({ promotionId: p.promotionId, label: p.name, amountVnd: vnd(amount) });
    });
  }

  // 7. Points redemption (FR-POS-05, BR-07): a discount on the point-earning lines, checked against
  // the minimum, the balance and the amount those lines still carry.
  const earningLines = work.filter((l) => EARNS_POINTS[l.input.itemClass]);
  const netOf = (l: WorkLine) => l.gross - l.promo - l.tier - l.manual - l.order - l.points;
  let redeemPoints = Math.max(0, Math.trunc(input.redeemPoints ?? 0));
  if (redeemPoints > 0) {
    const balance = input.customer?.pointsBalance ?? 0;
    const earningNet = earningLines.reduce((a, l) => a + netOf(l), 0);
    if (redeemPoints < input.settings.minRedeemPoints) {
      issues.push({ code: 'points_below_minimum', minimum: input.settings.minRedeemPoints });
      redeemPoints = 0;
    } else if (redeemPoints > balance) {
      issues.push({ code: 'points_exceed_balance', balance });
      redeemPoints = 0;
    } else if (redeemPoints * input.settings.pointValueVnd > earningNet) {
      issues.push({ code: 'points_exceed_total' });
      redeemPoints = 0;
    }
  }
  const redeemValue = redeemPoints * input.settings.pointValueVnd;
  if (redeemValue > 0) {
    const parts = allocate(vnd(redeemValue), earningLines.map(netOf));
    earningLines.forEach((l, i) => (l.points = parts[i]!));
  }

  const lines: PricedLine[] = work.map((l) => {
    const discount = l.promo + l.tier + l.manual + l.order + l.points;
    const total = vnd(l.gross - discount);
    return {
      lineId: l.input.lineId,
      variantId: l.input.variantId,
      qty: l.input.qty,
      unitPriceVnd: l.unit,
      grossVnd: vnd(l.gross),
      promoDiscountVnd: vnd(l.promo),
      tierDiscountVnd: vnd(l.tier),
      manualDiscountVnd: vnd(l.manual),
      orderDiscountVnd: vnd(l.order),
      pointsDiscountVnd: vnd(l.points),
      discountVnd: vnd(discount),
      totalVnd: total,
      vatBp: l.input.vatBp,
      vatVnd: vatIncluded(total, l.input.vatBp),
      promotionVersionIds: l.versionIds,
      savings: l.savings,
    };
  });

  const subtotal = lines.reduce((a, l) => a + l.grossVnd, 0);
  const discountTotal = lines.reduce((a, l) => a + l.discountVnd, 0);
  const total = subtotal - discountTotal + shipping - shippingDiscount;

  // Earned on the net spend of point-earning lines, i.e. after every discount including points (BR-07).
  const earningTotal = lines.reduce((a, l, i) => a + (EARNS_POINTS[work[i]!.input.itemClass] ? l.totalVnd : 0), 0);
  const multiplier = input.customer?.pointsMultiplierBp ?? BP_100;
  const pointsToEarn = input.customer
    ? Math.floor((earningTotal * multiplier) / (BP_100 * input.settings.earnVndPerPoint))
    : 0;

  const applied = new Set<string>();
  for (const l of lines) for (const v of l.promotionVersionIds) applied.add(v);
  for (const p of sorted) if (p.rule.type === 'free_shipping' || p.rule.type === 'gift') applied.add(p.versionId);

  return {
    lines,
    subtotalVnd: vnd(subtotal),
    discountVnd: vnd(discountTotal),
    totalVnd: vnd(total),
    vatVnd: vnd(lines.reduce((a, l) => a + l.vatVnd, 0)),
    shippingVnd: shipping,
    shippingDiscountVnd: vnd(shippingDiscount),
    gifts,
    appliedPromotionVersionIds: [...applied],
    couponApplied: coupon !== null && couponMatched && sorted.some((p) => p.rule.conditions.couponCode),
    redeemPoints,
    redeemValueVnd: vnd(redeemValue),
    pointsToEarn: Math.max(0, pointsToEarn),
    approvalsRequired: approvals,
    issues,
  };
}
