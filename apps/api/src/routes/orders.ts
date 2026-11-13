import { mapGhnStatus, type CarrierAdapter } from '@bookstore/modules/integrations/ghn';
import * as orders from '@bookstore/modules/orders';
import { errors, safeEqual } from '@bookstore/modules/platform';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../http/context.js';
import { defineRoute, IdParams } from '../http/route.js';

/** Orders, delivery and social channels (TDD §6.2 “Orders, delivery and social”). */
export function orderRoutes(app: OpenAPIHono<AppEnv>, carrier: CarrierAdapter, webhookSecret: string | undefined): void {
  defineRoute(app, { method: 'get', path: '/api/v1/order-list', access: 'session', summary: 'Orders screen: every order (counter, online, pre-order); rows filtered by permission', query: orders.AllOrdersQuery }, async ({ ctx, query }) =>
    orders.listAllOrders(ctx, query),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/orders', access: 'online.manage', summary: 'Online orders; scope=delivery is the Delivery screen by stage', query: orders.OrdersQuery }, async ({ ctx, query }) =>
    orders.listOrders(ctx, query),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/orders', access: 'online.manage', summary: 'Create an order (social/phone) with source and reference (Idempotency-Key)', status: 201, body: orders.CreateOrderSchema },
    async ({ ctx, body, c }) => orders.createOrder(ctx, body, c.req.header('idempotency-key')),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/orders/quote', access: 'online.manage', summary: 'Price an order before saving', body: orders.QuoteSchema }, async ({ ctx, body }) => orders.quote(ctx, body));
  defineRoute(app, { method: 'post', path: '/api/v1/orders/bulk-confirm', access: 'session', summary: 'Confirm several orders', body: orders.BulkConfirmSchema }, async ({ ctx, body }) =>
    orders.bulkConfirm(ctx, body),
  );
  // Before /orders/:id, which would otherwise take the path.
  defineRoute(app, { method: 'get', path: '/api/v1/orders/last-address', access: 'online.manage', summary: "The customer's latest delivery address (FR-SOC-03)", query: orders.LastAddressQuery }, async ({ ctx, query }) =>
    orders.lastAddress(ctx, query),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/orders/:id', access: 'session', summary: 'Order record (marks it read)', params: IdParams }, async ({ ctx, params }) => orders.getOrder(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/orders/:id/confirm', access: 'session', summary: 'Confirm: reserve stock', params: IdParams }, async ({ ctx, params }) => orders.confirm(ctx, params.id));
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

  // --- Pre-orders at the POS (FR-POS-09, FR-ORD-14..16); collecting is POST /api/v1/pos/sales with preorderId ---
  defineRoute(app, { method: 'get', path: '/api/v1/preorders', access: 'sale.create', summary: 'Pre-orders', query: orders.HoldsQuery }, async ({ ctx, query }) => ({ items: await orders.listPreorders(ctx, query) }));
  defineRoute(app, { method: 'post', path: '/api/v1/preorders', access: 'sale.create', summary: 'Take a pre-order with a deposit', status: 201, body: orders.CreatePreorderSchema }, async ({ ctx, body }) => orders.createPreorder(ctx, body));
  defineRoute(app, { method: 'post', path: '/api/v1/preorders/:id/contacted', access: 'sale.create', summary: 'Customer called: holding period starts', params: IdParams }, async ({ ctx, params }) =>
    orders.markPreorderContacted(ctx, params.id),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/preorders/:id/ordered', access: 'sale.create', summary: 'Mark ordered from the supplier', params: IdParams }, async ({ ctx, params }) => orders.markOrdered(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/preorders/:id/cancel', access: 'sale.create', summary: 'Cancel; refund or keep the deposit', params: IdParams, body: orders.CancelHoldSchema }, async ({ ctx, params, body }) =>
    orders.cancelPreorder(ctx, params.id, body),
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
