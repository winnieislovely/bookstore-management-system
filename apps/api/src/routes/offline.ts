import * as offline from '@bookstore/modules/sales/sync';
import { AppError } from '@bookstore/modules/platform';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../http/context.js';
import { defineRoute, IdParams } from '../http/route.js';

/** Offline POS: device endpoints `/pos/v1/*` and manager review (TDD §6.2, §7). */

async function device(c: Context<AppEnv>, body: Uint8Array) {
  const url = new URL(c.req.url);
  return offline.authenticateDevice(c.get('ctx'), {
    code: c.req.header('x-device-code'),
    timestamp: c.req.header('x-device-timestamp'),
    signature: c.req.header('x-device-signature'),
    method: c.req.method,
    path: url.pathname + url.search,
    body,
  });
}

export function offlineRoutes(app: OpenAPIHono<AppEnv>): void {
  defineRoute(app, { method: 'get', path: '/pos/v1/bootstrap', access: 'sale.create', summary: 'Full catalogue and settings snapshot for a device' }, async ({ ctx, c }) =>
    offline.bootstrap(ctx, await device(c, new Uint8Array())),
  );
  defineRoute(
    app,
    { method: 'get', path: '/pos/v1/delta', access: 'sale.create', summary: 'Catalogue changes after a cursor', query: z.object({ cursor: z.coerce.number().int().min(0) }) },
    async ({ ctx, query, c }) => {
      await device(c, new Uint8Array());
      return offline.delta(ctx, query.cursor);
    },
  );
  defineRoute(app, { method: 'post', path: '/pos/v1/sync', access: 'sale.create', summary: 'Upload offline events in order; per-event results and catalogue delta' }, async ({ ctx, c }) => {
    const raw = new Uint8Array(await c.req.arrayBuffer());
    const d = await device(c, raw);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      throw new AppError(400, 'invalid_json', 'Dữ liệu đồng bộ không hợp lệ.');
    }
    return offline.sync(ctx, d, body as z.input<typeof offline.SyncSchema>);
  });

  defineRoute(app, { method: 'get', path: '/api/v1/pos/devices', access: 'pos.offline.manage', summary: 'Registered POS devices' }, async ({ ctx }) => ({
    items: await offline.listDevices(ctx),
  }));
  defineRoute(app, { method: 'post', path: '/api/v1/pos/devices', access: 'pos.offline.manage', summary: 'Register a POS device', status: 201, body: offline.RegisterDeviceSchema }, async ({ ctx, body }) =>
    offline.registerDevice(ctx, body),
  );
  defineRoute(app, { method: 'post', path: '/api/v1/pos/devices/:id/revoke', access: 'pos.offline.manage', summary: 'Revoke a device', status: 204, params: IdParams }, async ({ ctx, params }) => {
    await offline.revokeDevice(ctx, params.id);
  });
  defineRoute(
    app,
    { method: 'get', path: '/api/v1/pos/sync/exceptions', access: 'pos.offline.manage', summary: 'Offline sync exceptions to review', query: z.object({ all: z.enum(['true', 'false']).default('false') }) },
    async ({ ctx, query }) => ({ items: await offline.listExceptions(ctx, query.all === 'true') }),
  );
  defineRoute(
    app,
    { method: 'post', path: '/api/v1/pos/sync/exceptions/:id/resolve', access: 'pos.offline.manage', summary: 'Resolve an exception (confirms unverified transfers)', params: IdParams, body: offline.ResolveSchema },
    async ({ ctx, params, body }) => offline.resolveException(ctx, params.id, body),
  );
}
