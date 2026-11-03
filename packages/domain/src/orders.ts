import type { SalesChannel } from './promotions.js';
import type { Transitions } from './state-machines.js';

/**
 * Online and social orders (FR-ORD-01..18, TDD §4.5). Pure rules shared by the server and the
 * staff app: sources, review flags (BR-30), which orders need action, pickup codes.
 */

/** FR-ORD-01: one inbox for every non-counter source. */
export const ORDER_SOURCES = ['website', 'facebook', 'zalo', 'instagram', 'tiktok', 'marketplace', 'phone', 'other'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

/** Channel profile kinds (FR-SOC-01) – the social and marketplace sources. */
export const CHANNEL_KINDS = ['facebook', 'zalo', 'instagram', 'tiktok', 'marketplace'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** Promotions are scoped by channel (FR-PRM-03): website orders use `website`, every other source `social`. */
export function pricingChannel(source: OrderSource): SalesChannel {
  return source === 'website' ? 'website' : 'social';
}

export const ORDER_PAYMENT_METHODS = ['cod', 'transfer'] as const;
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

export const DELIVERY_MODES = ['ship', 'pickup'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** FR-ORD-04 / BR-30 review reasons. */
export const REVIEW_REASONS = ['out_of_stock', 'incomplete_address', 'unpaid_transfer', 'high_value', 'suspected_abuse'] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

export interface ReviewInput {
  /** Every line could be reserved at creation. */
  allReserved: boolean;
  delivery: DeliveryMode;
  /** A delivery address with a known province and ward. */
  addressResolvable: boolean;
  paymentMethod: OrderPaymentMethod;
  paid: boolean;
  totalVnd: number;
  /** Earlier orders to the same phone that the carrier returned. */
  failedDeliveries: number;
  settings: { highValueVnd: number; failedDeliveries: number };
}

export function reviewReasons(i: ReviewInput): ReviewReason[] {
  const out: ReviewReason[] = [];
  if (!i.allReserved) out.push('out_of_stock');
  if (i.delivery === 'ship' && !i.addressResolvable) out.push('incomplete_address');
  if (i.paymentMethod === 'transfer' && !i.paid) out.push('unpaid_transfer');
  if (i.settings.highValueVnd > 0 && i.totalVnd >= i.settings.highValueVnd) out.push('high_value');
  if (i.settings.failedDeliveries > 0 && i.failedDeliveries >= i.settings.failedDeliveries) out.push('suspected_abuse');
  return out;
}

/** Any reason but an unpaid transfer needs a look; an unpaid transfer order stays New (SRS UC-08). */
export function initialOrderStatus(reasons: readonly ReviewReason[]): 'new' | 'pending_review' {
  return reasons.some((r) => r !== 'unpaid_transfer') ? 'pending_review' : 'new';
}

/** Orders that sort first in the inbox and count on the menu badge (FR-ORD-05, Design §12.9). */
export const ORDERS_NEEDING_ACTION = ['new', 'pending_review', 'return_requested'] as const;

/** Shipment states as the system tracks them (GHN statuses are mapped onto these). */
export const SHIPMENT_STATUSES = ['created', 'picking', 'in_transit', 'delivered', 'failed', 'returning', 'returned', 'cancelled'] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** FR-ORD-17 return request. */
export const RETURN_REQUEST: Transitions<'requested' | 'approved' | 'received' | 'rejected'> = {
  requested: ['approved', 'rejected'],
  approved: ['received'],
  received: [],
  rejected: [],
};

/** Six-digit pickup code from random bytes (FR-ORD-12); stored hashed. */
export function pickupCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 4) throw new RangeError('Need 4 random bytes');
  const n = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

/** SRS B.5 – pre-order. Ordered is set by hand; Arrived comes from stock allocation. */
export const PREORDER: Transitions<'reserved' | 'ordered' | 'arrived' | 'contacted' | 'collected' | 'cancelled'> = {
  reserved: ['ordered', 'arrived', 'cancelled'],
  ordered: ['arrived', 'cancelled'],
  arrived: ['contacted', 'collected', 'cancelled'],
  contacted: ['collected', 'cancelled'],
  collected: [],
  cancelled: [],
};

/** SRS B.5 / FR-ORD-15 – special order; Ordered and Arrived are set by hand. */
export const SPECIAL_ORDER: Transitions<'requested' | 'ordered' | 'arrived' | 'contacted' | 'collected' | 'cancelled'> = {
  requested: ['ordered', 'arrived', 'cancelled'],
  ordered: ['arrived', 'cancelled'],
  arrived: ['contacted', 'collected', 'cancelled'],
  contacted: ['collected', 'cancelled'],
  collected: [],
  cancelled: [],
};

/** How a deposit is taken at the counter (FR-ORD-14). */
export const DEPOSIT_METHODS = ['cash', 'transfer', 'card'] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];
