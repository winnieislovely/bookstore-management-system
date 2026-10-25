import * as audit from '@bookstore/modules/audit';
import * as identity from '@bookstore/modules/identity';
import * as settings from '@bookstore/modules/settings';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import type { AppEnv } from '../http/context.js';
import { defineRoute, IdParams } from '../http/route.js';

/** Users, roles, settings and audit log (TDD §6.2, FR-ADM-03..05). */
export function adminRoutes(app: OpenAPIHono<AppEnv>): void {
  defineRoute(app, { method: 'get', path: '/api/v1/admin/users', access: 'user.manage', summary: 'List users' }, async ({ ctx }) => ({
    items: await identity.listUsers(ctx),
  }));

  defineRoute(
    app,
    { method: 'post', path: '/api/v1/admin/users', access: 'user.manage', summary: 'Create a user', status: 201, body: identity.CreateUserSchema },
    async ({ ctx, body }) => identity.createUser(ctx, body),
  );

  defineRoute(
    app,
    {
      method: 'patch',
      path: '/api/v1/admin/users/:id',
      access: 'user.manage',
      summary: 'Update a user (role, name, status)',
      params: IdParams,
      body: identity.UpdateUserSchema,
    },
    async ({ ctx, params, body }) => identity.updateUser(ctx, params.id, body),
  );

  defineRoute(
    app,
    { method: 'post', path: '/api/v1/admin/users/:id/unlock', access: 'user.unlock', summary: 'Unlock a locked account', status: 204, params: IdParams },
    async ({ ctx, params }) => {
      await identity.unlockUser(ctx, params.id);
    },
  );

  defineRoute(app, { method: 'get', path: '/api/v1/admin/roles', access: 'role.manage', summary: 'Roles with their permission sets' }, async ({ ctx }) => ({
    items: await identity.listRoles(ctx),
  }));

  defineRoute(
    app,
    { method: 'post', path: '/api/v1/admin/roles', access: 'role.manage', summary: 'Create a role', status: 201, body: identity.RoleSchema },
    async ({ ctx, body }) => identity.createRole(ctx, body),
  );

  defineRoute(
    app,
    {
      method: 'patch',
      path: '/api/v1/admin/roles/:id',
      access: 'role.manage',
      summary: 'Rename a role and replace its permissions',
      status: 204,
      params: IdParams,
      body: identity.RoleSchema.extend({ version: z.number().int() }),
    },
    async ({ ctx, params, body }) => {
      await identity.updateRole(ctx, params.id, body);
    },
  );

  defineRoute(app, { method: 'get', path: '/api/v1/admin/settings', access: 'settings.manage', summary: 'Typed settings; secrets masked' }, async ({ ctx }) => ({
    items: await settings.list(ctx),
  }));

  defineRoute(
    app,
    {
      method: 'put',
      path: '/api/v1/admin/settings',
      access: 'settings.manage',
      summary: 'Save settings (validated per key; secrets write-only)',
      status: 204,
      body: z.record(z.string(), z.unknown()),
    },
    async ({ ctx, body }) => {
      await settings.update(ctx, body);
    },
  );

  defineRoute(
    app,
    {
      method: 'get',
      path: '/api/v1/admin/audit',
      access: 'audit.view',
      summary: 'Search the audit log',
      query: z.object({
        entity: z.string().optional(),
        entityId: z.string().optional(),
        actorId: z.uuid().optional(),
        action: z.string().optional(),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      }),
    },
    async ({ ctx, query }) =>
      audit.search(ctx, {
        ...query,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      }),
  );
}
