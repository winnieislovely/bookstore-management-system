import { ApiError, post } from '../lib/api';
import { kvGet, kvSet, wipe } from './db';

/**
 * Device identity (TDD §7.2): an ECDSA P-256 key pair made with Web Crypto; the private key is
 * non-extractable and never leaves the browser. A manager registers the device once with its
 * public key; every `/pos/v1/*` request is signed over METHOD\nPATH\nTIMESTAMP\nSHA-256(body).
 */

export interface DeviceInfo {
  id: string;
  deviceCode: string;
  registerId: string;
}

async function keyPair(): Promise<CryptoKeyPair> {
  const existing = await kvGet<CryptoKeyPair>('deviceKeys');
  if (existing) return existing;
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as CryptoKeyPair;
  await kvSet('deviceKeys', pair);
  return pair;
}

export async function deviceInfo(): Promise<DeviceInfo | null> {
  return (await kvGet<DeviceInfo>('device')) ?? null;
}

function toBase64(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Register this browser as a POS device (needs `pos.offline.manage`); the server assigns the device code (TDD §7.2). */
export async function registerDevice(registerId: string): Promise<DeviceInfo> {
  const pair = await keyPair();
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const r = await post<{ id: string; deviceCode: string }>('/api/v1/pos/devices', { registerId, publicKey: toBase64(spki) });
  const info = { id: r.id, deviceCode: r.deviceCode, registerId };
  await kvSet('device', info);
  return info;
}

/** Signed request to the device endpoints; a revoked device wipes its local data (NFR-OFF-02). */
export async function deviceFetch<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const info = await deviceInfo();
  if (!info) throw new ApiError(401, 'device_unknown', 'Thiết bị chưa được đăng ký.');
  const raw = body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body));
  const timestamp = new Date().toISOString();
  const hash = toHex(await crypto.subtle.digest('SHA-256', raw));
  const message = new TextEncoder().encode(`${method}\n${path}\n${timestamp}\n${hash}`);
  const signature = toBase64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, (await keyPair()).privateKey, message));
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        'x-device-code': info.deviceCode,
        'x-device-timestamp': timestamp,
        'x-device-signature': signature,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: raw }),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Không kết nối được máy chủ.');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; details?: unknown } } | undefined)?.error;
    if (e?.code === 'device_revoked') {
      await wipe();
      window.location.reload();
    }
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `HTTP ${res.status}`, e?.details);
  }
  return data as T;
}
