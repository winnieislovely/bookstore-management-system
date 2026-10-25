import * as customers from '@bookstore/modules/customers';
import * as identity from '@bookstore/modules/identity';
import * as masterdata from '@bookstore/modules/masterdata';
import * as sales from '@bookstore/modules/sales';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { deleteCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { SESSION_COOKIE, type AppEnv, type Deps } from '../http/context.js';
import { defineRoute } from '../http/route.js';

/** Auth, own profile and first-run wizard (TDD §6.2 “Auth and administration”). */
export function authRoutes(app: OpenAPIHono<AppEnv>, deps: Deps): void {
  const meView = (ctx: Parameters<Parameters<typeof defineRoute>[2]>[0]['ctx'], session: { locked: boolean; mustChangePassword: boolean } | null) => ({
    id: ctx.actor!.userId,
    username: ctx.actor!.username,
    displayName: ctx.actor!.displayName,
    roleId: ctx.actor!.roleId,
    isOwner: ctx.actor!.isOwner,
    permissions: [...ctx.actor!.permissions].sort(),
    locked: session?.locked ?? false,
    mustChangePassword: session?.mustChangePassword ?? false,
  });

  defineRoute(
    app,
    {
      method: 'post',
      path: '/api/v1/auth/login',
      access: 'public',
      summary: 'Sign in with lockout and rate limit',
      body: z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) }),
    },
    async ({ ctx, body, c }) => {
      const r = await identity.login(ctx, body.username, body.password, c.req.header('user-agent') ?? null);
      setCookie(c, SESSION_COOKIE, r.token, {
        httpOnly: true,
        secure: deps.config.COOKIE_SECURE,
        sameSite: 'Strict',
        path: '/',
        expires: r.expiresAt,
      });
      return meView({ ...ctx, actor: r.actor }, { locked: false, mustChangePassword: r.mustChangePassword });
    },
  );

  defineRoute(app, { method: 'post', path: '/api/v1/auth/logout', access: 'session', summary: 'Sign out', status: 204 }, async ({ ctx, c }) => {
    await identity.logout(ctx);
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: deps.config.COOKIE_SECURE });
  });

  defineRoute(app, { method: 'post', path: '/api/v1/auth/lock', access: 'session', summary: 'Lock the POS screen', status: 204 }, async ({ ctx }) => {
    await identity.lock(ctx);
  });

  defineRoute(
    app,
    { method: 'post', path: '/api/v1/auth/unlock', access: 'session', summary: 'Unlock with PIN', status: 204, body: z.object({ pin: z.string() }) },
    async ({ ctx, body }) => {
      await identity.unlock(ctx, body.pin);
    },
  );

  defineRoute(
    app,
    {
      method: 'post',
      path: '/api/v1/auth/approve',
      access: 'session',
      summary: 'Supervisor PIN/password for a named action; returns a 2-minute approval token',
      body: z
        .object({
          approverUsername: z.string().min(1),
          pin: z.string().optional(),
          password: z.string().optional(),
          action: z.enum(Object.keys(identity.APPROVAL_ACTIONS) as [identity.ApprovalAction, ...identity.ApprovalAction[]]),
          subject: z.string().max(200).optional(),
        })
        .refine((b) => !!b.pin !== !!b.password, 'Nhập mã PIN hoặc mật khẩu của người duyệt.'),
    },
    async ({ ctx, body }) => identity.approve(ctx, body),
  );

  defineRoute(app, { method: 'get', path: '/api/v1/me', access: 'session', summary: 'Own profile and permissions' }, async ({ ctx, c }) =>
    meView(ctx, c.get('session')),
  );

  defineRoute(
    app,
    {
      method: 'patch',
      path: '/api/v1/me/password',
      access: 'session',
      summary: 'Change own password',
      status: 204,
      body: z.object({ currentPassword: z.string(), newPassword: z.string() }),
    },
    async ({ ctx, body }) => {
      await identity.changePassword(ctx, body.currentPassword, body.newPassword);
    },
  );

  defineRoute(
    app,
    { method: 'put', path: '/api/v1/me/pin', access: 'session', summary: 'Set own quick PIN', status: 204, body: z.object({ pin: z.string() }) },
    async ({ ctx, body }) => {
      await identity.setPin(ctx, body.pin);
    },
  );

  defineRoute(app, { method: 'get', path: '/api/v1/setup', access: 'public', summary: 'Whether the first-run wizard is needed' }, async ({ ctx }) =>
    identity.setupStatus(ctx),
  );

  defineRoute(
    app,
    {
      method: 'post',
      path: '/api/v1/setup',
      access: 'public',
      summary: 'First-run wizard: owner account and store profile (refused once a user exists)',
      status: 201,
      body: identity.SetupSchema,
    },
    async ({ ctx, body }) =>
      identity.runSetup(ctx, body, async (tx, c) => {
        await customers.seedTiers(tx, c);
        await sales.seedRegister(tx);
        await masterdata.seed(tx);
      }),
  );
}
