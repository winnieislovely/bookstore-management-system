import { foldText, formatOfflineSaleNo, type PromotionSnapshot } from '@bookstore/domain';
import { create } from 'zustand';
import { ApiError } from '../lib/api';
import Dexie from 'dexie';
import { db, kvGet, kvSet, open, seal, type Approver, type CachedCustomer, type CachedItem } from './db';
import { deviceFetch, deviceInfo } from './device';

/**
 * Offline sync (TDD §7.3–7.5): bootstrap and catalogue delta, an outbox of immutable events with
 * a gap-free device series written in one IndexedDB transaction, ordered upload with backoff, and
 * a single writer tab elected with the Web Locks API (TDD §7.4).
 */

export interface PosSettings {
  cashierDiscountMaxBp: number;
  earnVndPerPoint: number;
  pointValueVnd: number;
  minRedeemPoints: number;
  allowNegativePos: boolean;
  printSalesSlip: boolean;
  lockMinutes: number;
  offlineLeaseHours: number;
  storeName: string;
}

interface Status {
  online: boolean;
  syncing: boolean;
  pending: number;
  sent: number;
  error: string | null;
  leader: boolean;
  ready: boolean;
  leaseExpiresAt: string | null;
  lastSyncAt: string | null;
  set: (s: Partial<Status>) => void;
}

export const usePosStatus = create<Status>((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  sent: 0,
  error: null,
  leader: false,
  ready: false,
  leaseExpiresAt: null,
  lastSyncAt: null,
  set: (s) => set(s),
}));

const status = () => usePosStatus.getState();

function toCached(v: Omit<CachedItem, 'search'>): CachedItem {
  return { ...v, search: foldText([v.titleVi ?? '', v.title, ...v.authors, v.sku, ...v.barcodes].join(' ')) };
}

interface Bootstrap {
  device: { leaseExpiresAt: string };
  cursor: number;
  items: Omit<CachedItem, 'search'>[];
  promotions: PromotionSnapshot[];
  tiers: { code: string; name: string; benefits: { discountBp: number; pointsMultiplierBp: number } }[];
  customers: CachedCustomer[];
  approvers: Approver[];
  settings: PosSettings;
}

interface Delta {
  cursor: number;
  upserts: Omit<CachedItem, 'search'>[];
  deletes: string[];
}

async function applyItems(upserts: Omit<CachedItem, 'search'>[], deletes: string[]) {
  await db.transaction('rw', db.items, db.barcodes, async () => {
    for (const id of [...deletes, ...upserts.map((u) => u.variantId)]) await db.barcodes.where('variantId').equals(id).delete();
    await db.items.bulkDelete(deletes);
    const rows = upserts.map(toCached);
    await db.items.bulkPut(rows);
    await db.barcodes.bulkPut(rows.flatMap((r) => [...r.barcodes.map((code) => ({ code, variantId: r.variantId })), { code: r.sku, variantId: r.variantId }]));
  });
}

/** First-time or full refresh (TDD §7.3). */
/** Raised when the cached item shape changes; an older cache is refreshed from bootstrap once online (TDD §7.3). */
const CATALOG_VERSION = 2;

export async function bootstrap(): Promise<void> {
  const b = await deviceFetch<Bootstrap>('GET', '/pos/v1/bootstrap');
  await db.transaction('rw', [db.items, db.barcodes, db.customers, db.approvers, db.kv], async () => {
    await db.items.clear();
    await db.barcodes.clear();
    await db.customers.clear();
    await db.approvers.clear();
    await applyItems(b.items, []);
    await db.customers.bulkPut(b.customers);
    await db.approvers.bulkPut(b.approvers);
    await kvSet('cursor', b.cursor);
    await kvSet('catalogVersion', CATALOG_VERSION);
    await kvSet('promotions', b.promotions);
    await kvSet('tiers', b.tiers);
    await kvSet('settings', b.settings);
    await kvSet('leaseExpiresAt', b.device.leaseExpiresAt);
    await kvSet('lastSyncAt', new Date().toISOString());
  });
  status().set({ leaseExpiresAt: b.device.leaseExpiresAt, lastSyncAt: new Date().toISOString(), ready: true });
}

async function pullDelta(): Promise<void> {
  const cursor = (await kvGet<number>('cursor')) ?? 0;
  const d = await deviceFetch<Delta>('GET', `/pos/v1/delta?cursor=${cursor}`);
  await applyItems(d.upserts, d.deletes);
  await kvSet('cursor', d.cursor);
}

// ---------------------------------------------------------------------------------------------
// Outbox

/** Append an event; `withDocNo` reserves the next device sale number in the same transaction (TDD §7.4). */
export async function enqueue(type: string, build: (docNo: string | null) => Record<string, unknown>, withDocNo = false): Promise<{ clientEventId: string; docNo: string | null; payload: Record<string, unknown> }> {
  const info = await deviceInfo();
  if (!info) throw new Error('Device not registered');
  const clientEventId = crypto.randomUUID();
  let docNo: string | null = null;
  let payload: Record<string, unknown> = {};
  // Number, event and local sale are written in ONE transaction, so a crash never leaves a number
  // without its event (TDD §7.4); Dexie.waitFor keeps it open while the payload is encrypted.
  await db.transaction('rw', db.kv, db.outbox, db.sales, async () => {
    const seq = ((await kvGet<number>('seq')) ?? 0) + 1;
    await kvSet('seq', seq);
    if (withDocNo) {
      const n = ((await kvGet<number>('saleCounter')) ?? 0) + 1;
      await kvSet('saleCounter', n);
      docNo = formatOfflineSaleNo(info.deviceCode, n);
    }
    payload = build(docNo);
    const sealed = await Dexie.waitFor(seal(payload));
    await db.outbox.put({ clientEventId, seq, type, createdAt: new Date().toISOString(), ...sealed });
    if (docNo) await db.sales.put({ docNo, clientEventId, soldAt: new Date().toISOString(), totalVnd: Number(payload.totalVnd ?? 0), synced: false });
  });
  status().set({ pending: await db.outbox.count() });
  void flush();
  return { clientEventId, docNo, payload };
}

let backoffMs = 5_000;
let flushing = false;

/** Upload in seq order, up to 50 per request; idempotent on the server (TDD §7.5). */
export async function flush(): Promise<void> {
  if (flushing || !status().leader || !navigator.onLine) return;
  flushing = true;
  try {
    for (;;) {
      const batch = await db.outbox.orderBy('seq').limit(50).toArray();
      if (!batch.length) break;
      status().set({ syncing: true, error: null, sent: 0 });
      const events = await Promise.all(batch.map(async (e) => ({ clientEventId: e.clientEventId, seq: e.seq, createdAt: e.createdAt, type: e.type, payload: await open(e) })));
      const r = await deviceFetch<{ results: { clientEventId: string; status: string }[]; delta: Delta; leaseExpiresAt: string }>('POST', '/pos/v1/sync', {
        cursor: (await kvGet<number>('cursor')) ?? 0,
        events,
      });
      // Accepted, duplicate and rejected events are all stored on the server now (rejections for a manager).
      const done = r.results.map((x) => x.clientEventId);
      await db.outbox.bulkDelete(done);
      for (const id of done) await db.sales.where('clientEventId').equals(id).modify({ synced: true });
      await applyItems(r.delta.upserts, r.delta.deletes);
      await kvSet('cursor', r.delta.cursor);
      await kvSet('leaseExpiresAt', r.leaseExpiresAt);
      status().set({ sent: done.length, leaseExpiresAt: r.leaseExpiresAt, lastSyncAt: new Date().toISOString(), pending: await db.outbox.count() });
      backoffMs = 5_000;
    }
  } catch (e) {
    status().set({ error: e instanceof ApiError ? e.message : 'Lỗi đồng bộ' });
    backoffMs = Math.min(backoffMs * 2, 5 * 60_000);
    setTimeout(() => void flush(), backoffMs);
  } finally {
    flushing = false;
    status().set({ syncing: false, pending: await db.outbox.count() });
  }
}

// ---------------------------------------------------------------------------------------------
// Start: leader election, timers, connection events

let started = false;

export async function startSync(): Promise<void> {
  if (started) return;
  started = true;
  const lease = await kvGet<string>('leaseExpiresAt');
  status().set({ leaseExpiresAt: lease ?? null, lastSyncAt: (await kvGet<string>('lastSyncAt')) ?? null, pending: await db.outbox.count(), ready: (await db.items.count()) > 0 });
  // One writer tab (TDD §7.4); the lock is held for the life of the page.
  if ('locks' in navigator) {
    void navigator.locks.request('bms-pos-writer', { ifAvailable: true }, (lock) => {
      status().set({ leader: !!lock });
      return lock ? new Promise<void>(() => undefined) : Promise.resolve();
    });
  } else status().set({ leader: true });

  const goOnline = () => {
    status().set({ online: true });
    void flush();
    void pullDelta().catch(() => undefined);
  };
  window.addEventListener('online', goOnline);
  window.addEventListener('offline', () => status().set({ online: false }));
  setInterval(() => void flush(), 15_000);
  setInterval(() => navigator.onLine && void pullDelta().catch(() => undefined), 60_000);
  if (navigator.onLine && (await deviceInfo())) {
    try {
      if (!status().ready || (await kvGet<number>('catalogVersion')) !== CATALOG_VERSION) await bootstrap();
      else await pullDelta();
    } catch {
      /* stays usable from the cache */
    }
    void flush();
  }
}

/** Offline lease: the POS locks when the device has not reached the server in time (TDD §7.2). */
export function leaseState(now = Date.now()): 'ok' | 'expiring' | 'expired' | 'unknown' {
  const exp = status().leaseExpiresAt;
  if (!exp) return 'unknown';
  const left = new Date(exp).getTime() - now;
  if (left <= 0) return 'expired';
  return left < 12 * 3600_000 ? 'expiring' : 'ok';
}
