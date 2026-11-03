import { mapGhnStatus, type CarrierAdapter } from '@bookstore/modules/integrations/ghn';
import * as orders from '@bookstore/modules/orders';
import { errors, safeEqual } from '@bookstore/modules/platform';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../http/context.js';
import { defineRoute, IdParams } from '../http/route.js';

/** Orders, delivery and social channels (TDD §6.2 “Orders, delivery and social”). */
export function orderRoutes(app: OpenAPIHono<AppEnv>, carrier: CarrierAdapter, webhookSecret: string | undefined): void {
  defineRoute(app, { method: 'get', path: '/api/v1/orders', access: 'online.manage', summary: 'Order inbox with counts per status', query: orders.OrdersQuery }, async ({ ctx, query }) =>
    orders.listOrders(ctx, query),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/orders', access: 'online.manage', summary: 'Create an order (social/phone) with source and reference (Idempotency-Key)', status: 201, body: orders.CreateOrderSchema },
    async ({ ctx, body, c }) => orders.createOrder(ctx, body, c.req.header('idempotency-key')),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/orders/quote', access: 'online.manage', summary: 'Price an order before saving', body: orders.QuoteSchema }, async ({ ctx, body }) => orders.quote(ctx, body));
  defineRoute(app, { method: 'post', path: '/api/v1/orders/bulk-confirm', access: 'online.manage', summary: 'Confirm several orders', body: orders.BulkConfirmSchema }, async ({ ctx, body }) =>
    orders.bulkConfirm(ctx, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/orders/:id', access: 'online.manage', summary: 'Order record (marks it read)', params: IdParams }, async ({ ctx, params }) => orders.getOrder(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/orders/:id/confirm', access: 'online.manage', summary: 'Confirm: reserve stock', params: IdParams }, async ({ ctx, params }) => orders.confirm(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/orders/:id/pack', access: 'online.manage', summary: 'Start packing', params: IdParams }, async ({ ctx, params }) => orders.pack(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/orders/:id/cancel', access: 'online.manage', summary: 'Cancel with reason; releases stock', params: IdParams, body: orders.CancelSchema }, async ({ ctx, params, body }) =>
    orders.cancel(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/orders/:id/confirm-payment', access: 'online.confirm_payment', summary: 'Confirm a bank transfer', params: IdParams, body: orders.ConfirmPaymentSchema },
    async ({ ctx, params, body }) => orders.confirmPayment(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/orders/shipping-quote', access: 'online.manage', summary: 'GHN fee for a ward and the items', body: orders.ShippingQuoteSchema },
    async ({ ctx, body }) => orders.shippingQuote(ctx, carrier, body),
  );
  defineRoute(
    app,
    {
      method: 'post',
      path: '/api/v1/orders/:id/shipment',
      access: 'online.manage',
      summary: 'Create a GHN shipment or record a manual one (tracking number)',
      status: 201,
      params: IdParams,
      body: z.discriminatedUnion('carrier', [z.object({ carrier: z.literal('ghn') }), orders.ShipmentSchema]),
    },
    async ({ ctx, params, body }) => (body.carrier === 'ghn' ? orders.createGhnShipment(ctx, carrier, params.id) : orders.recordShipment(ctx, params.id, body)),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/orders/:id/delivered', access: 'online.manage', summary: 'Mark a manual shipment delivered', params: IdParams }, async ({ ctx, params }) =>
    orders.markDelivered(ctx, params.id),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/orders/:id/pickup-ready', access: 'online.manage', summary: 'Ready for store pickup: code and to-notify task', params: IdParams }, async ({ ctx, params }) =>
    orders.pickupReady(ctx, params.id),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/orders/:id/handover', access: 'online.manage', summary: 'Hand over a pickup order (code check)', params: IdParams, body: orders.HandoverSchema }, async ({ ctx, params, body }) =>
    orders.handover(ctx, params.id, body),
  );

  // --- Returns (FR-ORD-17) -------------------------------------------------------------------
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/orders/:id/return-request', access: 'online.manage', summary: 'Request a return', status: 201, params: IdParams, body: orders.ReturnRequestSchema },
    async ({ ctx, params, body }) => orders.requestReturn(ctx, params.id, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/orders/:id/return-approve', access: 'online.manage', summary: 'Approve the return', params: IdParams }, async ({ ctx, params }) => orders.approveReturn(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/orders/:id/return-reject', access: 'online.manage', summary: 'Refuse the return', params: IdParams, body: orders.RejectReturnSchema }, async ({ ctx, params, body }) =>
    orders.rejectReturn(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/orders/:id/return-receive', access: 'online.manage', summary: 'Receive and inspect; record the refund', params: IdParams, body: orders.ReceiveReturnSchema },
    async ({ ctx, params, body }) => orders.receiveReturn(ctx, params.id, body),
  );

  // --- GHN status webhook (TDD §4.5): shared secret in the registered URL, idempotent -------
  defineRoute(
    app,
    { method: 'post', path: '/webhooks/ghn', access: 'public', summary: 'GHN status webhook', query: z.object({ token: z.string().optional() }) },
    async ({ ctx, query, c }) => {
      if (!webhookSecret || !query.token || !safeEqual(query.token, webhookSecret)) throw errors.notFound('Địa chỉ');
      return orders.ghnWebhook(ctx, await c.req.json(), mapGhnStatus);
    },
  );

  // --- Pre-orders and special orders (FR-ORD-14..16) and the to-notify worklist (FR-ORD-18) ---
  for (const [kind, base] of [
    ['preorder', '/api/v1/preorders'],
    ['special_order', '/api/v1/special-orders'],
  ] as const) {
    defineRoute(app, { method: 'post', path: `${base}/:id/ordered`, access: 'online.manage', summary: 'Mark ordered from the supplier', params: IdParams }, async ({ ctx, params }) => orders.markOrdered(ctx, kind, params.id));
    defineRoute(app, { method: 'post', path: `${base}/:id/cancel`, access: 'online.manage', summary: 'Cancel; refund or keep the deposit', params: IdParams, body: orders.CancelHoldSchema }, async ({ ctx, params, body }) =>
      orders.cancelHold(ctx, kind, params.id, body),
    );
    defineRoute(app, { method: 'post', path: `${base}/:id/collect`, access: 'online.manage', summary: 'Collect: create the online order less the deposit', status: 201, params: IdParams, body: orders.CollectSchema }, async ({ ctx, params, body }) =>
      orders.collect(ctx, kind, params.id, body),
    );
  }
  defineRoute(app, { method: 'get', path: '/api/v1/preorders', access: 'online.manage', summary: 'Pre-orders', query: orders.HoldsQuery }, async ({ ctx, query }) => ({ items: await orders.listPreorders(ctx, query) }));
  defineRoute(app, { method: 'post', path: '/api/v1/preorders', access: 'online.manage', summary: 'Take a pre-order with a deposit', status: 201, body: orders.CreatePreorderSchema }, async ({ ctx, body }) => orders.createPreorder(ctx, body));
  defineRoute(app, { method: 'get', path: '/api/v1/special-orders', access: 'online.manage', summary: 'Special orders', query: orders.HoldsQuery }, async ({ ctx, query }) => ({ items: await orders.listSpecialOrders(ctx, query) }));
  defineRoute(app, { method: 'post', path: '/api/v1/special-orders', access: 'online.manage', summary: 'Record a special order with a deposit', status: 201, body: orders.CreateSpecialOrderSchema }, async ({ ctx, body }) =>
    orders.createSpecialOrder(ctx, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/special-orders/:id/arrived', access: 'online.manage', summary: 'Arrived: link the product and hold the copies', params: IdParams, body: orders.ArrivedSchema }, async ({ ctx, params, body }) =>
    orders.specialOrderArrived(ctx, params.id, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/contact-tasks', access: 'contact_task.manage', summary: 'To-notify worklist', query: orders.TasksQuery }, async ({ ctx, query }) => ({ items: await orders.listTasks(ctx, query) }));
  defineRoute(app, { method: 'post', path: '/api/v1/contact-tasks/:id/contacted', access: 'contact_task.manage', summary: 'Mark contacted', params: IdParams, body: orders.ContactNoteSchema }, async ({ ctx, params, body }) =>
    orders.markContacted(ctx, params.id, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/contact-tasks/:id/unreachable', access: 'contact_task.manage', summary: 'Could not reach the customer (note)', params: IdParams, body: orders.UnreachableSchema }, async ({ ctx, params, body }) =>
    orders.markUnreachable(ctx, params.id, body),
  );

  // --- COD reconciliation (FR-ORD-11) and the product share card (FR-SOC-04) -----------------
  defineRoute(app, { method: 'get', path: '/api/v1/cod/remittances', access: 'online.manage', summary: 'COD remittances', query: orders.RemittanceQuery }, async ({ ctx, query }) => ({
    items: await orders.listRemittances(ctx, query),
  }));
  defineRoute(app, { method: 'post', path: '/api/v1/cod/remittances/:id/reconcile', access: 'online.manage', summary: 'Record the carrier statement', params: IdParams, body: orders.ReconcileSchema }, async ({ ctx, params, body }) =>
    orders.reconcileRemittance(ctx, params.id, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/share-links', access: 'online.manage', summary: 'Product share card: link and text', body: orders.ShareCardSchema }, async ({ ctx, body }) => orders.shareCard(ctx, body));

  // --- Channel profiles (FR-SOC-01) and address data (FR-ORD-06) ------------------------------
  defineRoute(app, { method: 'get', path: '/api/v1/channels', access: 'online.manage', summary: 'Channel profiles', query: z.object({ active: z.enum(['true', 'false']).optional() }) }, async ({ ctx, query }) => ({
    items: await orders.listChannels(ctx, { activeOnly: query.active === 'true' }),
  }));
  defineRoute(app, { method: 'post', path: '/api/v1/channels', access: 'online.manage', summary: 'Add a channel profile', status: 201, body: orders.ChannelSchema }, async ({ ctx, body }) => orders.createChannel(ctx, body));
  defineRoute(app, { method: 'patch', path: '/api/v1/channels/:id', access: 'online.manage', summary: 'Edit a channel profile', params: IdParams, body: orders.ChannelSchema.partial() }, async ({ ctx, params, body }) =>
    orders.updateChannel(ctx, params.id, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/geo/provinces', access: 'session', summary: 'Provinces (carrier address data)' }, async ({ ctx }) => ({ items: await orders.listProvinces(ctx) }));
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/geo/provinces/:id/wards', access: 'session', summary: 'Wards of a province', params: z.object({ id: z.coerce.number().int() }) },
    async ({ ctx, params }) => ({ items: await orders.listWards(ctx, params.id) }),
  );
}
