import * as identity from '@bookstore/modules/identity';
import { AppError } from '@bookstore/modules/platform';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { CSRF_HEADER, SESSION_COOKIE, type AppEnv, type Deps } from './context.js';

/**
 * Middleware chain (TDD §3.5): request id → structured logging → security headers →
 * Origin/CSRF check → body size limit → session lookup (permissions re-read every request).
 */

export function requestContext(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    c.set('requestId', requestId);
    c.set('session', null);
    c.set('ctx', { db: deps.db, clock: deps.clock, crypto: deps.crypto, actor: null, requestId, ip });
    c.header('x-request-id', requestId);
    const started = performance.now();
    await next();
    deps.log.info(
      {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
        userId: c.get('ctx').actor?.userId,
      },
      'request',
    );
  };
}

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Origin check and custom-header requirement on state-changing staff requests (TDD §10.1). */
export function csrf(deps: Deps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin && origin !== deps.config.APP_ORIGIN) {
        throw new AppError(403, 'bad_origin', 'Yêu cầu bị từ chối vì không đến từ ứng dụng của cửa hàng.');
      }
      if (c.req.header(CSRF_HEADER) !== '1') {
        throw new AppError(403, 'csrf_header_missing', 'Yêu cầu thiếu thông tin bảo mật. Hãy tải lại trang rồi thử lại.');
      }
    }
    await next();
  };
}

const smallBody = bodyLimit({
  maxSize: 1024 * 1024,
  onError: () => {
    throw new AppError(400, 'body_too_large', 'Dữ liệu gửi lên quá lớn.');
  },
});
const uploadBody = bodyLimit({
  maxSize: 10 * 1024 * 1024,
  onError: () => {
    throw new AppError(400, 'file_too_large', 'Tệp phải nhỏ hơn 10 MB.');
  },
});

/** 1 MB for JSON; 10 MB for file uploads and import previews (TDD §4.12). */
export const limitBody: MiddlewareHandler<AppEnv> = (c, next) =>
  c.req.path === '/api/v1/files' || c.req.path === '/pos/v1/sync' || /^\/api\/v1\/admin\/import\/[a-z_]+\/preview$/.test(c.req.path) ? uploadBody(c, next) : smallBody(c, next);

/**
 * Paths a locked or must-change-password session may still call. The app shell reads the setup
 * status before anything else, so it must answer too, or the app cannot reach the PIN or password screen.
 */
const LOCKED_ALLOWED = new Set(['/api/v1/auth/unlock', '/api/v1/auth/logout', '/api/v1/me', '/api/v1/setup']);
const PASSWORD_CHANGE_ALLOWED = new Set(['/api/v1/me/password', '/api/v1/auth/logout', '/api/v1/me', '/api/v1/setup']);

export const session: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const ctx = c.get('ctx');
    const info = await identity.resolveSession(ctx, token);
    if (info) {
      c.set('ctx', { ...ctx, actor: info.actor });
      c.set('session', { locked: info.locked, mustChangePassword: info.mustChangePassword });
      if (info.locked && !LOCKED_ALLOWED.has(c.req.path)) {
        throw new AppError(423, 'session_locked', 'Màn hình đang khóa. Nhập mã PIN để tiếp tục.');
      }
      if (info.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(c.req.path)) {
        throw new AppError(403, 'password_change_required', 'Bạn cần đổi mật khẩu trước khi tiếp tục.');
      }
    }
  }
  await next();
};

/** Typed error envelope `{ error: { code, message, details?, requestId } }` (TDD §3.5, §6.1). */
export function errorHandler(deps: Deps) {
  return (err: Error, c: Context<AppEnv>) => {
    const requestId = c.get('requestId') ?? 'unknown';
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message, details: err.details, requestId } }, err.status);
    }
    if (err instanceof ZodError) {
      return c.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Dữ liệu chưa hợp lệ. Hãy kiểm tra các ô được đánh dấu.',
            details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            requestId,
          },
        },
        400,
      );
    }
    deps.log.error({ err, requestId }, 'unhandled error');
    return c.json(
      { error: { code: 'internal_error', message: 'Đã có lỗi hệ thống. Hãy thử lại; nếu vẫn lỗi, gửi mã yêu cầu cho bộ phận hỗ trợ.', requestId } },
      500,
    );
  };
}
