import * as system from '@bookstore/modules/system';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './testing.js';

/** System status, manual backup requests and backup.verify (FR-ADM-06, TDD §11.4–11.5). */
let h: Harness;
let owner: string;
let manager: string;

beforeAll(async () => {
  h = await startHarness();
  const s = await h.setupOwner();
  owner = s.owner;
  manager = await h.staff(owner, 'quanly', s.roles.manager!);
}, 240_000);

afterAll(async () => {
  await h?.t.stop();
});

describe('system status and backups', () => {
  it('reports no backup yet as stale; only settings holders may read it', async () => {
    const r = await h.call('GET', '/api/v1/admin/system', { cookie: owner });
    expect(r.status).toBe(200);
    expect(r.body.backup).toMatchObject({ lastSucceededAt: null, stale: true, pending: false });
    expect(r.body.database.ok).toBe(true);
    expect((await h.call('GET', '/api/v1/admin/system', { cookie: manager })).status).toBe(403);
  });

  it('accepts one manual request at a time and audits it', async () => {
    const a = await h.call('POST', '/api/v1/admin/backups', { cookie: owner });
    expect(a.status).toBe(201);
    const b = await h.call('POST', '/api/v1/admin/backups', { cookie: owner });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('backup_pending');
    const s = await h.call('GET', '/api/v1/admin/system', { cookie: owner });
    expect(s.body.backup.pending).toBe(true);
    expect(s.body.backup.runs[0]).toMatchObject({ kind: 'manual', status: 'requested' });
    const log = await h.call('GET', '/api/v1/admin/audit?action=backup.request', { cookie: owner });
    expect(log.body.items).toHaveLength(1);
  });

  it('backup.verify notifies once per day while stale, and stops when a backup succeeds', async () => {
    expect(await system.verifyBackups(h.ctx())).toMatchObject({ stale: true, notified: 1 });
    expect(await system.verifyBackups(h.ctx())).toMatchObject({ stale: true, notified: 0 });
    // The backup container finishes the requested run.
    await h.t.sql`update platform.backup_run set status = 'succeeded', started_at = now(), finished_at = now(), size_bytes = 1024`;
    expect(await system.verifyBackups(h.ctx())).toMatchObject({ stale: false, notified: 0 });
    const s = await h.call('GET', '/api/v1/admin/system', { cookie: owner });
    expect(s.body.backup).toMatchObject({ stale: false, pending: false });
    const n = await h.call('GET', '/api/v1/notifications', { cookie: owner });
    expect(n.body.items.some((x: { template: string }) => x.template === 'backup.problem')).toBe(true);
  });
});
