import { schema } from '@bookstore/db';
import { ALL_PERMISSIONS, DEFAULT_ROLES, isPermission, type Permission, type RoleCode } from '@bookstore/domain';
import { hash, verify } from '@node-rs/argon2';
import { and, asc, count, eq, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as audit from '../audit/index.js';
import * as settings from '../settings/index.js';
import {
  AppError,
  errors,
  randomToken,
  requirePermission,
  sha256,
  type Actor,
  type Ctx,
  type Tx,
} from '../platform/index.js';

/** Identity, sessions, approvals and RBAC (FR-ADM-01..03, FR-ADM-09, TDD §4.12, §10.2). */

const MIN_PASSWORD_LENGTH = 10;
/** TDD §6.1: login 5 per 15 min per account+IP; PIN approval 5 per 15 min per session. */
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
/** Consecutive failed logins before the account locks and needs a manager unlock (FR-ADM-01). */
const LOCKOUT_AFTER = 5;
const SESSION_ABSOLUTE_MS = 14 * 24 * 3600_000;
const APPROVAL_TTL_MS = 2 * 60_000;

/** Argon2id (NFR-SEC-01); parameters at or above the OWASP minimum. */
const ARGON = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashSecret = (plain: string) => hash(plain, ARGON);
const verifySecret = (hashed: string, plain: string) => verify(hashed, plain).catch(() => false);

export const PasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Mật khẩu cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`)
  .max(200);
export const PinSchema = z.string().regex(/^\d{6}$/, 'Mã PIN gồm đúng 6 chữ số.');

async function recentFailures(tx: Tx, key: string, ip: string | null, now: Date): Promise<number> {
  const since = new Date(now.getTime() - ATTEMPT_WINDOW_MS);
  const a = schema.loginAttempt;
  const conds = [eq(a.username, key), eq(a.success, false), gte(a.at, since)];
  if (ip) conds.push(eq(a.ip, ip));
  const [row] = await tx.select({ n: count() }).from(a).where(and(...conds));
  return row?.n ?? 0;
}

async function loadActor(tx: Tx, userId: string, sessionId: string): Promise<Actor | null> {
  const [u] = await tx
    .select({
      id: schema.appUser.id,
      username: schema.appUser.username,
      displayName: schema.appUser.displayName,
      status: schema.appUser.status,
      roleId: schema.role.id,
      isOwner: schema.role.isOwner,
    })
    .from(schema.appUser)
    .innerJoin(schema.role, eq(schema.role.id, schema.appUser.roleId))
    .where(eq(schema.appUser.id, userId));
  if (!u || u.status !== 'active') return null;
  const perms = u.isOwner
    ? ALL_PERMISSIONS
    : (await tx.select({ p: schema.rolePermission.permission }).from(schema.rolePermission).where(eq(schema.rolePermission.roleId, u.roleId)))
        .map((r) => r.p)
        .filter(isPermission);
  return {
    userId: u.id,
    sessionId,
    username: u.username,
    displayName: u.displayName,
    roleId: u.roleId,
    isOwner: u.isOwner,
    permissions: new Set<Permission>(perms),
  };
}

// ---------------------------------------------------------------------------------------------
// Sign-in, sessions, lock screen

export interface LoginResult {
  token: string;
  expiresAt: Date;
  mustChangePassword: boolean;
  actor: Actor;
}

export async function login(ctx: Ctx, username: string, password: string, userAgent: string | null): Promise<LoginResult> {
  const now = ctx.clock.now();
  const key = username.trim().toLowerCase();
  if ((await recentFailures(ctx.db, key, ctx.ip, now)) >= MAX_ATTEMPTS) {
    throw new AppError(429, 'too_many_attempts', 'Đăng nhập sai quá nhiều lần. Hãy thử lại sau 15 phút.');
  }
  const [user] = await ctx.db.select().from(schema.appUser).where(sql`lower(${schema.appUser.username}) = ${key}`);
  const ok = user ? await verifySecret(user.passwordHash, password) : (await verifySecret(await dummyHash, password), false);

  if (!user || !ok) {
    await ctx.db.transaction(async (tx) => {
      await tx.insert(schema.loginAttempt).values({ username: key, ip: ctx.ip, success: false, at: now });
      if (user && user.status === 'active') {
        const failed = user.failedLogins + 1;
        await tx
          .update(schema.appUser)
          .set({ failedLogins: failed, status: failed >= LOCKOUT_AFTER ? 'locked' : 'active', updatedAt: now })
          .where(eq(schema.appUser.id, user.id));
        if (failed >= LOCKOUT_AFTER) {
          await audit.record(tx, ctx, { action: 'auth.lockout', entity: 'app_user', entityId: user.id });
        }
      }
    });
    throw new AppError(401, 'invalid_credentials', 'Tên đăng nhập hoặc mật khẩu không đúng.');
  }
  if (user.status === 'locked') {
    throw new AppError(423, 'account_locked', 'Tài khoản đã bị khóa do đăng nhập sai nhiều lần. Hãy nhờ quản lý mở khóa.');
  }
  if (user.status !== 'active') {
    throw new AppError(403, 'account_disabled', 'Tài khoản đã bị vô hiệu hóa. Hãy liên hệ chủ cửa hàng.');
  }

  const token = randomToken();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  const sessionId = await ctx.db.transaction(async (tx) => {
    await tx.insert(schema.loginAttempt).values({ username: key, ip: ctx.ip, success: true, at: now });
    await tx.update(schema.appUser).set({ failedLogins: 0, lastLoginAt: now }).where(eq(schema.appUser.id, user.id));
    const [s] = await tx
      .insert(schema.session)
      .values({ userId: user.id, tokenHash: sha256(token), expiresAt, ip: ctx.ip, userAgent, createdAt: now, lastSeenAt: now })
      .returning({ id: schema.session.id });
    await audit.record(tx, { ...ctx, actor: { userId: user.id } as Actor }, { action: 'auth.login', entity: 'app_user', entityId: user.id });
    return s!.id;
  });
  const actor = await loadActor(ctx.db, user.id, sessionId);
  if (!actor) throw errors.unauthenticated();
  return { token, expiresAt, mustChangePassword: user.mustChangePw, actor };
}

/** Verified when the username is unknown, so timing does not reveal which usernames exist. */
const dummyHash = hashSecret('timing-equaliser-not-a-password');

export interface SessionInfo {
  actor: Actor;
  locked: boolean;
  mustChangePassword: boolean;
}

/**
 * Resolve a session cookie: absolute expiry, idle timeout (`session.idle_hours`), permissions
 * re-read from the database (FR-ADM-03).
 */
export async function resolveSession(ctx: Ctx, token: string): Promise<SessionInfo | null> {
  const now = ctx.clock.now();
  const [s] = await ctx.db.select().from(schema.session).where(eq(schema.session.tokenHash, sha256(token)));
  if (!s || s.expiresAt <= now) return null;
  const cfg = await settings.snapshot(ctx);
  if (now.getTime() - s.lastSeenAt.getTime() > cfg['session.idle_hours'] * 3600_000) return null;
  const actor = await loadActor(ctx.db, s.userId, s.id);
  if (!actor) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > 60_000) {
    await ctx.db.update(schema.session).set({ lastSeenAt: now }).where(eq(schema.session.id, s.id));
  }
  const [u] = await ctx.db.select({ m: schema.appUser.mustChangePw }).from(schema.appUser).where(eq(schema.appUser.id, s.userId));
  return { actor, locked: s.locked, mustChangePassword: u?.m ?? false };
}

export async function logout(ctx: Ctx): Promise<void> {
  if (!ctx.actor) return;
  await ctx.db.delete(schema.session).where(eq(schema.session.id, ctx.actor.sessionId));
}

/** POS lock screen (FR-ADM-01, NFR-SEC-07): the cart is kept; the session needs the PIN to resume. */
export async function lock(ctx: Ctx): Promise<void> {
  if (!ctx.actor) throw errors.unauthenticated();
  await ctx.db.update(schema.session).set({ locked: true }).where(eq(schema.session.id, ctx.actor.sessionId));
}

export async function unlock(ctx: Ctx, pin: string): Promise<void> {
  if (!ctx.actor) throw errors.unauthenticated();
  const now = ctx.clock.now();
  const key = `pin:${ctx.actor.sessionId}`;
  if ((await recentFailures(ctx.db, key, null, now)) >= MAX_ATTEMPTS) {
    throw new AppError(429, 'too_many_attempts', 'Nhập sai mã PIN quá nhiều lần. Hãy đăng nhập lại bằng mật khẩu.');
  }
  const [u] = await ctx.db.select({ pinHash: schema.appUser.pinHash }).from(schema.appUser).where(eq(schema.appUser.id, ctx.actor.userId));
  if (!u?.pinHash || !(await verifySecret(u.pinHash, pin))) {
    await ctx.db.insert(schema.loginAttempt).values({ username: key, ip: ctx.ip, success: false, at: now });
    const left = MAX_ATTEMPTS - (await recentFailures(ctx.db, key, null, now));
    throw new AppError(401, 'invalid_pin', `Mã PIN không đúng (còn ${Math.max(0, left)} lần).`, { attemptsLeft: Math.max(0, left) });
  }
  await ctx.db.update(schema.session).set({ locked: false, lastSeenAt: now }).where(eq(schema.session.id, ctx.actor.sessionId));
}

export async function changePassword(ctx: Ctx, current: string, next: string): Promise<void> {
  if (!ctx.actor) throw errors.unauthenticated();
  PasswordSchema.parse(next);
  const [u] = await ctx.db.select().from(schema.appUser).where(eq(schema.appUser.id, ctx.actor.userId));
  if (!u || !(await verifySecret(u.passwordHash, current))) {
    throw new AppError(400, 'invalid_current_password', 'Mật khẩu hiện tại không đúng.');
  }
  if (current === next) throw new AppError(400, 'password_unchanged', 'Mật khẩu mới phải khác mật khẩu hiện tại.');
  const passwordHash = await hashSecret(next);
  await ctx.db.transaction(async (tx) => {
    await tx.update(schema.appUser).set({ passwordHash, mustChangePw: false, updatedAt: ctx.clock.now() }).where(eq(schema.appUser.id, u.id));
    // Sign out other sessions after a password change.
    await tx.delete(schema.session).where(and(eq(schema.session.userId, u.id), sql`${schema.session.id} <> ${ctx.actor!.sessionId}`));
    await audit.record(tx, ctx, { action: 'auth.password_change', entity: 'app_user', entityId: u.id });
  });
}

export async function setPin(ctx: Ctx, pin: string): Promise<void> {
  if (!ctx.actor) throw errors.unauthenticated();
  PinSchema.parse(pin);
  const pinHash = await hashSecret(pin);
  await ctx.db.transaction(async (tx) => {
    await tx.update(schema.appUser).set({ pinHash, updatedAt: ctx.clock.now() }).where(eq(schema.appUser.id, ctx.actor!.userId));
    await audit.record(tx, ctx, { action: 'auth.pin_set', entity: 'app_user', entityId: ctx.actor!.userId });
  });
}

// ---------------------------------------------------------------------------------------------
// Supervisor approval (FR-ADM-09, TDD §10.2)

/** Each approvable action and the permission the approver must hold. */
export const APPROVAL_ACTIONS = {
  discount_over_limit: 'sale.discount_unlimited',
  price_override: 'sale.price_override',
  return_exception: 'return.approve',
  refund: 'return.approve',
  void_sale: 'sale.void_paid',
  stock_adjustment: 'inventory.count_approve',
} as const satisfies Record<string, Permission>;
export type ApprovalAction = keyof typeof APPROVAL_ACTIONS;

export interface ApproveInput {
  approverUsername: string;
  /** Either the approver's 6-digit PIN or their password. */
  pin?: string | undefined;
  password?: string | undefined;
  action: ApprovalAction;
  subject?: string | undefined;
}

export async function approve(ctx: Ctx, input: ApproveInput) {
  if (!ctx.actor) throw errors.unauthenticated();
  const now = ctx.clock.now();
  const key = `approve:${ctx.actor.sessionId}`;
  if ((await recentFailures(ctx.db, key, null, now)) >= MAX_ATTEMPTS) {
    throw new AppError(429, 'too_many_attempts', 'Nhập sai quá nhiều lần. Hãy thử lại sau 15 phút.');
  }
  const [approver] = await ctx.db
    .select()
    .from(schema.appUser)
    .where(sql`lower(${schema.appUser.username}) = ${input.approverUsername.trim().toLowerCase()}`);
  const secretOk =
    approver &&
    approver.status === 'active' &&
    (input.pin ? !!approver.pinHash && (await verifySecret(approver.pinHash, input.pin)) : !!input.password && (await verifySecret(approver.passwordHash, input.password)));
  if (!approver || !secretOk) {
    await ctx.db.insert(schema.loginAttempt).values({ username: key, ip: ctx.ip, success: false, at: now });
    throw new AppError(401, 'invalid_approval', 'Thông tin duyệt không đúng. Hãy kiểm tra người duyệt và mã PIN.');
  }
  const approverActor = await loadActor(ctx.db, approver.id, 'approval');
  const needed = APPROVAL_ACTIONS[input.action];
  if (!approverActor || !(approverActor.isOwner || approverActor.permissions.has(needed))) {
    throw new AppError(403, 'approver_not_allowed', `${approver.displayName} không có quyền duyệt thao tác này.`);
  }
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS);
  await ctx.db.transaction(async (tx) => {
    await tx.insert(schema.approvalToken).values({
      tokenHash: sha256(token),
      approverId: approver.id,
      requesterId: ctx.actor!.userId,
      action: input.action,
      subject: input.subject ?? null,
      expiresAt,
      createdAt: now,
    });
    await audit.record(tx, ctx, {
      action: 'auth.approval_granted',
      entity: 'approval',
      entityId: input.subject ?? null,
      after: { action: input.action, approverId: approver.id, requesterId: ctx.actor!.userId },
    });
  });
  return { approvalToken: token, approverName: approver.displayName, expiresAt };
}

/** Consume a single-use approval bound to the action and subject. Returns the approver id. */
export async function consumeApproval(tx: Tx, ctx: Ctx, token: string, action: ApprovalAction, subject?: string): Promise<string> {
  const now = ctx.clock.now();
  const [row] = await tx
    .update(schema.approvalToken)
    .set({ usedAt: now })
    .where(
      and(
        eq(schema.approvalToken.tokenHash, sha256(token)),
        eq(schema.approvalToken.action, action),
        isNull(schema.approvalToken.usedAt),
        gte(schema.approvalToken.expiresAt, now),
        subject ? sql`(${schema.approvalToken.subject} is null or ${schema.approvalToken.subject} = ${subject})` : undefined,
      ),
    )
    .returning({ approverId: schema.approvalToken.approverId });
  if (!row) throw new AppError(403, 'approval_required', 'Cần quản lý duyệt (mã duyệt không hợp lệ hoặc đã hết hạn).', { action });
  return row.approverId;
}

// ---------------------------------------------------------------------------------------------
// First-run wizard (FR-ADM-02)

export const SetupSchema = z.object({
  owner: z.object({
    username: z.string().trim().min(3).max(60),
    displayName: z.string().trim().min(1).max(120),
    password: PasswordSchema,
  }),
  store: z.object({
    name: z.string().trim().min(1),
    address: z.string().trim().default(''),
    taxCode: z.string().trim().default(''),
    phone: z.string().trim().default(''),
  }),
});

export async function setupStatus(ctx: Ctx): Promise<{ needsSetup: boolean }> {
  const [row] = await ctx.db.select({ n: count() }).from(schema.appUser);
  return { needsSetup: (row?.n ?? 0) === 0 };
}

/** Seed default roles (SRS Appendix A) if none exist. */
async function seedRoles(tx: Tx): Promise<Record<RoleCode, string>> {
  const existing = await tx.select().from(schema.role);
  const ids = Object.fromEntries(existing.map((r) => [r.code, r.id])) as Partial<Record<RoleCode, string>>;
  for (const [code, def] of Object.entries(DEFAULT_ROLES) as [RoleCode, (typeof DEFAULT_ROLES)[RoleCode]][]) {
    if (ids[code]) continue;
    const [r] = await tx.insert(schema.role).values({ code, name: def.name, isOwner: code === 'owner' }).returning({ id: schema.role.id });
    ids[code] = r!.id;
    if (code !== 'owner' && def.permissions.length) {
      await tx.insert(schema.rolePermission).values(def.permissions.map((permission) => ({ roleId: r!.id, permission })));
    }
  }
  return ids as Record<RoleCode, string>;
}

export async function runSetup(ctx: Ctx, input: z.infer<typeof SetupSchema>) {
  const data = SetupSchema.parse(input);
  const passwordHash = await hashSecret(data.owner.password);
  return ctx.db.transaction(async (tx) => {
    // Serialise concurrent wizard submissions; the check below then sees the winner's user.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bms.setup'))`);
    const [row] = await tx.select({ n: count() }).from(schema.appUser);
    if ((row?.n ?? 0) > 0) throw new AppError(409, 'already_set_up', 'Hệ thống đã được thiết lập. Hãy đăng nhập.');
    const roles = await seedRoles(tx);
    const [owner] = await tx
      .insert(schema.appUser)
      .values({
        username: data.owner.username,
        displayName: data.owner.displayName,
        passwordHash,
        roleId: roles.owner,
        mustChangePw: false,
      })
      .returning({ id: schema.appUser.id });
    const ownerCtx: Ctx = { ...ctx, actor: { userId: owner!.id } as Actor };
    await settings.write(
      ownerCtx,
      { 'store.name': data.store.name, 'store.address': data.store.address, 'store.tax_code': data.store.taxCode, 'store.phone': data.store.phone },
      tx,
    );
    await audit.record(tx, ownerCtx, { action: 'setup.completed', entity: 'app_user', entityId: owner!.id });
    return { ownerId: owner!.id };
  });
}

// ---------------------------------------------------------------------------------------------
// Users and roles (FR-ADM-03, UC-26)

function publicUser(u: typeof schema.appUser.$inferSelect & { roleName?: string | null }) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    roleId: u.roleId,
    roleName: u.roleName ?? null,
    status: u.status,
    mustChangePassword: u.mustChangePw,
    hasPin: u.pinHash !== null,
    lastLoginAt: u.lastLoginAt,
    version: u.version,
  };
}

export async function listUsers(ctx: Ctx) {
  requirePermission(ctx, 'user.manage');
  const rows = await ctx.db
    .select({ u: schema.appUser, roleName: schema.role.name })
    .from(schema.appUser)
    .innerJoin(schema.role, eq(schema.role.id, schema.appUser.roleId))
    .orderBy(asc(schema.appUser.displayName));
  return rows.map((r) => publicUser({ ...r.u, roleName: r.roleName }));
}

export const CreateUserSchema = z.object({
  username: z.string().trim().min(3).max(60),
  displayName: z.string().trim().min(1).max(120),
  roleId: z.uuid(),
  /** Temporary password; the user must change it on first login (FR-ADM-01). */
  password: PasswordSchema,
});

export async function createUser(ctx: Ctx, input: z.infer<typeof CreateUserSchema>) {
  requirePermission(ctx, 'user.manage');
  const data = CreateUserSchema.parse(input);
  const passwordHash = await hashSecret(data.password);
  return ctx.db.transaction(async (tx) => {
    const [dupe] = await tx.select({ id: schema.appUser.id }).from(schema.appUser).where(sql`lower(${schema.appUser.username}) = ${data.username.toLowerCase()}`);
    if (dupe) throw errors.conflict('username_taken', `Tên đăng nhập '${data.username}' đã được dùng. Hãy chọn tên khác.`);
    const [u] = await tx
      .insert(schema.appUser)
      .values({ username: data.username, displayName: data.displayName, roleId: data.roleId, passwordHash, mustChangePw: true })
      .returning();
    await audit.record(tx, ctx, { action: 'user.create', entity: 'app_user', entityId: u!.id, after: { username: u!.username, roleId: u!.roleId } });
    return publicUser(u!);
  });
}

export const UpdateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  roleId: z.uuid().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  version: z.number().int(),
});

export async function updateUser(ctx: Ctx, id: string, input: z.infer<typeof UpdateUserSchema>) {
  const actor = requirePermission(ctx, 'user.manage');
  const data = UpdateUserSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.appUser).where(eq(schema.appUser.id, id));
    if (!before) throw errors.notFound('Người dùng');
    if (before.version !== data.version) throw errors.stale();
    if (id === actor.userId && (data.status === 'disabled' || (data.roleId && data.roleId !== before.roleId))) {
      throw new AppError(409, 'cannot_change_self', 'Bạn không thể tự đổi vai trò hoặc vô hiệu hóa tài khoản của mình.');
    }
    const [u] = await tx
      .update(schema.appUser)
      .set({
        ...(data.displayName !== undefined && { displayName: data.displayName }),
        ...(data.roleId !== undefined && { roleId: data.roleId }),
        ...(data.status !== undefined && { status: data.status }),
        version: before.version + 1,
        updatedAt: ctx.clock.now(),
      })
      .where(and(eq(schema.appUser.id, id), eq(schema.appUser.version, data.version)))
      .returning();
    if (!u) throw errors.stale();
    if (data.status === 'disabled') await tx.delete(schema.session).where(eq(schema.session.userId, id));
    await audit.record(tx, ctx, {
      action: data.roleId && data.roleId !== before.roleId ? 'user.role_change' : 'user.update',
      entity: 'app_user',
      entityId: id,
      before: { displayName: before.displayName, roleId: before.roleId, status: before.status },
      after: { displayName: u.displayName, roleId: u.roleId, status: u.status },
    });
    return publicUser(u);
  });
}

/** Manager unlock after repeated failed logins (FR-ADM-01). */
export async function unlockUser(ctx: Ctx, id: string) {
  requirePermission(ctx, 'user.unlock');
  await ctx.db.transaction(async (tx) => {
    const [u] = await tx
      .update(schema.appUser)
      .set({ status: 'active', failedLogins: 0, updatedAt: ctx.clock.now() })
      .where(and(eq(schema.appUser.id, id), eq(schema.appUser.status, 'locked')))
      .returning({ id: schema.appUser.id });
    if (!u) throw errors.conflict('not_locked', 'Tài khoản này không bị khóa.');
    await audit.record(tx, ctx, { action: 'user.unlock', entity: 'app_user', entityId: id });
  });
}

export async function listRoles(ctx: Ctx) {
  requirePermission(ctx, 'role.manage');
  const roles = await ctx.db.select().from(schema.role).orderBy(asc(schema.role.name));
  const perms = await ctx.db.select().from(schema.rolePermission);
  return roles.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    isOwner: r.isOwner,
    version: r.version,
    permissions: r.isOwner ? ALL_PERMISSIONS : perms.filter((p) => p.roleId === r.id).map((p) => p.permission),
  }));
}

export const RoleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  permissions: z.array(z.string()).refine((ps) => ps.every(isPermission), 'Quyền không tồn tại.'),
});

export async function createRole(ctx: Ctx, input: z.infer<typeof RoleSchema>) {
  requirePermission(ctx, 'role.manage');
  const data = RoleSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [r] = await tx
      .insert(schema.role)
      .values({ code: `custom_${randomToken(6).toLowerCase()}`, name: data.name })
      .returning();
    if (data.permissions.length) {
      await tx.insert(schema.rolePermission).values([...new Set(data.permissions)].map((permission) => ({ roleId: r!.id, permission })));
    }
    await audit.record(tx, ctx, { action: 'role.create', entity: 'role', entityId: r!.id, after: data });
    return { id: r!.id };
  });
}

export async function updateRole(ctx: Ctx, id: string, input: z.infer<typeof RoleSchema> & { version: number }) {
  requirePermission(ctx, 'role.manage');
  const data = RoleSchema.parse(input);
  await ctx.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.role).where(eq(schema.role.id, id));
    if (!before) throw errors.notFound('Vai trò');
    if (before.isOwner) throw new AppError(409, 'owner_role_fixed', 'Vai trò chủ cửa hàng luôn có mọi quyền và không thể chỉnh sửa.');
    if (before.version !== input.version) throw errors.stale();
    const oldPerms = (await tx.select().from(schema.rolePermission).where(eq(schema.rolePermission.roleId, id))).map((p) => p.permission);
    await tx.update(schema.role).set({ name: data.name, version: before.version + 1, updatedAt: ctx.clock.now() }).where(eq(schema.role.id, id));
    await tx.delete(schema.rolePermission).where(eq(schema.rolePermission.roleId, id));
    if (data.permissions.length) {
      await tx.insert(schema.rolePermission).values([...new Set(data.permissions)].map((permission) => ({ roleId: id, permission })));
    }
    await audit.record(tx, ctx, {
      action: 'role.permissions_change',
      entity: 'role',
      entityId: id,
      before: { name: before.name, permissions: oldPerms },
      after: data,
    });
  });
}
