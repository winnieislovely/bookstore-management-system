import { createDb } from '@bookstore/db';
import { MockEInvoiceAdapter, type EInvoiceAdapter } from '@bookstore/modules/integrations/einvoice';
import * as jobs from '@bookstore/modules/jobs';
import { createFieldCrypto, systemClock, type Ctx } from '@bookstore/modules/platform';
import * as system from '@bookstore/modules/system';
import { PgBoss } from 'pg-boss';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * The `worker` process (TDD §3.2, §9): pg-boss consumers and schedules in the same PostgreSQL,
 * cron in Asia/Ho_Chi_Minh. Handlers call module functions; every handler is idempotent.
 */
const Env = z.object({
  DATABASE_URL: z.string().default('postgres://bookstore:bookstore@127.0.0.1:5432/bookstore'),
  FIELD_ENCRYPTION_KEY: z.string().min(40),
  /** `mock` until the MISA meInvoice sandbox and live adapters are configured (TDD §8.1). */
  EINVOICE_ADAPTER: z.enum(['mock']).default('mock'),
  LOG_LEVEL: z.string().default('info'),
});
const env = Env.parse(process.env);
const log = pino({ level: env.LOG_LEVEL });
const { db } = createDb(env.DATABASE_URL, { max: 5 });
const crypto = createFieldCrypto(env.FIELD_ENCRYPTION_KEY);
const einvoice: EInvoiceAdapter = new MockEInvoiceAdapter();

const ctx = (): Ctx => ({ db, clock: systemClock, crypto, actor: null, requestId: `job-${randomUUID()}`, ip: null });
const TZ = 'Asia/Ho_Chi_Minh';

/** Job catalogue entries implemented for release R1 (TDD §9.1). */
const JOBS: { name: string; cron: string; run: () => Promise<unknown> }[] = [
  { name: 'einvoice.issue', cron: '* * * * *', run: () => jobs.processEinvoices(ctx(), einvoice) },
  { name: 'outbox.dispatch', cron: '* * * * *', run: () => jobs.dispatchOutbox(ctx(), {}) },
  { name: 'loyalty.points_expire', cron: '30 1 * * *', run: () => jobs.expirePoints(ctx()) },
  { name: 'loyalty.tier_recalc', cron: '0 2 * * *', run: () => jobs.recalcTiers(ctx()) },
  {
    name: 'integrity.check',
    cron: '30 2 * * *',
    run: async () => {
      const drift = await jobs.integrityCheck(ctx());
      if (drift.length) log.error({ drift }, 'integrity drift detected');
      return { drift: drift.length };
    },
  },
  { name: 'session.cleanup', cron: '15 * * * *', run: () => jobs.cleanupSessions(ctx()) },
  { name: 'consignment.deadline_alert', cron: '0 7 * * *', run: () => jobs.consignmentDeadlineAlert(ctx()) },
  { name: 'backup.verify', cron: '10 * * * *', run: () => system.verifyBackups(ctx()) },
];

async function main() {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (err) => log.error({ err }, 'pg-boss error'));
  await boss.start();
  for (const job of JOBS) {
    await boss.createQueue(job.name);
    await boss.schedule(job.name, job.cron, null, { tz: TZ });
    await boss.work(job.name, async () => {
      const started = performance.now();
      const result = await job.run();
      log.info({ job: job.name, ms: Math.round(performance.now() - started), result }, 'job done');
    });
  }
  log.info({ jobs: JOBS.map((j) => j.name) }, 'worker started');
  const stop = async () => {
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
