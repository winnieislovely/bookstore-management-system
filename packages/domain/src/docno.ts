/**
 * Human document numbers (TDD §3.6, NFR-REL-02): gap-free counters per series and year online,
 * `{device_code}-{counter}` offline (TDD §7.4). Display formats follow Design §14.3.
 */
export const DOC_SERIES = {
  SALE: 'HD',
  SI: 'SI',
  RET: 'TH',
  ADJ: 'DC',
  CNT: 'KK',
  PO: 'PO',
  CST: 'KG',
  ORD: 'DH',
  PRE: 'DT',
  /** Library count (FR-LIB-04). */
  LCNT: 'KT',
  /** Library cash book receipt (FR-LIB-09a). */
  LIBP: 'PT',
} as const;
export type DocSeries = keyof typeof DOC_SERIES;

export function formatDocNo(series: DocSeries, year: number, n: number): string {
  return `${DOC_SERIES[series]}-${year}-${String(n).padStart(5, '0')}`;
}

export function formatOfflineSaleNo(deviceCode: string, counter: number): string {
  return `${deviceCode}-${String(counter).padStart(6, '0')}`;
}

/** Year of a moment in the store time zone (Asia/Ho_Chi_Minh, UTC+7, no DST). */
export function storeYear(at: Date): number {
  return new Date(at.getTime() + 7 * 3600_000).getUTCFullYear();
}
