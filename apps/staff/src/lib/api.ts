import { t } from './i18n';

/**
 * Staff API client (TDD §6.1): same-origin requests with the session cookie and the custom CSRF
 * header on every call; errors come back as the typed envelope and are thrown as `ApiError`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** A response body that may be empty or not JSON (a reverse proxy's error page). */
export function parseBody(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The reverse proxy answers 502/503 without our error envelope while the API process is down or
 * restarting: the server never saw the request, so it counts as no network (the POS then sells
 * offline, FR-POS-23). A 504 is left out, since the server may have handled the request.
 */
export function proxyUnreachable(status: number, data: unknown): boolean {
  return (status === 502 || status === 503) && !(data as { error?: unknown } | undefined)?.error;
}

export async function api<T>(method: string, path: string, opts: { body?: unknown; query?: Query; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withQuery(path, opts.query), {
      method,
      credentials: 'same-origin',
      headers: {
        'x-bms-request': '1',
        ...(opts.body !== undefined && { 'content-type': 'application/json' }),
        ...opts.headers,
      },
      ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
    });
  } catch {
    throw new ApiError(0, 'network_error', t('error.network'));
  }
  if (res.status === 204) return undefined as T;
  const data = parseBody(await res.text());
  if (proxyUnreachable(res.status, data)) throw new ApiError(0, 'network_error', t('error.network'));
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; details?: unknown; requestId?: string } } | undefined)?.error;
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `HTTP ${res.status}`, e?.details, e?.requestId);
  }
  return data as T;
}

export const get = <T>(path: string, query?: Query) => api<T>('GET', path, { ...(query && { query }) });
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, { ...(body !== undefined && { body }) });
export const put = <T>(path: string, body?: unknown) => api<T>('PUT', path, { ...(body !== undefined && { body }) });
export const patch = <T>(path: string, body?: unknown) => api<T>('PATCH', path, { ...(body !== undefined && { body }) });
export const del = <T>(path: string) => api<T>('DELETE', path);

/** Upload a file as the raw body (images, imports); returns the stored file id. */
export async function upload(file: File, purpose: 'image' | 'import'): Promise<{ id: string }> {
  let res: Response;
  try {
    res = await fetch(withQuery('/api/v1/files', { purpose }), { method: 'POST', credentials: 'same-origin', headers: { 'x-bms-request': '1', 'content-type': file.type || 'application/octet-stream' }, body: file });
  } catch {
    throw new ApiError(0, 'network_error', t('error.network'));
  }
  const data = (parseBody(await res.text()) ?? {}) as { id: string; error?: { code: string; message: string; details?: unknown; requestId?: string } };
  if (proxyUnreachable(res.status, data)) throw new ApiError(0, 'network_error', t('error.network'));
  if (!res.ok) throw new ApiError(res.status, data.error?.code ?? 'http_error', data.error?.message ?? `HTTP ${res.status}`, data.error?.details, data.error?.requestId);
  return data;
}
