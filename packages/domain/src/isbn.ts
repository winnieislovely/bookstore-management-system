/**
 * ISBN handling (TDD §4.1): `isbn13` is normalised and checksum-validated; ISBN-10 is converted on
 * entry. ISBN is a separate field from SKU and is never used as one (FR-CAT-11, FR-PUR-14).
 */

function isbn13CheckDigit(first12: string): number {
  let total = 0;
  for (let i = 0; i < 12; i++) total += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (total % 10)) % 10;
}

function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const ch = s[i]!;
    const v = ch === 'X' ? 10 : Number(ch);
    total += v * (10 - i);
  }
  return total % 11 === 0;
}

/** Strip hyphens/spaces and upper-case the ISBN-10 check character. */
export function cleanIsbn(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Normalise an ISBN-10 or ISBN-13 to a valid 13-digit string, or return null when the input is
 * not a valid ISBN.
 */
export function normalizeIsbn(input: string): string | null {
  const s = cleanIsbn(input);
  if (s.length === 13) {
    if (!/^\d{13}$/.test(s)) return null;
    return isbn13CheckDigit(s.slice(0, 12)) === Number(s[12]) ? s : null;
  }
  if (s.length === 10) {
    if (!isValidIsbn10(s)) return null;
    const first12 = `978${s.slice(0, 9)}`;
    return `${first12}${isbn13CheckDigit(first12)}`;
  }
  return null;
}

export function isValidIsbn(input: string): boolean {
  return normalizeIsbn(input) !== null;
}

/** Complete a 12-digit body into an EAN-13 (same check digit as ISBN-13). */
export function makeEan13(first12: string): string {
  if (!/^\d{12}$/.test(first12)) throw new RangeError('EAN-13 body must be 12 digits');
  return `${first12}${isbn13CheckDigit(first12)}`;
}

/** Internal barcode for items without one (FR-CAT-04): in-store EAN-13 range "20", then a 10-digit serial. */
export function internalBarcode(serial: number): string {
  if (!Number.isSafeInteger(serial) || serial < 1 || serial > 9_999_999_999) throw new RangeError('Serial out of range');
  return makeEan13(`20${String(serial).padStart(10, '0')}`);
}
