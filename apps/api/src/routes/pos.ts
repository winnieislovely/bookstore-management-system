import * as customers from '@bookstore/modules/customers';
import * as notifications from '@bookstore/modules/notifications';
import * as promotions from '@bookstore/modules/promotions';
import * as sales from '@bookstore/modules/sales';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../http/context.js';
import { defineRoute, IdParams } from '../http/route.js';

/** POS, customers, promotions and notifications (TDD §6.2). */
export function posRoutes(app: OpenAPIHono<AppEnv>): void {
  // --- Registers and shifts -------------------------------------------------------------------
  defineRoute(app, { method: 'get', path: '/api/v1/pos/registers', access: 'sale.create', summary: 'Registers' }, async ({ ctx }) => ({ items: await sales.listRegisters(ctx) }));
  defineRoute(app, { method: 'post', path: '/api/v1/pos/registers', access: 'settings.manage', summary: 'Add a register', status: 201, body: sales.RegisterSchema }, async ({ ctx, body }) =>
    sales.createRegister(ctx, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/pos/shifts/open', access: 'shift.open', summary: 'Open a shift with the opening float', status: 201, body: sales.OpenShiftSchema }, async ({ ctx, body }) =>
    sales.openShift(ctx, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/pos/shifts/close', access: 'shift.close', summary: 'Close a shift: count, variance, reason', body: sales.CloseShiftSchema }, async ({ ctx, body }) =>
    sales.closeShift(ctx, body),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/pos/shifts/current', access: 'session', summary: 'Open shift of a register', query: z.object({ register: z.uuid() }) },
    async ({ ctx, query }) => ({ shift: await sales.currentShift(ctx, query.register) }),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/pos/shifts', access: 'shift.view_all', summary: 'Shift history', query: z.object({ from: z.iso.datetime().optional(), to: z.iso.datetime().optional(), limit: z.coerce.number().int().optional() }) },
    async ({ ctx, query }) => ({
      items: await sales.listShifts(ctx, { from: query.from ? new Date(query.from) : undefined, to: query.to ? new Date(query.to) : undefined, limit: query.limit }),
    }),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/pos/shifts/:id', access: 'session', summary: 'Shift report', params: IdParams }, async ({ ctx, params }) => sales.shiftReport(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/pos/cash-movements', access: 'shift.cash_movement', summary: 'Cash in/out', status: 201, body: sales.CashMovementSchema }, async ({ ctx, body }) =>
    sales.cashMovement(ctx, body),
  );

  // --- Selling --------------------------------------------------------------------------------
  defineRoute(app, { method: 'post', path: '/api/v1/pos/price', access: 'sale.create', summary: 'Server-side price calculation', body: sales.CartSchema }, async ({ ctx, body }) => sales.price(ctx, body));
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/pos/sales', access: 'sale.create', summary: 'Complete a sale (Idempotency-Key)', status: 201, body: sales.CompleteSaleSchema },
    async ({ ctx, body, c }) => sales.completeSale(ctx, body, c.req.header('idempotency-key')),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/pos/sales', access: 'sale.create', summary: 'Sales list', query: sales.SalesQuery }, async ({ ctx, query }) => sales.listSales(ctx, query));
  defineRoute(app, { method: 'get', path: '/api/v1/pos/sales/:id', access: 'sale.create', summary: 'Sale record', params: IdParams }, async ({ ctx, params }) => sales.getSale(ctx, params.id));
  defineRoute(app, { method: 'post', path: '/api/v1/pos/sales/:id/void', access: 'sale.create', summary: 'Void with reason (approval)', params: IdParams, body: sales.VoidSchema }, async ({ ctx, params, body }) =>
    sales.voidSale(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/pos/sales/:id/returns', access: 'return.create', summary: 'Return or exchange', status: 201, params: IdParams, body: sales.ReturnSchema },
    async ({ ctx, params, body }) => sales.returnSale(ctx, params.id, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/pos/sales/:id/print', access: 'sale.reprint', summary: 'Sales slip data', params: IdParams }, async ({ ctx, params }) => sales.slip(ctx, params.id));
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/pos/sales/:id/einvoice-request', access: 'sale.create', summary: 'Customer asks for the e-invoice', params: IdParams, body: sales.BuyerSchema },
    async ({ ctx, params, body }) => sales.requestEinvoice(ctx, params.id, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/pos/sales/:id/einvoice/retry', access: 'einvoice.manage', summary: 'Retry a failed invoice', params: IdParams }, async ({ ctx, params }) =>
    sales.retryEinvoice(ctx, params.id),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/pos/einvoices', access: 'einvoice.manage', summary: 'E-invoice list', query: z.object({ status: z.string().optional() }) },
    async ({ ctx, query }) => ({ items: await sales.listEinvoices(ctx, query.status) }),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/pos/held-carts', access: 'sale.hold', summary: 'Hold a cart', status: 201, body: sales.HoldSchema }, async ({ ctx, body }) => sales.holdCart(ctx, body));
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/pos/held-carts', access: 'sale.hold', summary: 'Held carts of a register', query: z.object({ register: z.uuid() }) },
    async ({ ctx, query }) => ({ items: await sales.listHeld(ctx, query.register) }),
  );
  defineRoute(app, { method: 'delete', path: '/api/v1/pos/held-carts/:id', access: 'sale.hold', summary: 'Recall a held cart', params: IdParams }, async ({ ctx, params }) =>
    sales.recallHeld(ctx, params.id),
  );

  // --- Customers ------------------------------------------------------------------------------
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/customers', access: 'customer.view', summary: 'Search customers', query: z.object({ q: z.string().optional(), phone: z.string().optional() }) },
    async ({ ctx, query }) => {
      if (query.phone) {
        const c = await customers.findByPhone(ctx, query.phone);
        return { items: c ? [c] : [] };
      }
      return { items: await customers.search(ctx, query.q ?? '') };
    },
  );
  defineRoute(app, { method: 'post', path: '/api/v1/customers', access: 'customer.manage', summary: 'Create a customer', status: 201, body: customers.CustomerSchema }, async ({ ctx, body }) =>
    customers.createCustomer(ctx, body),
  );
  defineRoute(app, { method: 'patch', path: '/api/v1/customers/:id', access: 'customer.manage', summary: 'Edit a customer', params: IdParams, body: customers.CustomerUpdateSchema }, async ({ ctx, params, body }) =>
    customers.updateCustomer(ctx, params.id, body),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/customers/:id', access: 'customer.view', summary: 'Customer profile', params: IdParams }, async ({ ctx, params }) =>
    customers.getCustomer(ctx, params.id),
  );

  defineRoute(
    app,
    {
      method: 'post',
      path: '/api/v1/customers/:id/store-credit-adjust',
      access: 'customer.adjust_points',
      summary: 'Manual store-credit adjustment with reason',
      params: IdParams,
      body: customers.CreditAdjustSchema,
    },
    async ({ ctx, params, body }) => customers.adjustCredit(ctx, params.id, body),
  );

  defineRoute(
    app,
    { method: 'post', path: '/api/v1/customers/:id/points-adjust', access: 'customer.adjust_points', summary: 'Manual points with reason', params: IdParams, body: customers.PointsAdjustSchema },
    async ({ ctx, params, body }) => customers.adjustPoints(ctx, params.id, body),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/customers/:id/erase', access: 'customer.erase', summary: 'Anonymise on request', params: IdParams, body: customers.EraseSchema },
    async ({ ctx, params, body }) => customers.erase(ctx, params.id, body),
  );

  // --- Promotions -----------------------------------------------------------------------------
  defineRoute(app, { method: 'get', path: '/api/v1/promotions', access: 'promotion.manage', summary: 'Promotions with state' }, async ({ ctx }) => ({ items: await promotions.list(ctx) }));
  defineRoute(app, { method: 'post', path: '/api/v1/promotions', access: 'promotion.manage', summary: 'Create a promotion', status: 201, body: promotions.PromotionSchema }, async ({ ctx, body }) =>
    promotions.create(ctx, body),
  );
  defineRoute(app, { method: 'patch', path: '/api/v1/promotions/:id', access: 'promotion.manage', summary: 'Edit a promotion (new version)', params: IdParams, body: promotions.PromotionUpdateSchema }, async ({ ctx, params, body }) =>
    promotions.update(ctx, params.id, body),
  );
  for (const action of ['pause', 'resume'] as const) {
    defineRoute(app, { method: 'post', path: `/api/v1/promotions/:id/${action}`, access: 'promotion.manage', summary: `${action} a promotion`, status: 204, params: IdParams }, async ({ ctx, params }) => {
      await promotions.setPaused(ctx, params.id, action === 'pause');
    });
  }

  // --- Notifications --------------------------------------------------------------------------
  defineRoute(app, { method: 'get', path: '/api/v1/notifications', access: 'session', summary: 'In-app notification centre' }, async ({ ctx }) => notifications.list(ctx));
  defineRoute(app, { method: 'post', path: '/api/v1/notifications/:id/read', access: 'session', summary: 'Mark read', status: 204, params: IdParams }, async ({ ctx, params }) => {
    await notifications.markRead(ctx, [params.id]);
  });
  defineRoute(app, { method: 'post', path: '/api/v1/notifications/read-all', access: 'session', summary: 'Mark all read', status: 204 }, async ({ ctx }) => {
    await notifications.markRead(ctx, 'all');
  });
}
