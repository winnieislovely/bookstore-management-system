import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Check, Search, ShieldCheck, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useSearchParams } from 'react-router';
import { create } from 'zustand';
import { Dialog } from '../pos/widgets';
import { ApiError, post } from '../lib/api';
import { formatNumber } from '../lib/format';
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
  const set = (v: string) => {
    const next = new URLSearchParams(params);
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

export function FilterChips<K extends string>({ options, value, onChange, counts }: { options: { key: K; label: string }[]; value: K | ''; onChange: (k: K | '') => void; counts?: Partial<Record<K, number>> }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('common.filters')}>
      {options.map((o) => {
        const selected = value === o.key;
        const n = counts?.[o.key];
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(selected ? '' : o.key)}
            className={clsx('inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm', selected ? 'border-navy-700 bg-navy-100 text-navy-700' : 'border-paper-500 bg-white text-ink-700 hover:bg-navy-50')}
          >
            {selected && <Check size={16} aria-hidden />}
            {o.label}
            {n !== undefined && <span className="num">({formatNumber(n)})</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

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
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  onRow?: ((row: T) => void) | undefined;
  error?: unknown;
  onRetry?: () => void;
  empty: { icon: LucideIcon; title: string; help?: string; actions?: ReactNode };
  minWidth?: number;
}) {
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
                {columns.map((c, i) => (
                  <th key={i} scope="col" className={clsx('px-4', c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left', i === 0 && 'sticky left-0 bg-paper-200', c.className)}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-300">
              {rows
                ? rows.map((r) => (
                    <tr key={rowKey(r)} className={clsx('h-[52px] hover:bg-navy-50', onRow && 'cursor-pointer')} onClick={onRow ? () => onRow(r) : undefined}>
                      {columns.map((c, i) => (
                        <td key={i} className={clsx('px-4 py-2', c.align === 'right' && 'text-right num', c.align === 'center' && 'text-center', i === 0 && 'sticky left-0 bg-inherit', c.className)}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))
                : Array.from({ length: 8 }, (_, i) => (
                    <tr key={i} className="h-[52px]">
                      <td colSpan={columns.length} className="px-4">
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
      <select id={id} required={required} className="h-10 rounded-md border border-paper-500 bg-white px-3 text-sm focus:border-navy-700 pointer-coarse:h-12 max-sm:text-base" {...rest}>
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
}: {
  title: string;
  body?: string;
  confirm: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title={title}
      size="sm"
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
