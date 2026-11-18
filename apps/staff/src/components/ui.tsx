import { clsx } from 'clsx';
import { AlertOctagon, AlertTriangle, ArrowLeft, CheckCircle2, Info, Loader2, Lock, type LucideIcon } from 'lucide-react';
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ApiError } from '../lib/api';
import { t } from '../lib/i18n';

/** Base components built to the Design Guide §10 specs, reading colours through tokens only. */

// ---------------------------------------------------------------------------------------------
// Buttons (§10.1): every button is a pill; one primary per view; olive accent only for commit.

export type ButtonVariant = 'primary' | 'accent' | 'tonal' | 'secondary' | 'ghost' | 'destructive' | 'destructive-outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-navy-700 text-white enabled:hover:bg-navy-800 enabled:active:bg-navy-900',
  accent: 'bg-olive-600 text-white enabled:hover:bg-olive-700',
  tonal: 'bg-navy-50 text-navy-700 enabled:hover:bg-navy-100',
  secondary: 'bg-white text-ink-900 border border-paper-500 enabled:hover:bg-navy-50',
  ghost: 'bg-transparent text-ink-700 enabled:hover:bg-navy-50',
  destructive: 'bg-danger-700 text-white enabled:hover:brightness-95',
  'destructive-outline': 'bg-white text-danger-700 border border-danger-700 enabled:hover:bg-danger-50',
};
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] font-medium gap-1.5',
  md: 'h-9 px-4 text-sm font-medium gap-2',
  lg: 'h-11 px-5 text-sm font-semibold gap-2',
  xl: 'h-13 px-6 text-lg font-semibold gap-2',
};
const ICON_SIZE: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20, xl: 20 };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  trailingIcon?: LucideIcon;
  loading?: boolean;
  full?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, trailingIcon: Trailing, loading, full, className, children, disabled, ...rest },
  ref,
) {
  const iconSize = ICON_SIZE[size];
  return (
    <button
      ref={ref}
      className={clsx(
        'inline-flex items-center justify-center rounded-full whitespace-nowrap transition-colors duration-[120ms] select-none touch-target',
        // Disabled keeps the variant's colours, faded; a loading button (aria-busy) is not faded (Design §10.1).
        'disabled:cursor-not-allowed disabled:not-aria-busy:opacity-40',
        VARIANT[variant],
        SIZE[size],
        full && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" aria-hidden /> : Icon && <Icon size={iconSize} aria-hidden />}
      {children}
      {Trailing && !loading && <Trailing size={iconSize} aria-hidden />}
    </button>
  );
});

// ---------------------------------------------------------------------------------------------
// Inputs (§10.2): label above, helper below, error replaces helper with an icon.

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Icon at the start of the field, e.g. `Search` for a lookup field (Design §10.3). */
  leadingIcon?: LucideIcon;
  label: ReactNode;
  helper?: string | undefined;
  error?: string | undefined;
  suffix?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, helper, error, required, suffix, leadingIcon: Leading, className, id, ...rest }, ref) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = `${inputId}-desc`;
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={inputId} className="text-[13px] font-medium text-ink-700">
        {label}
        {required && (
          <>
            <span className="text-danger-700" aria-hidden>
              {' '}*
            </span>
            <span className="sr-only"> {t('common.required')}</span>
          </>
        )}
      </label>
      <div className="relative">
        {Leading && <Leading size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={helper || error ? describedBy : undefined}
          className={clsx(
            'h-10 w-full rounded-md border bg-white px-3 text-sm text-ink-900 placeholder:text-ink-500 sm:text-sm max-sm:text-base pointer-coarse:h-11',
            'hover:border-ink-500 focus:border-navy-700 read-only:bg-paper-200 disabled:bg-paper-200 disabled:text-ink-300',
            error ? 'border-danger-700' : 'border-paper-500',
            suffix && 'pr-8 text-right num',
            Leading && 'pl-10',
          )}
          {...rest}
        />
        {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-500">{suffix}</span>}
      </div>
      {error ? (
        <p id={describedBy} className="flex items-center gap-1 text-[13px] text-danger-700">
          <AlertOctagon size={16} aria-hidden /> {error}
        </p>
      ) : (
        helper && (
          <p id={describedBy} className="text-[13px] text-ink-500">
            {helper}
          </p>
        )
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// Cards, chips, badges (§10.5, §10.7)

/** `headerNowrap` keeps the action on the title's row; the title is cut with an ellipsis instead. */
export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  headerNowrap,
}: {
  title?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  headerNowrap?: boolean;
}) {
  return (
    <section className={clsx('rounded-lg border border-paper-300 bg-white p-4 shadow-sm sm:p-6', className)}>
      {(title || action) && (
        <header className={clsx('mb-4 flex items-center justify-between gap-2', headerNowrap ? 'flex-nowrap' : 'flex-wrap')}>
          {title && (
            <div className={clsx(headerNowrap && 'min-w-0')}>
              <h2 className={clsx('text-base font-semibold text-ink-900', headerNowrap && 'truncate')}>{title}</h2>
              {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
            </div>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

const TONE: Record<Tone, string> = {
  neutral: 'bg-paper-200 text-ink-700',
  brand: 'bg-navy-100 text-navy-700',
  info: 'bg-info-50 text-info-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
  accent: 'bg-olive-100 text-olive-700',
};

/** Status chip (§10.5, §11): text always; an icon for states that need attention. */
export function StatusChip({ tone, icon: Icon, children }: { tone: Tone; icon?: LucideIcon | undefined; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-xs font-medium', TONE[tone])}>
      {Icon && <Icon size={14} aria-hidden />}
      {children}
    </span>
  );
}

export function CountBadge({ count, tone = 'default' }: { count: number; tone?: 'default' | 'sidebar' | 'attention' }) {
  if (count <= 0) return null;
  const cls = tone === 'sidebar' ? 'bg-sand-300 text-navy-900' : tone === 'attention' ? 'bg-danger-700 text-white' : 'bg-navy-700 text-white';
  return <span className={clsx('inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold num', cls)}>{count > 99 ? '99+' : count}</span>;
}

// ---------------------------------------------------------------------------------------------
// Page header, empty, error and loading states (§6.3, §10.12)

/** Where a page opened from another page goes back to (Design §6.3 page header). */
export interface BackTo {
  to: string;
  /** The page it goes back to, for the tooltip. */
  label: string;
}

/** Page header (Design §6.3, §12.3). `menu` is the overflow ⋯ button: on the title row on phones, last of the actions on sm+. */
/** `subtitle` is a short line under the title (e.g. a key figure). */
/**
 * With `back` – a page opened from another page – the header is a back arrow and a heading-size title
 * on one line, with no breadcrumb (Design §6.3); without it, the display-size title of a top-level page.
 */
export function PageHeader({ title, actions, breadcrumb, menu, subtitle, back }: { title: string; actions?: ReactNode; breadcrumb?: ReactNode; menu?: ReactNode; subtitle?: ReactNode; back?: BackTo }) {
  return (
    <div className={clsx('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', back ? 'mb-4' : 'mb-6')}>
      <div className="min-w-0">
        {breadcrumb && !back && <div className="mb-1 text-[13px] text-ink-500">{breadcrumb}</div>}
        <div className="flex items-center justify-between gap-2">
          {back ? (
            // The 40 px arrow target is centred on the title's first line (24 px, 28 px from sm); the arrow
            // itself is level with the content below.
            <div className="flex min-w-0 items-start gap-1">
              <Link
                to={back.to}
                aria-label="Quay lại"
                title={`Quay lại ${back.label}`}
                className="-my-2 -ml-2.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-navy-700 hover:bg-navy-50 sm:-my-1.5"
              >
                <ArrowLeft size={20} aria-hidden />
              </Link>
              <h1 className="min-w-0 text-base leading-6 font-semibold break-words text-navy-700 sm:text-xl sm:leading-7">{title}</h1>
            </div>
          ) : (
            <h1 className="min-w-0 text-[22px] leading-[30px] font-semibold text-navy-700 sm:text-[28px] sm:leading-9">{title}</h1>
          )}
          {menu && <div className="shrink-0 sm:hidden">{menu}</div>}
        </div>
        {subtitle && <div className="mt-1 text-sm text-ink-500">{subtitle}</div>}
      </div>
      {(actions || menu) && (
        <div className={clsx('flex flex-wrap items-center gap-2', !actions && 'max-sm:hidden')}>
          {actions}
          {menu && <div className="max-sm:hidden">{menu}</div>}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, help, actions }: { icon: LucideIcon; title: string; help?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <Icon size={48} className="text-ink-300" aria-hidden />
      <h3 className="text-base font-semibold text-ink-900">{title}</h3>
      {help && <p className="max-w-prose text-ink-500">{help}</p>}
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403) {
    return <EmptyState icon={Lock} title={t('error.noPermission')} actions={<Button variant="tonal" onClick={() => (window.location.href = '/')}>{t('error.home')}</Button>} />;
  }
  const message = error instanceof Error ? error.message : String(error);
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <AlertOctagon size={48} className="text-danger-700" aria-hidden />
      <h3 className="text-base font-semibold text-ink-900">{t('error.load')}</h3>
      <p className="max-w-prose text-ink-500">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
      {requestId && (
        <p className="text-xs text-ink-500">
          {t('error.requestId')}: <span className="code">{requestId}</span>
        </p>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-paper-200', className)} aria-hidden />;
}

/** Inline alert (§10.10) for messages inside a page or form. */
export function InlineAlert({ tone, children }: { tone: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  const Icon = { info: Info, warning: AlertTriangle, danger: AlertOctagon, success: CheckCircle2 }[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={clsx('flex items-start gap-2 rounded-lg px-4 py-3', TONE[tone])}>
      <Icon size={20} className="mt-px shrink-0" aria-hidden />
      <div className="text-sm">{children}</div>
    </div>
  );
}
