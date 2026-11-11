import { createCarrier } from '@bookstore/modules/integrations/ghn';
import { createBookLookup } from '@bookstore/modules/integrations/openlibrary';
import { ping } from '@bookstore/modules/platform';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv, Deps } from './http/context.js';
import { csrf, errorHandler, limitBody, requestContext, securityHeaders, session } from './http/middleware.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { bookLookupRoutes } from './routes/bookLookup.js';
import { importRoutes } from './routes/imports.js';
import { libraryRoutes } from './routes/library.js';
import { moreRoutes, purchasingExtraRoutes, rollbackRoutes } from './routes/more.js';
import { offlineRoutes } from './routes/offline.js';
import { orderRoutes } from './routes/orders.js';
import { posRoutes } from './routes/pos.js';
import { reportRoutes } from './routes/reports.js';
import { stockRoutes } from './routes/stock.js';

/** The `api` process (TDD §3.2): staff API now; public API, webhooks and POS sync follow. */
export function createApp(deps: Deps): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  app.onError(errorHandler(deps));
  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'Không tìm thấy địa chỉ này.', requestId: c.get('requestId') ?? 'unknown' } }, 404),
  );

  app.use('*', requestContext(deps));
  app.use('*', securityHeaders);
  app.use('/api/*', csrf(deps));
  app.use('/api/*', limitBody);
  app.use('/api/*', session);
  // Device endpoints: staff session plus the device signature, which also stops cross-site requests (TDD §7.2).
  app.use('/pos/*', limitBody);
  app.use('/pos/*', session);
  app.use('/webhooks/*', limitBody);

  authRoutes(app, deps);
  adminRoutes(app);
  stockRoutes(app);
  posRoutes(app);
  importRoutes(app, deps);
  reportRoutes(app);
  offlineRoutes(app);
  moreRoutes(app);
  purchasingExtraRoutes(app);
  rollbackRoutes(app);
  libraryRoutes(app);
  bookLookupRoutes(app, deps.bookLookup ?? createBookLookup(deps.config), deps.storage);
  orderRoutes(app, deps.carrier ?? createCarrier(deps.config), deps.config.GHN_WEBHOOK_SECRET);

  app.openAPIRegistry.registerComponent('securitySchemes', 'session', { type: 'apiKey', in: 'cookie', name: '__Host-bms_sid' });
  app.doc31('/api/v1/openapi.json', { openapi: '3.1.0', info: { title: 'Bookstore Management System – staff API', version: '1.0.0' } });

  /** Health check: database reachable (TDD §11.5). */
  app.get('/healthz', async (c) => {
    await ping(deps.db);
    return c.json({ ok: true });
  });

  return app;
}
