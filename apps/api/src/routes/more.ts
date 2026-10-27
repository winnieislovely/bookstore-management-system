import * as catalog from '@bookstore/modules/catalog';
import * as customers from '@bookstore/modules/customers';
import * as imports from '@bookstore/modules/imports';
import * as masterdata from '@bookstore/modules/masterdata';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../http/context.js';
import { defineRoute, IdParams } from '../http/route.js';

/** Labels, catalogue export, master data and customer merge/history/export (TDD §6.2). */
export function moreRoutes(app: OpenAPIHono<AppEnv>): void {
  defineRoute(app, { method: 'post', path: '/api/v1/catalog/labels', access: 'catalog.view', summary: 'Print-ready label sheet (HTML)', body: catalog.LabelSchema }, async ({ ctx, body, c }) =>
    c.html(await catalog.labels(ctx, body)),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/catalog/export', access: 'catalog.import', summary: 'Export items to Excel (import layout)' }, async ({ ctx, c }) =>
    c.body((await imports.exportCatalog(ctx)) as never, 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="san-pham.xlsx"',
      'Cache-Control': 'no-store',
    }),
  );

  const Kind = z.object({ kind: z.enum(masterdata.MASTER_KINDS) });
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/admin/master-data/:kind', access: 'session', summary: 'Master data list', params: Kind, query: z.object({ all: z.enum(['true', 'false']).default('false') }) },
    async ({ ctx, params, query }) => ({ items: await masterdata.list(ctx, params.kind, query.all === 'true') }),
  );
  defineRoute(
    app,
    {
      method: 'put',
      path: '/api/v1/admin/master-data/:kind/:code',
      access: 'settings.manage',
      summary: 'Add or edit a master data entry',
      params: Kind.extend({ code: z.string().min(1).max(40) }),
      body: masterdata.EntrySchema,
    },
    async ({ ctx, params, body }) => masterdata.upsert(ctx, params.kind, params.code, body),
  );

  defineRoute(
    app,
    { method: 'post', path: '/api/v1/customers/:id/merge', access: 'customer.manage', summary: 'Merge a duplicate profile into this one', params: IdParams, body: z.object({ sourceId: z.uuid() }) },
    async ({ ctx, params, body }) => customers.merge(ctx, params.id, body.sourceId),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/customers/:id/purchases', access: 'customer.view', summary: 'Purchases with totals', params: IdParams }, async ({ ctx, params }) =>
    customers.purchases(ctx, params.id),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/customers/:id/export', access: 'customer.erase', summary: 'Export personal data on request', params: IdParams }, async ({ ctx, params, c }) =>
    c.body(JSON.stringify(await customers.exportData(ctx, params.id), null, 2), 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="khach-hang-${params.id.slice(0, 8)}.json"`,
      'Cache-Control': 'no-store',
    }),
  );
}

/** Bundle components (TDD §6.2). */
export function purchasingExtraRoutes(app: OpenAPIHono<AppEnv>): void {
  defineRoute(
    app,
    { method: 'put', path: '/api/v1/catalog/variants/:id/components', access: 'catalog.edit', summary: 'Set bundle components', params: IdParams, body: catalog.ComponentsSchema },
    async ({ ctx, params, body }) => catalog.setComponents(ctx, params.id, body),
  );
}

export function rollbackRoutes(app: OpenAPIHono<AppEnv>): void {
  defineRoute(app, { method: 'post', path: '/api/v1/admin/import/jobs/:id/rollback', access: 'session', summary: 'Reverse a committed import while nothing depends on it', params: IdParams }, async ({ ctx, params }) =>
    imports.rollback(ctx, params.id),
  );
}
