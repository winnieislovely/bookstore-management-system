import vi from '../i18n/vi.json';

/** All UI text is externalised in `vi.json` (NFR-USE-03, Design §14.4). */
export type MessageKey = keyof typeof vi;

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s: string = vi[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
