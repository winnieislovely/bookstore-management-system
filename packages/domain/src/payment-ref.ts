/**
 * Bank-transfer payment references (FR-POS-06, FR-ORD-08, TDD §8.4). The store pays in through its
 * printed QR code; the system generates no QR. It issues a short reference that the customer types
 * in the transfer note and that staff check, together with the amount, before confirming receipt.
 *
 * The alphabet leaves out 0/O and 1/I/L so the code is easy to read aloud and type.
 */
export const PAYMENT_REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const PAYMENT_REF_LENGTH = 8;

/** Build a reference from random bytes (inject `crypto.getRandomValues` output; keeps this pure). */
export function paymentRefFromBytes(bytes: Uint8Array): string {
  if (bytes.length < PAYMENT_REF_LENGTH) throw new RangeError(`Need ${PAYMENT_REF_LENGTH} random bytes`);
  let ref = '';
  for (let i = 0; i < PAYMENT_REF_LENGTH; i++) ref += PAYMENT_REF_ALPHABET[bytes[i]! % PAYMENT_REF_ALPHABET.length];
  return ref;
}

/**
 * Normalise what a customer typed or what the bank statement shows, so staff can compare:
 * upper case, spaces and separators removed.
 */
export function normalizePaymentRef(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/** True when a transfer note contains the reference, even with extra words around it. */
export function transferNoteMatches(note: string, ref: string): boolean {
  return normalizePaymentRef(note).includes(normalizePaymentRef(ref));
}
