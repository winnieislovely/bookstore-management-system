import { formatPhone, formatVnd } from '@bookstore/domain';

/** Formatting through one shared helper (Design §14.3): vi-VN, Asia/Ho_Chi_Minh. */
export { formatPhone, formatVnd };

const TZ = 'Asia/Ho_Chi_Minh';
const dateFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const numFmt = new Intl.NumberFormat('vi-VN');

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  return dateFmt.format(new Date(d));
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = new Date(d);
  return `${dateFmt.format(date)} ${timeFmt.format(date)}`;
}

export function formatNumber(n: number): string {
  return numFmt.format(n);
}

/** Compact money for KPI and charts: `12,5 tr ₫`, `1,2 tỷ ₫`. */
export function formatVndCompact(n: number): string {
  const abs = Math.abs(n);
  const one = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });
  if (abs >= 1e9) return `${one.format(n / 1e9)} tỷ ₫`;
  if (abs >= 1e6) return `${one.format(n / 1e6)} tr ₫`;
  return formatVnd(n);
}

/** Relative time within 7 days (“5 phút trước”, “Hôm qua 14:20”), else the date. */
export function formatRelative(d: Date | string, now = new Date()): string {
  const date = new Date(d);
  const mins = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.round(mins / 60);
  if (hours < 24 && dateFmt.format(now) === dateFmt.format(date)) return `${hours} giờ trước`;
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dateFmt.format(yesterday) === dateFmt.format(date)) return `Hôm qua ${timeFmt.format(date)}`;
  if (mins < 7 * 24 * 60) return formatDateTime(date);
  return formatDate(date);
}

/** Store-time date as `YYYY-MM-DD` for report filters. */
export function storeToday(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}
