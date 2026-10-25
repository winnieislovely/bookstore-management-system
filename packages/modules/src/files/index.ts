import { schema } from '@bookstore/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { AppError, errors, type Ctx } from '../platform/index.js';

/**
 * Files (TDD §4.12): metadata in `platform.file`, bytes behind `StorageAdapter` (local disk in
 * development, S3-compatible object storage in Vietnam in production, TDD §8.1).
 */
export interface StorageAdapter {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

export class LocalDiskStorage implements StorageAdapter {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }
  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.path(key));
    } catch {
      return null;
    }
  }
}

/** Type and size allow-list (TDD §4.12). */
export const FILE_RULES = {
  image: { mimes: ['image/jpeg', 'image/png', 'image/webp'], maxBytes: 10 * 1024 * 1024 },
  import: {
    mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'],
    maxBytes: 10 * 1024 * 1024,
  },
} as const;
export type FilePurpose = keyof typeof FILE_RULES;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/csv': 'csv',
};

/** Check the magic bytes too, so a renamed file cannot pass as an image. */
function sniff(bytes: Uint8Array, mime: string): boolean {
  const b = bytes;
  switch (mime) {
    case 'image/jpeg':
      return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/png':
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case 'image/webp':
      return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return b[0] === 0x50 && b[1] === 0x4b; // zip container
    default:
      return true;
  }
}

export async function upload(
  ctx: Ctx,
  storage: StorageAdapter,
  input: { bytes: Uint8Array; mime: string; purpose: FilePurpose; ownerType?: string; ownerId?: string },
): Promise<{ id: string; mime: string; size: number }> {
  if (!ctx.actor) throw errors.unauthenticated();
  const rule = FILE_RULES[input.purpose];
  const mime = input.mime.split(';')[0]!.trim().toLowerCase();
  if (!(rule.mimes as readonly string[]).includes(mime)) {
    throw new AppError(415, 'unsupported_file_type', input.purpose === 'image' ? 'Chỉ nhận ảnh JPEG, PNG hoặc WebP.' : 'Chỉ nhận tệp Excel (.xlsx) hoặc CSV.');
  }
  if (input.bytes.length === 0 || input.bytes.length > rule.maxBytes) {
    throw new AppError(400, 'file_too_large', `Tệp phải nhỏ hơn ${rule.maxBytes / 1024 / 1024} MB.`);
  }
  if (!sniff(input.bytes, mime)) throw new AppError(400, 'file_content_mismatch', 'Nội dung tệp không khớp với định dạng.');
  const now = ctx.clock.now();
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${EXT[mime]}`;
  await storage.put(key, input.bytes, mime);
  const [row] = await ctx.db
    .insert(schema.file)
    .values({ objectKey: key, mime, size: input.bytes.length, ownerType: input.ownerType ?? input.purpose, ownerId: input.ownerId ?? ctx.actor.userId, createdAt: now })
    .returning({ id: schema.file.id });
  return { id: row!.id, mime, size: input.bytes.length };
}

export async function read(ctx: Ctx, storage: StorageAdapter, id: string): Promise<{ mime: string; bytes: Uint8Array }> {
  if (!ctx.actor) throw errors.unauthenticated();
  const [f] = await ctx.db.select().from(schema.file).where(eq(schema.file.id, id));
  if (!f) throw errors.notFound('Tệp');
  const bytes = await storage.get(f.objectKey);
  if (!bytes) throw errors.notFound('Tệp');
  return { mime: f.mime, bytes };
}
