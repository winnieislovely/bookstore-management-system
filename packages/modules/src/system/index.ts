import { schema } from '@bookstore/db';
import { desc, sql } from 'drizzle-orm';
import * as audit from '../audit/index.js';
import * as notifications from '../notifications/index.js';
import { AppError, requirePermission, tsParam, type Ctx } from '../platform/index.js';

/**
 * System health and backups (FR-ADM-06, TDD §4.12 Backup, §11.4, §11.5). The `backup` container
 * records runs in `platform.backup_run`; WAL archiving is read from `pg_stat_archiver`.
 */

/** Alert thresholds from TDD §11.5. */
export const BACKUP_MAX_AGE_HOURS = 26;
export const WAL_MAX_LAG_MINUTES = 5;

export interface SystemStatus {
  version: string;
  database: { ok: boolean; sizeBytes: number };
  backup: {
    lastSucceededAt: Date | null;
    ageHours: number | null;
    stale: boolean;
    pending: boolean;
    runs: { id: string; kind: string; status: string; requestedAt: Date; startedAt: Date | null; finishedAt: Date | null; sizeBytes: number | null; label: string | null; error: string | null }[];
  };
  wal: { archiving: boolean; lastArchivedAt: Date | null; lagMinutes: number | null; failedCount: number; lagging: boolean };
  queue: { pendingJobs: number; oldestMinutes: number | null; outboxPending: number };
}

const hoursSince = (d: Date | null, now: Date) => (d ? Math.round(((now.getTime() - d.getTime()) / 3_600_000) * 10) / 10 : null);

async function collect(ctx: Ctx): Promise<SystemStatus> {
  const now = ctx.clock.now();
  const [db] = await ctx.db.execute<{ size: string }>(sql`select pg_database_size(current_database())::text as size`);
  const runs = await ctx.db.select().from(schema.backupRun).orderBy(desc(schema.backupRun.requestedAt)).limit(10);
  const [last] = await ctx.db.execute<{ finished_at: Date | null }>(sql`
    select max(finished_at) as finished_at from platform.backup_run where status = 'succeeded' and kind in ('full', 'diff', 'manual')`);
  const lastSucceededAt = last?.finished_at ? new Date(last.finished_at) : null;
  const ageHours = hoursSince(lastSucceededAt, now);

  const [arch] = await ctx.db.execute<{ mode: string; last_archived_time: Date | null; failed_count: string }>(sql`
    select current_setting('archive_mode') as mode, last_archived_time, failed_count::text from pg_stat_archiver`);
  const archiving = arch?.mode === 'on' || arch?.mode === 'always';
  const lastArchivedAt = arch?.last_archived_time ? new Date(arch.last_archived_time) : null;
  const lagMinutes = archiving && lastArchivedAt ? Math.round((now.getTime() - lastArchivedAt.getTime()) / 60_000) : null;

  // pg-boss lives in its own schema, created by the worker; absent in tests.
  const [boss] = await ctx.db.execute<{ present: boolean }>(sql`select to_regclass('pgboss.job') is not null as present`);
  let pendingJobs = 0;
  let oldestMinutes: number | null = null;
  if (boss?.present) {
    const [q] = await ctx.db.execute<{ n: string; oldest: Date | null }>(sql`
      select count(*)::text as n, min(created_on) as oldest from pgboss.job where state in ('created', 'retry')`);
    pendingJobs = Number(q?.n ?? 0);
    oldestMinutes = q?.oldest ? Math.round((now.getTime() - new Date(q.oldest).getTime()) / 60_000) : null;
  }
  const [outbox] = await ctx.db.execute<{ n: string }>(sql`select count(*)::text as n from platform.outbox_event where processed_at is null`);

  return {
    version: process.env.APP_VERSION ?? 'dev',
    database: { ok: true, sizeBytes: Number(db?.size ?? 0) },
    backup: {
      lastSucceededAt,
      ageHours,
      stale: ageHours === null || ageHours > BACKUP_MAX_AGE_HOURS,
      pending: runs.some((r) => r.status === 'requested' || r.status === 'running'),
      runs: runs.map((r) => ({ id: r.id, kind: r.kind, status: r.status, requestedAt: r.requestedAt, startedAt: r.startedAt, finishedAt: r.finishedAt, sizeBytes: r.sizeBytes, label: r.label, error: r.error })),
    },
    wal: { archiving, lastArchivedAt, lagMinutes, failedCount: Number(arch?.failed_count ?? 0), lagging: archiving && (lagMinutes === null || lagMinutes > WAL_MAX_LAG_MINUTES) },
    queue: { pendingJobs, oldestMinutes, outboxPending: Number(outbox?.n ?? 0) },
  };
}

export async function status(ctx: Ctx): Promise<SystemStatus> {
  requirePermission(ctx, 'settings.manage');
  return collect(ctx);
}

/** Manual backup (FR-ADM-06): one pending request at a time; the backup container runs it. */
export async function requestBackup(ctx: Ctx): Promise<{ id: string }> {
  const actor = requirePermission(ctx, 'settings.manage');
  return ctx.db.transaction(async (tx) => {
    const [pending] = await tx.execute<{ id: string }>(sql`select id from platform.backup_run where status in ('requested', 'running') limit 1 for update`);
    if (pending) throw new AppError(409, 'backup_pending', 'Đang có một bản sao lưu chờ chạy. Hãy đợi bản đó xong.');
    const [row] = await tx.insert(schema.backupRun).values({ kind: 'manual', status: 'requested', requestedBy: actor.userId }).returning({ id: schema.backupRun.id });
    await audit.record(tx, ctx, { action: 'backup.request', entity: 'backup_run', entityId: row!.id, before: null, after: { kind: 'manual' } });
    return row!;
  });
}

/**
 * Job `backup.verify` (TDD §9.1): notify settings holders when the last base backup is older than
 * 26 hours or WAL archiving lags more than 5 minutes; at most once per problem per day.
 */
export async function verifyBackups(ctx: Ctx): Promise<{ stale: boolean; lagging: boolean; notified: number }> {
  const s = await collect(ctx);
  const now = ctx.clock.now();
  const since = new Date(now.getTime() - 86_400_000);
  let notified = 0;
  for (const problem of [s.backup.stale && ('backup_stale' as const), s.wal.lagging && ('wal_lagging' as const)]) {
    if (!problem) continue;
    const [recent] = await ctx.db.execute<{ id: string }>(sql`
      select id from platform.notification where template = 'backup.problem' and vars ->> 'problem' = ${problem} and created_at > ${tsParam(since)} limit 1`);
    if (recent) continue;
    notified += await ctx.db.transaction((tx) =>
      notifications.notifyHolders(tx, 'settings.manage', 'backup.problem', { problem, ageHours: s.backup.ageHours, lagMinutes: s.wal.lagMinutes }),
    );
  }
  return { stale: s.backup.stale, lagging: s.wal.lagging, notified };
}
