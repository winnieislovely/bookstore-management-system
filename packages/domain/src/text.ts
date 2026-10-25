/**
 * Search ignores Vietnamese diacritics and case (SRS §2.5): "nguyen" finds "Nguyễn".
 * The database uses `lower(unaccent(...))`; this is the same rule for in-memory search
 * (offline POS cache) and for building slugs.
 */
export function foldText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

/** URL slug from text, without diacritics (Design §10.3 slug input). */
export function slugify(input: string): string {
  return foldText(input)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Group a code in blocks of 4 for reading aloud and hand-writing (Design §5.1, §10.13). */
export function groupCode(code: string, size = 4): string {
  const compact = code.replace(/\s+/g, '');
  const parts: string[] = [];
  for (let i = 0; i < compact.length; i += size) parts.push(compact.slice(i, i + size));
  return parts.join(' ');
}
