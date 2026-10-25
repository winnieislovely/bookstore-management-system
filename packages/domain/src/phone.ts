/**
 * Customer phone numbers are the unique key (FR-CRM-01, BR-16), stored normalised as E.164
 * (TDD §4.9). Vietnamese numbers: 0912345678 / 84912345678 / +84 912 345 678 → +84912345678.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits === '') return null;
  let national: string;
  if (hasPlus) {
    if (!digits.startsWith('84')) {
      // Foreign number: keep as given if plausible E.164 length.
      return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
    }
    national = digits.slice(2);
  } else if (digits.startsWith('84') && digits.length === 11) {
    national = digits.slice(2);
  } else if (digits.startsWith('0')) {
    national = digits.slice(1);
  } else {
    national = digits;
  }
  // Vietnamese mobile and landline national numbers have 9 or 10 digits after the trunk 0.
  if (!/^[1-9]\d{8,9}$/.test(national)) return null;
  return `+84${national}`;
}

/** Display as `0912 345 678` (Design §14.3). */
export function formatPhone(e164: string): string {
  if (!e164.startsWith('+84')) return e164;
  const local = `0${e164.slice(3)}`;
  if (local.length === 10) return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  return local;
}
