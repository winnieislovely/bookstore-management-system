import type { Permission } from '@bookstore/domain';
import { requirePermission, errors, type Ctx } from '@bookstore/modules/platform';
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from './context.js';

/**
 * Route definition helper (TDD §6.1). Every route declares its access — a permission key,
 * `session` (any signed-in staff) or `public` — and a test enumerates the registry and fails if one
 * is missing. Request schemas are Zod; the same definitions feed the OpenAPI description.
 */
export type Access = Permission | 'session' | 'public';

export interface RouteDef<B extends z.ZodType, Q extends z.ZodType, P extends z.ZodType> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Hono path syntax (`/api/v1/admin/users/:id`). */
  path: string;
  access: Access;
  summary: string;
  tags?: string[];
  body?: B;
  query?: Q;
  params?: P;
  /** HTTP status on success (default 200). */
  status?: 200 | 201 | 204;
}

export interface Handled<B, Q, P> {
  ctx: Ctx;
  body: B;
  query: Q;
  params: P;
  c: Context<AppEnv>;
}

type Registered = { method: string; path: string; access: Access };
const registries = new WeakMap<object, Registered[]>();

/** Routes defined on an app, with their declared access (used by the completeness test). */
export function routesOf(app: object): Registered[] {
  return registries.get(app) ?? [];
}

const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

export function defineRoute<
  B extends z.ZodType = z.ZodUndefined,
  Q extends z.ZodType = z.ZodUndefined,
  P extends z.ZodType = z.ZodUndefined,
>(
  app: OpenAPIHono<AppEnv>,
  def: RouteDef<B, Q, P>,
  handler: (h: Handled<z.infer<B>, z.infer<Q>, z.infer<P>>) => Promise<unknown>,
): void {
  const list = registries.get(app) ?? [];
  list.push({ method: def.method.toUpperCase(), path: def.path, access: def.access });
  registries.set(app, list);

  app.openAPIRegistry.registerPath({
    method: def.method,
    path: toOpenApiPath(def.path),
    summary: def.summary,
    tags: def.tags ?? [def.path.split('/')[3] ?? 'api'],
    request: {
      ...(def.body && { body: { content: { 'application/json': { schema: def.body } } } }),
      ...(def.query && { query: def.query as never }),
      ...(def.params && { params: def.params as never }),
    },
    responses: {
      [def.status ?? 200]: { description: 'OK' },
      400: { description: 'Validation failed' },
      401: { description: 'Not signed in' },
      403: { description: 'Forbidden' },
      409: { description: 'Business rule conflict' },
    },
    ...(def.access !== 'public' && { security: [{ session: [] }] }),
  });

  app.on(def.method.toUpperCase(), def.path, async (c) => {
    const ctx = c.get('ctx');
    if (def.access === 'session') {
      if (!ctx.actor) throw errors.unauthenticated();
    } else if (def.access !== 'public') {
      requirePermission(ctx, def.access);
    }
    const body = def.body ? def.body.parse(await c.req.json().catch(() => undefined)) : undefined;
    const query = def.query ? def.query.parse(c.req.query()) : undefined;
    const params = def.params ? def.params.parse(c.req.param()) : undefined;
    const result = await handler({ ctx, body, query, params, c } as Handled<z.infer<B>, z.infer<Q>, z.infer<P>>);
    if (result instanceof Response) return result;
    if (def.status === 204 || result === undefined) return c.body(null, 204);
    return c.json(result as object, def.status ?? 200);
  });
}

export const IdParams = z.object({ id: z.uuid() });
