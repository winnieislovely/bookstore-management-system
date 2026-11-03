import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ChevronDown, ListFilter, Search, ShieldCheck, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useSearchParams } from 'react-router';
import { create } from 'zustand';
import { Dialog } from '../pos/widgets';
import { ApiError, post } from '../lib/api';
import { formatDate, formatNumber } from '../lib/format';
import { t } from '../lib/i18n';
import { Button, EmptyState, ErrorState, Field, InlineAlert, Skeleton } from './ui';

/** Building blocks for back-office list, detail and form pages (Design §10.6, §12.1–12.4). */

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** One URL search param as state, so filters survive reload and back (Design §12.1). */
export function useParam(key: string, fallback = ''): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  // Start from the live URL, not this render's params, so several setters in one event (e.g. “Xóa bộ lọc”) all apply.
  const set = (v: string) => {
    const next = new URLSearchParams(window.location.search);
    if (v && v !== fallback) next.set(key, v);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  return [value, set];
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  const debounced = useDebounced(text);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative w-full max-w-xl">
      <Search size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />
      <input
        className="h-10 w-full rounded-md border border-paper-500 bg-white pr-10 pl-10 text-sm placeholder:text-ink-500 focus:border-navy-700 max-sm:text-base"
        placeholder={placeholder}
        aria-label={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {text && (
        <button type="button" className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-navy-50" aria-label={t('common.clearFilters')} onClick={() => setText('')}>
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** A filter field in the “Bộ lọc” popover: multi-select with checkboxes, or custom content (e.g. a time range). */
export type FilterGroup =
  | { kind?: 'multi'; label: string; options: { key: string; label: string; count?: number }[]; values: string[]; onChange: (values: string[]) => void }
  | { kind: 'single'; label: string; options: { key: string; label: string }[]; value: string; onChange: (value: string) => void }
  | { kind: 'custom'; label: string; summary: string; active: boolean; onClear: () => void; content: ReactNode };

const groupActive = (g: FilterGroup) => (g.kind === 'custom' ? g.active : g.kind === 'single' ? !!g.value : g.values.length > 0);
const groupSummary = (g: FilterGroup) => {
  if (g.kind === 'custom') return g.summary;
  if (g.kind === 'single') return g.options.find((o) => o.key === g.value)?.label ?? t('common.all');
  if (!g.values.length) return t('common.all');
  const labels = g.options.filter((o) => g.values.includes(o.key)).map((o) => o.label);
  return labels.length <= 2 ? labels.join(', ') : t('common.selectedCount', { n: String(labels.length) });
};

/** “Bộ lọc” pill beside the search box; each field is a dropdown, multi-select fields have checkboxes (Design §10.9, §12.1). */
export function FilterMenu({ groups }: { groups: FilterGroup[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const active = groups.filter(groupActive).length;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={active ? `${t('common.filters')} (${active})` : t('common.filters')}
        onClick={() => setOpen(!open)}
        className={clsx('inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium max-sm:px-3', active ? 'border-navy-700 bg-navy-50 text-navy-700' : 'border-paper-500 bg-white text-ink-900 hover:bg-navy-50')}
      >
        <ListFilter size={18} aria-hidden />
        <span className="max-sm:sr-only">{t('common.filter')}</span>
        {active > 0 && <span className="inline-flex size-5 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-white num">{active}</span>}
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label={t('common.filters')} className="absolute right-0 z-30 mt-2 w-[300px] max-w-[calc(100vw-2rem)] rounded-lg border border-paper-300 bg-white p-2 shadow-md">
          <div className="divide-y divide-paper-300">
            {groups.map((g) => {
              const isOpen = expanded === g.label;
              const bodyId = `${panelId}-${g.label}`;
              return (
                <div key={g.label}>
                  <button type="button" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => setExpanded(isOpen ? null : g.label)} className="flex h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-navy-50">
                    <span className="font-medium text-ink-900">{g.label}</span>
                    <span className={clsx('ml-auto max-w-[55%] truncate', groupActive(g) ? 'font-medium text-navy-700' : 'text-ink-500')}>{groupSummary(g)}</span>
                    <ChevronDown size={16} className={clsx('shrink-0 text-ink-500 transition-transform', isOpen && 'rotate-180')} aria-hidden />
                  </button>
                  {isOpen && (
                    <div id={bodyId} className="px-1 pb-2">
                      {g.kind === 'custom' ? (
                        g.content
                      ) : g.kind === 'single' ? (
                        <ul role="radiogroup" aria-label={g.label}>
                          {[{ key: '', label: t('common.all') }, ...g.options].map((o) => (
                            <li key={o.key}>
                              <label className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-navy-50">
                                <input type="radio" className="size-[18px] shrink-0 accent-navy-700" checked={g.value === o.key} onChange={() => g.onChange(o.key)} />
                                <span className="flex-1">{o.label}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <ul>
                          {g.options.map((o) => {
                            const checked = g.values.includes(o.key);
                            return (
                              <li key={o.key}>
                                <label className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-navy-50">
                                  <input
                                    type="checkbox"
                                    className="size-[18px] shrink-0 accent-navy-700"
                                    checked={checked}
                                    onChange={() => g.onChange(checked ? g.values.filter((v) => v !== o.key) : [...g.values, o.key])}
                                  />
                                  <span className="flex-1">{o.label}</span>
                                  {o.count !== undefined && <span className="text-ink-500 num">{formatNumber(o.count)}</span>}
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1 border-t border-paper-300 pt-2">
            <Button variant="ghost" size="sm" full disabled={!active} onClick={() => groups.forEach((g) => (g.kind === 'custom' ? g.active && g.onClear() : g.kind === 'single' ? g.value && g.onChange('') : g.values.length && g.onChange([])))}>
              {t('common.clearFilters')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Comma-separated URL param as a list (multi-select filters). */
export function useListParam(key: string): [string[], (v: string[]) => void] {
  const [raw, set] = useParam(key);
  return [raw ? raw.split(',') : [], (v) => set(v.join(','))];
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

/** Pinned first column: opaque, above scrolled cells, with a right edge (Design §10.6 “Horizontal scroll”). */
const PINNED = 'sticky left-0 z-[1] shadow-[inset_-1px_0_0_var(--color-paper-300)]';

/** Table card (Design §10.6): sticky header, whole row clickable, skeleton rows, empty state inside. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRow,
  error,
  onRetry,
  empty,
  minWidth = 720,
  selection,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  onRow?: ((row: T) => void) | undefined;
  error?: unknown;
  onRetry?: () => void;
  empty: { icon: LucideIcon; title: string; help?: string; actions?: ReactNode };
  minWidth?: number;
  /** Checkbox column for bulk actions (Design §10.6): selected keys and setter. */
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void };
}) {
  const keys = rows?.map(rowKey) ?? [];
  const allOn = !!selection && keys.length > 0 && keys.every((k) => selection.selected.has(k));
  const someOn = !!selection && keys.some((k) => selection.selected.has(k));
  const toggle = (k: string) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    selection.onChange(next);
  };
  const toggleAll = () => {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const k of keys) {
      if (allOn) next.delete(k);
      else next.add(k);
    }
    selection.onChange(next);
  };
  // With a checkbox column, it is pinned first and the code column right after it.
  const pinFirst = selection ? PINNED.replace('left-0', 'left-12') : PINNED;
  // Exactly 48 px (3rem) wide so the code column pinned at left-12 meets it with no see-through gap.
  const checkCell = 'sticky left-0 z-[1] w-12 min-w-12 max-w-12 px-0 text-center';
  return (
    <div className="overflow-hidden rounded-lg border border-paper-300 bg-white">
      {error ? (
        <ErrorState error={error} {...(onRetry && { onRetry })} />
      ) : rows && rows.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth }}>
            <thead className="sticky top-0 bg-paper-200 text-[13px] font-semibold text-ink-700">
              <tr className="h-11">
                {selection && (
                  <th scope="col" className={clsx(checkCell, 'bg-paper-200')}>
                    <input
                      type="checkbox"
                      className="size-[18px] accent-navy-700"
                      aria-label={t('common.selectAll')}
                      checked={allOn}
                      ref={(el) => {
                        if (el) el.indeterminate = someOn && !allOn;
                      }}
                      onChange={toggleAll}
                    />
                  </th>
                )}
                {columns.map((c, i) => (
                  <th key={i} scope="col" className={clsx('px-4 whitespace-nowrap', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left', i === 0 && pinFirst + ' bg-paper-200', c.className)}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-300">
              {rows
                ? rows.map((r) => (
                    <tr key={rowKey(r)} className={clsx('group h-[52px] hover:bg-navy-50', onRow && 'cursor-pointer')} onClick={onRow ? () => onRow(r) : undefined}>
                      {selection && (
                        <td className={clsx(checkCell, 'bg-white group-hover:bg-navy-50')} onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="size-[18px] accent-navy-700" aria-label={t('common.selectRow')} checked={selection.selected.has(rowKey(r))} onChange={() => toggle(rowKey(r))} />
                        </td>
                      )}
                      {columns.map((c, i) => (
                        <td
                          key={i}
                          className={clsx('px-4 py-2', c.align === 'right' && 'text-right num whitespace-nowrap', c.align === 'center' && 'text-center', i === 0 && pinFirst + ' whitespace-nowrap bg-white group-hover:bg-navy-50', c.className)}
                        >
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))
                : Array.from({ length: 8 }, (_, i) => (
                    <tr key={i} className="h-[52px]">
                      <td colSpan={columns.length + (selection ? 1 : 0)} className="px-4">
                        <Skeleton className="h-6" />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Page-number pager for lists without a total; `hasMore` when a full page came back. */
export function Pager({ page, hasMore, onPage, total, limit = 40 }: { page: number; hasMore: boolean; onPage: (p: number) => void; total?: number; limit?: number }) {
  if (page === 1 && !hasMore) return null;
  const from = (page - 1) * limit + 1;
  return (
    <nav className="mt-4 flex items-center justify-end gap-2 text-sm" aria-label="Phân trang">
      <span className="text-ink-700 num">{total !== undefined ? t('common.pageOf', { from: formatNumber(from), to: formatNumber(Math.min(page * limit, total)), total: formatNumber(total) }) : `Trang ${page}`}</span>
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('common.prev')}>
        ‹
      </Button>
      <Button size="sm" variant="ghost" disabled={!hasMore} onClick={() => onPage(page + 1)} aria-label={t('common.next')}>
        ›
      </Button>
    </nav>
  );
}

export function SelectField({ label, children, className, required, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-700">
        {label}
        {required && <span className="text-danger-700"> *</span>}
      </label>
      <select id={id} required={required} className="h-10 rounded-md border border-paper-500 bg-white px-3 text-sm focus:border-navy-700 pointer-coarse:h-11 max-sm:text-base" {...rest}>
        {children}
      </select>
    </div>
  );
}

export function TextArea({ label, className, required, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const id = useId();
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-700">
        {label}
        {required && <span className="text-danger-700"> *</span>}
      </label>
      <textarea id={id} required={required} rows={3} className="rounded-md border border-paper-500 bg-white px-3 py-2 text-sm focus:border-navy-700 max-sm:text-base" {...rest} />
    </div>
  );
}

export function Tabs<K extends string>({ tabs, value, onChange }: { tabs: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void }) {
  return (
    <div className="mb-4 flex gap-4 overflow-x-auto border-b border-paper-300" role="tablist">
      {tabs.map((tb) => (
        <button
          key={tb.key}
          type="button"
          role="tab"
          aria-selected={value === tb.key}
          onClick={() => onChange(tb.key)}
          className={clsx('h-11 shrink-0 border-b-2 px-1 text-sm font-medium', value === tb.key ? 'border-navy-700 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-900')}
        >
          {tb.label}
          {tb.count !== undefined && <span className="num"> ({formatNumber(tb.count)})</span>}
        </button>
      ))}
    </div>
  );
}

/** Label/value list for detail side cards. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-500">{k}</dt>
          <dd className="text-right text-ink-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------------------------
// Toasts (Design §10.10)

interface Toast {
  id: number;
  tone: 'success' | 'danger' | 'info';
  text: string;
}
const useToasts = create<{ items: Toast[]; push: (t: Omit<Toast, 'id'>) => void; drop: (id: number) => void }>((set) => ({
  items: [],
  push: (x) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items, { ...x, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), 5000);
  },
  drop: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export const toast = {
  success: (text: string) => useToasts.getState().push({ tone: 'success', text }),
  error: (text: string) => useToasts.getState().push({ tone: 'danger', text }),
};

export function Toaster() {
  const { items, drop } = useToasts();
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(400px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      {items.map((i) => (
        <div key={i.id} className="pointer-events-auto rounded-lg bg-white shadow-lg" onClick={() => drop(i.id)}>
          <InlineAlert tone={i.tone}>{i.text}</InlineAlert>
        </div>
      ))}
    </div>
  );
}

/** Mutation with toast feedback and cache invalidation. */
export function useAction<I, O>(fn: (input: I) => Promise<O>, opts: { success?: string; invalidate?: QueryKey[]; onDone?: (o: O) => void } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (o) => {
      if (opts.success) toast.success(opts.success);
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: k });
      opts.onDone?.(o);
    },
  });
}

export function ConfirmDialog({
  title,
  body,
  confirm,
  destructive,
  onConfirm,
  onClose,
  children,
  size = 'sm',
}: {
  title: string;
  body?: string;
  confirm: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
  children?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title={title}
      size={size}
      plain
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                setError(errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {body && <p className="text-ink-700">{body}</p>}
        {children}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

/**
 * Supervisor approval in the back office (FR-ADM-09): a manager types their username and PIN on
 * this screen; the single-use token is bound to the action and record.
 */
export function ApprovalPrompt({ action, subject, reason, onToken, onClose }: { action: string; subject: string; reason: string; onToken: (token: string) => void; onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Cần quản lý duyệt"
      size="sm"
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={!username || pin.length < 4}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await post<{ approvalToken: string }>('/api/v1/auth/approve', { approverUsername: username.trim(), pin, action, subject });
              onToken(r.approvalToken);
            } catch (e) {
              setError(e instanceof ApiError ? e.message : errText(e));
              setPin('');
            } finally {
              setBusy(false);
            }
          }}
        >
          Duyệt
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-navy-100 text-navy-700">
            <ShieldCheck size={20} aria-hidden />
          </span>
          <p className="text-ink-700">{reason}</p>
        </div>
        <Field label="Tên đăng nhập quản lý" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Field label="Mã PIN" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Time filter for lists (Design §12.1): one URL param `time` = preset key or `YYYY-MM-DD..YYYY-MM-DD`; store-day bounds.

// Tất cả, 7 ngày qua, 30 ngày qua, Tùy chọn only (Design §10.9).
const TIME_PRESETS = [
  { key: '7d', label: '7 ngày qua' },
  { key: '30d', label: '30 ngày qua' },
] as const;
const storeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dayStart = (day: string) => new Date(`${day}T00:00:00+07:00`).toISOString();
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999+07:00`).toISOString();

export function timeDays(time: string): [string, string] | null {
  const today = storeToday();
  if (time === '7d') return [addDays(today, -6), today];
  if (time === '30d') return [addDays(today, -29), today];
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(time);
  return m ? [m[1]!, m[2]!] : null;
}
export function timeRange(time: string): { from?: string; to?: string } {
  const d = timeDays(time);
  return d ? { from: dayStart(d[0]), to: dayEnd(d[1]) } : {};
}
export function timeLabel(time: string): string {
  const preset = TIME_PRESETS.find((p) => p.key === time);
  if (preset) return preset.label;
  const d = timeDays(time);
  return d ? `${formatDate(d[0])} – ${formatDate(d[1])}` : 'Tất cả';
}

/** `allowAll={false}` drops “Tất cả” for screens that always need a range (reports). */
export function TimeFilter({ value, onChange, allowAll = true }: { value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  const custom = !!value && !TIME_PRESETS.some((p) => p.key === value);
  const [showCustom, setShowCustom] = useState(custom);
  const days = custom ? timeDays(value) : null;
  const [from, setFrom] = useState(days?.[0] ?? '');
  const [to, setTo] = useState(days?.[1] ?? '');
  const radio = 'size-[18px] shrink-0 accent-navy-700';
  const row = 'flex h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-navy-50';
  return (
    <div role="radiogroup" aria-label="Thời gian">
      {allowAll && (
        <label className={row}>
          <input type="radio" className={radio} checked={!value && !showCustom} onChange={() => { setShowCustom(false); onChange(''); }} />
          Tất cả
        </label>
      )}
      {TIME_PRESETS.map((p) => (
        <label key={p.key} className={row}>
          <input type="radio" className={radio} checked={value === p.key && !showCustom} onChange={() => { setShowCustom(false); onChange(p.key); }} />
          {p.label}
        </label>
      ))}
      <label className={row}>
        <input type="radio" className={radio} checked={showCustom} onChange={() => setShowCustom(true)} />
        Tùy chọn
      </label>
      {showCustom && (
        <div className="flex flex-col gap-2 px-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-ink-700">
              Từ ngày
              <input type="date" className="h-10 w-full rounded-md border border-paper-500 bg-white px-2 text-sm max-sm:text-base" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-700">
              Đến ngày
              <input type="date" className="h-10 w-full rounded-md border border-paper-500 bg-white px-2 text-sm max-sm:text-base" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <Button variant="primary" size="sm" full disabled={!from || !to || to < from} onClick={() => onChange(`${from}..${to}`)}>
            Áp dụng
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Bulk bar under the search/filter row (Design §10.6): count with an expand toggle, the bulk
 * actions, “Bỏ chọn tất cả”; expanded, the selected rows (3 visible, the rest scroll), each with X.
 */
export function SelectionBar({ items, actions, onRemove, onClear }: { items: { key: string; label: string; code?: string }[]; actions: ReactNode; onRemove: (key: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <div className="mb-4 rounded-lg bg-navy-50 px-4 py-2 text-sm" role="region" aria-label="Thao tác hàng loạt">
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)} className="-ml-2 inline-flex h-10 items-center gap-1 rounded-full px-2 font-medium text-navy-700 hover:bg-navy-100">
          <ChevronDown size={18} className={clsx('transition-transform', open && 'rotate-180')} aria-hidden />
          <span className="num">Đã chọn {formatNumber(items.length)} sản phẩm</span>
        </button>
        {actions}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
          Bỏ chọn tất cả
        </Button>
      </div>
      {open && (
        <ul id={listId} className="mt-2 mb-1 max-h-[132px] divide-y divide-paper-300 overflow-y-auto rounded-md border border-paper-300 bg-white">
          {items.map((i) => (
            <li key={i.key} className="flex h-11 items-center gap-3 pr-1 pl-3">
              <span className="min-w-0 flex-1 truncate">{i.label}</span>
              {i.code && <span className="code shrink-0 text-[13px] text-ink-500">{i.code}</span>}
              <button type="button" className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-ink-500 hover:bg-navy-50" aria-label={`Bỏ chọn ${i.label}`} onClick={() => onRemove(i.key)}>
                <X size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
