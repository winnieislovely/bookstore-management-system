import * as reports from '@bookstore/modules/reports';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../http/context.js';
import { defineRoute } from '../http/route.js';

/** Reports, exports and menu badges (TDD §6.2, FR-RPT, FR-ADM-08). */
export function reportRoutes(app: OpenAPIHono<AppEnv>): void {
  defineRoute(app, { method: 'get', path: '/api/v1/reports/dashboard', access: 'report.view', summary: 'Dashboard figures' }, async ({ ctx }) => reports.dashboard(ctx));
  defineRoute(app, { method: 'get', path: '/api/v1/reports/sales', access: 'report.view', summary: 'Sales report', query: reports.SalesReportSchema }, async ({ ctx, query }) =>
    reports.sales(ctx, query),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/reports/inventory', access: 'report.view', summary: 'Inventory reports', query: reports.InventoryReportSchema }, async ({ ctx, query }) =>
    reports.inventory(ctx, query),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/reports/tax', access: 'report.view', summary: 'Tax and audit reports', query: reports.TaxReportSchema }, async ({ ctx, query }) =>
    reports.tax(ctx, query),
  );
  defineRoute(app, { method: 'get', path: '/api/v1/reports/purchasing', access: 'report.view', summary: 'Purchasing reports', query: reports.PurchasingReportSchema }, async ({ ctx, query }) =>
    reports.purchasingReport(ctx, query),
  );
  defineRoute(
    app,
    {
      method: 'post',
      path: '/api/v1/reports/:name/export',
      access: 'report.export',
      summary: 'Export a report: returns a 10-minute single-use download token',
      status: 201,
      params: z.object({ name: z.enum(Object.keys(reports.REPORTS) as [reports.ReportName, ...reports.ReportName[]]) }),
      body: reports.ExportSchema,
    },
    async ({ ctx, params, body }) => reports.createExport(ctx, params.name, body),
  );
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/reports/download/:token', access: 'session', summary: 'Download an exported report once', params: z.object({ token: z.string().min(20) }) },
    async ({ ctx, params, c }) => {
      const f = await reports.download(ctx, params.token);
      return c.body(f.bytes as never, 200, { 'Content-Type': f.mime, 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'no-store' });
    },
  );
  defineRoute(app, { method: 'get', path: '/api/v1/me/badges', access: 'session', summary: 'Menu count badges by permission' }, async ({ ctx }) => reports.badges(ctx));
}
