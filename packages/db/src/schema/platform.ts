import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgSchema, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, inList, ts, updatedAt, version } from './_common.js';

/** Administration and platform (TDD §4.12, §5.3 “Platform”). */
export const platform = pgSchema('platform');

export const role = platform.table('role', {
  id: id(),
  code: text().notNull().unique(),
  name: text().notNull(),
  /** The owner role always holds every permission (FR-ADM-03). */
  isOwner: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: version(),
});

export const rolePermission = platform.table(
  'role_permission',
  {
    roleId: uuid()
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    permission: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const USER_STATUSES = ['active', 'locked', 'disabled'] as const;

export const appUser = platform.table(
  'app_user',
  {
    id: id(),
    username: text().notNull(),
    displayName: text().notNull(),
    passwordHash: text().notNull(),
    /** Quick PIN for the POS lock screen and approvals (FR-ADM-01, TDD §10.2). */
    pinHash: text(),
    roleId: uuid()
      .notNull()
      .references(() => role.id),
    status: text().notNull().default('active'),
    mustChangePw: boolean().notNull().default(true),
    mfaSecretEnc: text(),
    failedLogins: integer().notNull().default(0),
    lastLoginAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    uniqueIndex('app_user_username_uq').on(sql`lower(${t.username})`),
    check('app_user_status_ck', inList(t.status, USER_STATUSES)),
  ],
);

export const session = platform.table(
  'session',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => appUser.id),
    tokenHash: text().notNull().unique(),
    deviceId: uuid(),
    createdAt: createdAt(),
    lastSeenAt: ts().notNull().defaultNow(),
    expiresAt: ts().notNull(),
    locked: boolean().notNull().default(false),
    ip: text(),
    userAgent: text(),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const loginAttempt = platform.table(
  'login_attempt',
  {
    id: id(),
    username: text().notNull(),
    ip: text(),
    success: boolean().notNull(),
    at: createdAt(),
  },
  (t) => [index('login_attempt_user_at_idx').on(t.username, t.at)],
);

/** Single-use supervisor approval, 2-minute TTL (FR-ADM-09, TDD §10.2). */
export const approvalToken = platform.table('approval_token', {
  id: id(),
  tokenHash: text().notNull().unique(),
  approverId: uuid()
    .notNull()
    .references(() => appUser.id),
  requesterId: uuid().references(() => appUser.id),
  action: text().notNull(),
  subject: text(),
  expiresAt: ts().notNull(),
  usedAt: ts(),
  createdAt: createdAt(),
});

/** Insert-only (trigger) audit log (FR-ADM-05, TDD §10.5). */
export const auditEntry = platform.table(
  'audit_entry',
  {
    id: id(),
    actorId: uuid(),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text(),
    before: jsonb(),
    after: jsonb(),
    at: createdAt(),
    ip: text(),
    requestId: text(),
  },
  (t) => [index('audit_entity_idx').on(t.entity, t.entityId, t.at), index('audit_actor_idx').on(t.actorId, t.at)],
);

/** Transactional outbox (TDD §9.2). */
export const outboxEvent = platform.table(
  'outbox_event',
  {
    id: id(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    createdAt: createdAt(),
    processedAt: ts(),
    attempts: integer().notNull().default(0),
  },
  (t) => [index('outbox_unprocessed_idx').on(t.createdAt).where(sql`${t.processedAt} is null`)],
);

export const notificationTemplate = platform.table(
  'notification_template',
  {
    id: id(),
    key: text().notNull(),
    locale: text().notNull().default('vi'),
    subject: text().notNull(),
    body: text().notNull(),
  },
  (t) => [uniqueIndex('notification_template_uq').on(t.key, t.locale)],
);

/** Email messages and in-app notifications (FR-ADM-08). */
export const notification = platform.table(
  'notification',
  {
    id: id(),
    channel: text().notNull(),
    /** Recipient: email address for `email`, user id for `in_app`. */
    to: text().notNull(),
    template: text().notNull(),
    vars: jsonb().notNull().default({}),
    status: text().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    sentAt: ts(),
    readAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [
    index('notification_to_idx').on(t.channel, t.to, t.createdAt),
    check('notification_channel_ck', inList(t.channel, ['email', 'in_app'])),
    check('notification_status_ck', inList(t.status, ['pending', 'sent', 'failed'])),
  ],
);

/** Units, payment methods, reason codes, order sources, holidays, locations (FR-ADM-10). */
export const masterData = platform.table(
  'master_data',
  {
    kind: text().notNull(),
    code: text().notNull(),
    i18n: jsonb().notNull(),
    active: boolean().notNull().default(true),
    sort: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.kind, t.code] })],
);

/** Typed settings registry (TDD Appendix A). Secrets are stored encrypted. */
export const setting = platform.table(
  'setting',
  {
    key: text().notNull(),
    scope: text().notNull().default('store'),
    value: jsonb().notNull(),
    updatedBy: uuid(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.key, t.scope] })],
);

export const file = platform.table(
  'file',
  {
    id: id(),
    objectKey: text().notNull().unique(),
    mime: text().notNull(),
    size: integer().notNull(),
    ownerType: text(),
    ownerId: text(),
    createdAt: createdAt(),
  },
  (t) => [index('file_owner_idx').on(t.ownerType, t.ownerId)],
);

export const idempotencyKey = platform.table('idempotency_key', {
  key: text().primaryKey(),
  requestHash: text().notNull(),
  status: integer(),
  response: jsonb(),
  createdAt: createdAt(),
  expiresAt: ts().notNull(),
});

export const webhookInbox = platform.table(
  'webhook_inbox',
  {
    id: id(),
    provider: text().notNull(),
    eventId: text().notNull(),
    receivedAt: createdAt(),
    status: text().notNull().default('received'),
  },
  (t) => [uniqueIndex('webhook_inbox_uq').on(t.provider, t.eventId)],
);
