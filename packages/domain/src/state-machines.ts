/**
 * Allowed status transitions as data (TDD §4.5, SRS Appendix B). The database CHECK constraints are
 * generated from the same constants.
 */
export type Transitions<S extends string> = Readonly<Record<S, readonly S[]>>;

export function canTransition<S extends string>(machine: Transitions<S>, from: S, to: S): boolean {
  return machine[from].includes(to);
}

export function statesOf<S extends string>(machine: Transitions<S>): S[] {
  return Object.keys(machine) as S[];
}

/** SRS B.7 – e-invoice. */
export const EINVOICE: Transitions<'pending' | 'sent' | 'issued' | 'failed' | 'cancelled' | 'adjusted'> = {
  pending: ['sent', 'failed'],
  sent: ['issued', 'failed'],
  issued: ['cancelled', 'adjusted'],
  failed: ['pending', 'sent'],
  cancelled: [],
  adjusted: [],
};

/** FR-PUR-07 – optional supplier orders. */
export const SUPPLIER_ORDER: Transitions<'draft' | 'sent' | 'partially_received' | 'received' | 'closed' | 'cancelled'> = {
  draft: ['sent', 'cancelled'],
  sent: ['partially_received', 'received', 'closed', 'cancelled'],
  partially_received: ['partially_received', 'received', 'closed'],
  received: ['closed'],
  closed: [],
  cancelled: [],
};

/** SRS B.1 – online / social order (release R2a). A store-pickup order goes from packing to done at handover. */
export const WEB_ORDER: Transitions<
  | 'new'
  | 'pending_review'
  | 'confirmed'
  | 'packing'
  | 'shipping'
  | 'done'
  | 'return_requested'
  | 'return_approved'
  | 'returned'
  | 'cancelled'
> = {
  new: ['pending_review', 'confirmed', 'cancelled'],
  pending_review: ['confirmed', 'cancelled'],
  confirmed: ['packing', 'cancelled'],
  packing: ['shipping', 'done', 'cancelled'],
  shipping: ['done', 'return_requested'],
  done: ['return_requested'],
  return_requested: ['return_approved', 'done'],
  return_approved: ['returned'],
  returned: [],
  cancelled: [],
};

/** Stock count lifecycle (FR-INV-06). */
export const STOCK_COUNT: Transitions<'open' | 'submitted' | 'approved' | 'cancelled'> = {
  open: ['submitted', 'cancelled'],
  submitted: ['approved', 'open', 'cancelled'],
  approved: [],
  cancelled: [],
};

export const SALE_STATUSES = ['completed', 'voided'] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

export const ITEM_STATUSES = ['active', 'hidden', 'discontinued'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
