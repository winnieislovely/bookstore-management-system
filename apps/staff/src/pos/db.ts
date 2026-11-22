import Dexie, { type Table } from 'dexie';

/**
 * Local POS store (TDD §7.3), IndexedDB through Dexie. The outbox holds immutable events until
 * the server acknowledges them; their payloads are AES-GCM encrypted with a non-extractable key
 * (TDD §7.7). No cost or payroll data is ever stored on the device.
 */

export interface CachedItem {
  variantId: string;
  itemId: string;
  sku: string;
  title: string;
  /** Vietnamese title (null when none); shown in preference to `title`. */
  titleVi?: string | null;
  authors: string[];
  priceVnd: number;
  vatBp: number;
  barcodes: string[];
  categoryIds: string[];
  publisherId: string | null;
  brandId: string | null;
  isBundle: boolean;
  /** Item kind and first photo (null when none), for the search results (TDD §7.3). */
  kind?: string;
  imageFileId?: string | null;
  /** The shelf's name, to fetch it from the right shelf (FR-CAT-01). */
  shelfName?: string | null;
  /** Folded search text: both titles, authors, SKU, barcodes (diacritic-insensitive). */
  search: string;
}

export interface CachedCustomer {
  id: string;
  name: string;
  phoneE164: string | null;
  tierCode: string | null;
  pointsBalance: number;
}

export interface Approver {
  userId: string;
  username: string;
  displayName: string;
  pinVerifier: string;
  actions: string[];
}

export interface OutboxEvent {
  clientEventId: string;
  seq: number;
  type: string;
  createdAt: string;
  /** Encrypted JSON payload. */
  iv: Uint8Array;
  data: ArrayBuffer;
}

/** Offline sales kept for the sales list, returns of device sales and the slip. */
export interface LocalSale {
  docNo: string;
  clientEventId: string;
  soldAt: string;
  totalVnd: number;
  synced: boolean;
}

export interface Kv {
  key: string;
  value: unknown;
}

class PosDb extends Dexie {
  items!: Table<CachedItem, string>;
  barcodes!: Table<{ code: string; variantId: string }, string>;
  customers!: Table<CachedCustomer, string>;
  approvers!: Table<Approver, string>;
  outbox!: Table<OutboxEvent, string>;
  sales!: Table<LocalSale, string>;
  heldCarts!: Table<{ id: string; label: string; payload: unknown; heldAt: string }, string>;
  kv!: Table<Kv, string>;

  constructor() {
    super('bms-pos');
    this.version(1).stores({
      items: 'variantId, sku, *barcodes',
      barcodes: 'code, variantId',
      customers: 'id, phoneE164',
      approvers: 'userId, username',
      outbox: 'clientEventId, seq',
      sales: 'docNo, clientEventId',
      heldCarts: 'id, heldAt',
      kv: 'key',
    });
  }
}

export const db = new PosDb();

/** The title the POS shows: Vietnamese when the item has one (TDD §7.3). */
export const itemTitle = (i: Pick<CachedItem, 'title' | 'titleVi'>) => i.titleVi || i.title;

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}

// ---------------------------------------------------------------------------------------------
// Payload encryption (TDD §7.7)

async function dataKey(): Promise<CryptoKey> {
  const existing = await kvGet<CryptoKey>('dataKey');
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await kvSet('dataKey', key);
  return key;
}

export async function seal(value: unknown): Promise<{ iv: Uint8Array; data: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dataKey(), new TextEncoder().encode(JSON.stringify(value)));
  return { iv, data };
}

export async function open<T>(sealed: { iv: Uint8Array; data: ArrayBuffer }): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv as BufferSource }, await dataKey(), sealed.data);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

/** Wipe everything (device revoked, NFR-OFF-02). */
export async function wipe(): Promise<void> {
  await db.delete();
  await db.open();
}
