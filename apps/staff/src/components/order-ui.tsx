import { foldText } from '@bookstore/domain';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArchiveRestore,
  Check,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Copy,
  Package,
  RotateCcw,
  Truck,
  Undo2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '../lib/format';
import { Button, StatusChip, type Tone } from './ui';

/** Order statuses, payment and sources as staff read them (Design §11.2, FR-ORD-01). */

export const ORDER_STATUS: Record<string, { label: string; tone: Tone; icon: LucideIcon }> = {
  new: { label: 'Mới', tone: 'info', icon: CircleDot },
  pending_review: { label: 'Cần xem xét', tone: 'warning', icon: AlertTriangle },
  confirmed: { label: 'Đã xác nhận', tone: 'brand', icon: CheckCircle },
  packing: { label: 'Đang đóng gói', tone: 'info', icon: Package },
  shipping: { label: 'Đang giao', tone: 'info', icon: Truck },
  done: { label: 'Hoàn tất', tone: 'success', icon: CheckCircle2 },
  return_requested: { label: 'Yêu cầu trả', tone: 'warning', icon: Undo2 },
  return_approved: { label: 'Đã duyệt trả', tone: 'info', icon: RotateCcw },
  returned: { label: 'Đã trả hàng', tone: 'neutral', icon: ArchiveRestore },
  cancelled: { label: 'Đã hủy', tone: 'neutral', icon: XCircle },
};

export const REVIEW_REASON: Record<string, string> = {
  out_of_stock: 'Thiếu hàng',
  incomplete_address: 'Thiếu địa chỉ',
  unpaid_transfer: 'Chưa nhận chuyển khoản',
  high_value: 'Đơn giá trị cao',
  suspected_abuse: 'Nghi ngờ bom hàng',
};

export const ORDER_SOURCE: Record<string, string> = {
  website: 'Website',
  facebook: 'Facebook',
  zalo: 'Zalo',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  marketplace: 'Sàn TMĐT',
  phone: 'Điện thoại',
  other: 'Khác',
};

export function OrderStatusChip({ status, reasons }: { status: string; reasons?: string[] }) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: 'neutral' as Tone, icon: CircleDot };
  // The review reason sits beside the chip (FR-ORD-04, Design §11.2).
  const shown = (reasons ?? []).filter((r) => status !== 'new' || r !== 'unpaid_transfer');
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusChip tone={s.tone} icon={s.icon}>
        {s.label}
      </StatusChip>
      {shown.length > 0 && <span className="text-[13px] text-warning-700">{shown.map((r) => REVIEW_REASON[r] ?? r).join(', ')}</span>}
    </span>
  );
}

/** Payment chip (Design §11.2 “Payment”): waiting states carry no time. */
export function PaymentChip({ method, paidAt, status }: { method: string; paidAt: string | null; status: string }) {
  if (method === 'cod') return paidAt ? <StatusChip tone="success">Đã thanh toán</StatusChip> : <StatusChip tone="info">Thu hộ</StatusChip>;
  if (paidAt) return <StatusChip tone="success">Đã thanh toán</StatusChip>;
  if (status === 'cancelled') return <StatusChip tone="neutral">Chưa thanh toán</StatusChip>;
  return (
    <StatusChip tone="warning" icon={AlertTriangle}>
      Chờ chuyển khoản
    </StatusChip>
  );
}

/** Copy-able code display (Design §10.13): code-xl grouped in 4s with a copy button. */
export function CopyCode({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const grouped = value.replace(/\s/g, '').replace(/(.{4})(?=.)/g, '$1 ');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-paper-300 bg-paper-200 p-4">
      <div className="min-w-0">
        <p className="text-sm text-ink-500">{label}</p>
        <p className="code text-[28px] leading-9 font-semibold break-all text-ink-900">{grouped}</p>
      </div>
      <Button
        variant="secondary"
        icon={copied ? Check : Copy}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <span aria-live="polite">{copied ? 'Đã sao chép' : 'Sao chép'}</span>
      </Button>
    </div>
  );
}

export interface TimelineEntry {
  id: string;
  toStatus: string;
  at: string;
  actor: string | null;
  reason: string | null;
}

const DOT: Record<Tone, string> = {
  neutral: 'bg-ink-500',
  brand: 'bg-navy-700',
  info: 'bg-info-700',
  success: 'bg-success-700',
  warning: 'bg-warning-700',
  danger: 'bg-danger-700',
  accent: 'bg-olive-700',
};

/** Status timeline, current status first (Design §10.14, FR-ORD-07). */
export function StatusTimeline({ events, reasonLabel }: { events: TimelineEntry[]; reasonLabel?: (reason: string) => string }) {
  return (
    <ol className="flex flex-col gap-4">
      {events.map((e) => {
        const s = ORDER_STATUS[e.toStatus];
        return (
          <li key={e.id} className="flex gap-3">
            <span className={clsx('mt-1.5 size-2.5 shrink-0 rounded-full', DOT[s?.tone ?? 'neutral'])} aria-hidden />
            <div className="text-sm">
              <p className="font-semibold text-ink-900">{s?.label ?? e.toStatus}</p>
              <p className="text-ink-500">
                {formatDateTime(e.at)}
                {e.actor && ` · ${e.actor}`}
              </p>
              {e.reason && <p className="text-ink-700">{reasonLabel ? reasonLabel(e.reason) : e.reason}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Searchable select that ignores diacritics (Design §10.3 province / ward). */
export function Combobox({
  label,
  options,
  value,
  onChange,
  disabled,
  placeholder,
  required,
}: {
  label: string;
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.key === value);
  const shown = useMemo(() => {
    const term = foldText(q);
    return term ? options.filter((o) => foldText(o.label).includes(term)) : options;
  }, [q, options]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div ref={box} className="relative flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-700">
        {label}
        {required && <span className="text-danger-700"> *</span>}
      </label>
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={disabled}
          className="h-10 w-full rounded-md border border-paper-500 bg-white pr-9 pl-3 text-sm focus:border-navy-700 disabled:bg-paper-100 disabled:text-ink-500"
          placeholder={placeholder}
          value={open ? q : (current?.label ?? '')}
          onFocus={() => {
            setQ('');
            setOpen(true);
          }}
          onChange={(e) => {
            // Typing after a choice starts a fresh search.
            setQ(open ? e.target.value : e.target.value.slice(current?.label.length ?? 0));
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown[0]) {
              e.preventDefault();
              onChange(shown[0].key);
              setQ('');
              setOpen(false);
            }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        <ChevronDown size={16} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-500" aria-hidden />
      </div>
      {open && !disabled && (
        <ul role="listbox" className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-paper-300 bg-white py-1 shadow-md">
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-ink-500">Không có kết quả.</li>}
          {shown.slice(0, 200).map((o) => (
            <li key={o.key} role="option" aria-selected={o.key === value}>
              <button
                type="button"
                className={clsx('w-full px-3 py-2 text-left text-sm hover:bg-navy-50', o.key === value && 'font-semibold text-navy-700')}
                onClick={() => {
                  onChange(o.key);
                  setQ('');
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
