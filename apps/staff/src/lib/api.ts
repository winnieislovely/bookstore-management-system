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
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
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
