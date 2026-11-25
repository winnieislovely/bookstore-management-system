import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertOctagon, AlertTriangle, Bell, CheckCircle2, Info, KeyRound, Lock, LogOut, Menu, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { get, post } from '../lib/api';
import { formatRelative, formatVnd } from '../lib/format';
import { t } from '../lib/i18n';
import { can, useMe, useSignOut, type Me } from '../lib/session';
import { visibleNav, type NavGroup } from '../nav';
import { CompactMark, Wordmark } from './logo';
import { errText, toast } from './data';
import { initialsOf, PinDialog } from './lock';
import { CountBadge } from './ui';

/** App shell (Design §6.3): sidebar, top bar, content. The POS uses its own full-screen layout. */

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

function Sidebar({ groups, badges, rail, onNavigate }: { groups: NavGroup[]; badges: Record<string, number>; rail: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  // Giao hàng stays unlit on Đối soát COD, which has its own item (Design Appendix A).
  const lit = (path: string, isActive: boolean) => isActive && !(path === '/orders' && pathname.startsWith('/orders/cod'));
  return (
    <nav className="on-navy flex h-full flex-col bg-navy-700 text-white/80" aria-label="Menu chính">
      <div className={clsx('flex h-16 shrink-0 items-center', rail ? 'justify-center' : 'px-6')}>{rail ? <CompactMark /> : <Wordmark />}</div>
      <div className="flex-1 overflow-y-auto pb-6">
        {groups.map((g, gi) => (
          <div key={gi} className="mt-4">
            {g.label && !rail && <div className="px-6 pb-1 text-xs font-semibold tracking-[0.08em] text-white/56 uppercase">{t(g.label)}</div>}
            <ul>
              {g.items.map((item) => {
                const count = (Array.isArray(item.badge) ? item.badge : item.badge ? [item.badge] : []).reduce((n, k) => n + (badges[k] ?? 0), 0);
                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      // Mượn / trả stays unlit on the library pages below it.
                      end={item.path === '/library'}
                      onClick={onNavigate}
                      title={rail ? t(item.label) : undefined}
                      className={({ isActive }) =>
                        clsx(
                          'relative flex h-10 items-center gap-3 font-medium pointer-coarse:h-11',
                          rail ? 'justify-center' : 'px-6',
                          lit(item.path, isActive) ? 'bg-navy-900 text-white' : 'hover:bg-navy-800 hover:text-white',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {lit(item.path, isActive) && <span className="absolute inset-y-0 left-0 w-[3px] bg-sand-300" aria-hidden />}
                          <item.icon size={20} aria-hidden />
                          {!rail && <span className="flex-1 truncate">{t(item.label)}</span>}
                          {count > 0 && (rail ? <span className="absolute top-1 right-3 size-2 rounded-full bg-sand-300" aria-label={String(count)} /> : <CountBadge count={count} tone="sidebar" />)}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <SignOutItem rail={rail} />
    </nav>
  );
}

/** Sign out, pinned to the bottom of the sidebar and drawer (Design §6.3). */
function SignOutItem({ rail }: { rail: boolean }) {
  const signOut = useSignOut();
  return (
    <div className="shrink-0 border-t border-sand-300/20 py-2">
      <button
        type="button"
        onClick={signOut}
        title={rail ? t('auth.signOut') : undefined}
        aria-label={rail ? t('auth.signOut') : undefined}
        className={clsx('flex h-10 w-full items-center gap-3 font-medium hover:bg-navy-800 hover:text-white pointer-coarse:h-11', rail ? 'justify-center' : 'px-6')}
      >
        <LogOut size={20} aria-hidden />
        {!rail && <span>{t('auth.signOut')}</span>}
      </button>
    </div>
  );
}

interface NotificationItem {
  id: string;
  template: string;
  vars: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

function notificationTitle(n: NotificationItem): string {
  const v = n.vars;
  switch (n.template) {
    case 'shift.variance_exceeded':
      return t('notify.shift.variance_exceeded', { shiftNo: String(v.shiftNo ?? ''), variance: formatVnd(Number(v.varianceVnd ?? 0)) });
    case 'einvoice.failed':
      return t('notify.einvoice.failed', { docNo: String(v.docNo ?? '') });
    case 'backup.problem':
      return t(v.problem === 'wal_lagging' ? 'notify.backup.walLagging' : 'notify.backup.stale');
    case 'consignment.deadline':
      return t('notify.consignment.deadline', { sku: String(v.sku ?? '') });
    case 'pos.sync_exception':
      return t('notify.pos.syncException', { device: String(v.deviceCode ?? ''), count: String(v.count ?? '') });
    case 'library.loans_to_call':
      return t('notify.library.loansToCall', { overdue: String(v.overdue ?? 0), dueSoon: String(v.dueSoon ?? 0) });
    case 'delivery.update': {
      const keys = { new: 'notify.delivery.new', failed: 'notify.delivery.failed', returning: 'notify.delivery.returning', returned: 'notify.delivery.returned', delivered: 'notify.delivery.delivered' } as const;
      const key = keys[String(v.event) as keyof typeof keys] as (typeof keys)[keyof typeof keys] | undefined;
      return key ? t(key, { docNo: String(v.docNo ?? '') }) : t('notify.generic');
    }
    case 'preorder.created':
      return v.customerName ? t('notify.preorder.created', { docNo: String(v.docNo ?? ''), customer: String(v.customerName) }) : t('notify.preorder.createdNoName', { docNo: String(v.docNo ?? '') });
    case 'order.needs_action':
      if (v.kind === 'preorder') return t('notify.preorder.holdExpired', { docNo: String(v.docNo ?? '') });
      return t(v.reason === 'return' ? 'notify.order.return' : v.reason === 'review' ? 'notify.order.review' : 'notify.order.confirm', { docNo: String(v.docNo ?? '') });
    default:
      // Never a raw template code (Design §10.11).
      return t('notify.generic');
  }
}

/** Where a notification opens (Design §10.11): its order, slip, shift, sale or list. */
function notificationLink(n: NotificationItem): string | null {
  const v = n.vars;
  switch (n.template) {
    case 'delivery.update':
      return v.id ? `/orders/${String(v.id)}` : null;
    case 'preorder.created':
      return `/preorders?q=${encodeURIComponent(String(v.docNo ?? ''))}`;
    case 'order.needs_action':
      if (v.kind === 'preorder') return `/preorders?q=${encodeURIComponent(String(v.docNo ?? ''))}`;
      return v.id ? `/orders/${String(v.id)}` : null;
    case 'shift.variance_exceeded':
      return v.shiftId ? `/shifts/${String(v.shiftId)}` : null;
    case 'einvoice.failed':
      return v.saleId ? `/sales/${String(v.saleId)}` : v.orderId ? `/orders/${String(v.orderId)}` : null;
    case 'consignment.deadline':
      return '/consignment';
    case 'pos.sync_exception':
      return '/settings?tab=pos';
    case 'backup.problem':
      return '/settings';
    case 'library.loans_to_call':
      return `/library?tab=${Number(v.overdue ?? 0) > 0 ? 'overdue' : 'due_soon'}`;
    default:
      return null;
  }
}

/** Notification centre (Design §10.11): grouped Today / Earlier, unread dot, mark all read. */
function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ items: NotificationItem[]; unread: number }>('/api/v1/notifications'), refetchInterval: 30_000 });
  const readAll = useMutation({ mutationFn: () => post('/api/v1/notifications/read-all'), onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !panel.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const today = new Date().toDateString();
  const items = data?.items ?? [];
  const groups: [string, NotificationItem[]][] = [
    [t('shell.today'), items.filter((i) => new Date(i.createdAt).toDateString() === today)],
    [t('shell.earlier'), items.filter((i) => new Date(i.createdAt).toDateString() !== today)],
  ];
  return (
    <div className="relative" ref={panel}>
      <button
        type="button"
        className="relative inline-flex size-10 items-center justify-center rounded-full text-ink-700 hover:bg-navy-50"
        aria-label={`${t('shell.notifications')}${data?.unread ? ` (${data.unread})` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bell size={20} aria-hidden />
        {!!data?.unread && (
          <span className="absolute -top-0.5 -right-0.5">
            <CountBadge count={data.unread} />
          </span>
        )}
      </button>
      {open && (
        // Phones: full width less 16 px each side under the top bar; from sm: 400 px under the bell (Design §10.11).
        <div className="fixed inset-x-4 top-16 z-30 rounded-lg border border-paper-300 bg-white shadow-md sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[400px]">
          <div className="flex items-center justify-between border-b border-paper-300 px-4 py-3">
            <h2 className="font-semibold">{t('shell.notifications')}</h2>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 && <p className="px-4 py-6 text-center text-ink-500">{t('shell.noNotifications')}</p>}
            {groups.map(
              ([label, list]) =>
                list.length > 0 && (
                  <div key={label}>
                    <div className="px-4 pt-3 pb-1 text-xs font-semibold text-ink-500">{label}</div>
                    <ul>
                      {list.map((n) => (
                        <li key={n.id} className={clsx('flex gap-3 px-4 py-3', !n.readAt && 'bg-sand-50')}>
                          {n.template === 'einvoice.failed' ? (
                            <AlertOctagon size={20} className="shrink-0 text-danger-700" aria-hidden />
                          ) : n.template === 'delivery.update' && n.vars.event === 'delivered' ? (
                            <CheckCircle2 size={20} className="shrink-0 text-success-700" aria-hidden />
                          ) : n.template === 'preorder.created' || (n.template === 'delivery.update' && n.vars.event === 'new') ? (
                            <Info size={20} className="shrink-0 text-info-700" aria-hidden />
                          ) : (
                            <AlertTriangle size={20} className="shrink-0 text-warning-700" aria-hidden />
                          )}
                          <div className="min-w-0 flex-1">
                            {/* Each notification opens its record (Design §10.11). */}
                            {notificationLink(n) ? (
                              <Link to={notificationLink(n)!} className="font-semibold hover:underline" onClick={() => setOpen(false)}>
                                {notificationTitle(n)}
                              </Link>
                            ) : (
                              <p className="font-semibold">{notificationTitle(n)}</p>
                            )}
                            <p className="text-xs text-ink-500">{formatRelative(n.createdAt)}</p>
                          </div>
                          {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-navy-700" aria-label="Chưa đọc" />}
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
            )}
          </div>
          {items.some((i) => !i.readAt) && (
            <div className="border-t border-paper-300 p-2 text-right">
              <button type="button" className="rounded-full px-3 py-1.5 text-sm text-navy-700 hover:bg-navy-50" onClick={() => readAll.mutate()}>
                {t('shell.markAllRead')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** User menu at the top right (Design §13.5): set or change the PIN, lock the screen, sign out. */
export function UserMenu({ me, onNavy }: { me: Me; onNavy?: boolean }) {
  const qc = useQueryClient();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const [pinDialog, setPinDialog] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const lockNow = async () => {
    setOpen(false);
    try {
      await post('/api/v1/auth/lock');
      await qc.refetchQueries({ queryKey: ['me'] });
    } catch (e) {
      toast.error(errText(e));
    }
  };
  const item = 'flex h-11 w-full items-center gap-3 px-4 text-left text-sm text-ink-900 hover:bg-navy-50';
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={clsx('flex min-h-11 items-center gap-2 rounded-full pr-2 pl-1', onNavy ? 'text-white hover:bg-navy-800' : 'hover:bg-navy-50')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Tài khoản – ${me.displayName}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={clsx('flex size-9 items-center justify-center rounded-full text-sm font-semibold', onNavy ? 'bg-white/15 text-white' : 'bg-navy-100 text-navy-700')} aria-hidden>
          {initialsOf(me.displayName)}
        </span>
        <span className="hidden text-sm font-medium md:inline">{me.displayName}</span>
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-paper-300 bg-white py-1 shadow-md">
          <div className="border-b border-paper-300 px-4 py-2 text-sm">
            <div className="font-semibold text-ink-900">{me.displayName}</div>
            <div className="text-ink-500">{me.username}</div>
          </div>
          <button type="button" role="menuitem" className={item} onClick={() => (setOpen(false), setPinDialog(true))}>
            <KeyRound size={18} aria-hidden /> {me.hasPin ? 'Đổi mã PIN' : 'Đặt mã PIN'}
          </button>
          {me.hasPin && (
            <button type="button" role="menuitem" className={item} onClick={() => void lockNow()}>
              <Lock size={18} aria-hidden /> Khóa màn hình
            </button>
          )}
          <button type="button" role="menuitem" className={item} onClick={() => void signOut()}>
            <LogOut size={18} aria-hidden /> {t('auth.signOut')}
          </button>
        </div>
      )}
      {pinDialog && <PinDialog me={me} onClose={() => setPinDialog(false)} />}
    </div>
  );
}

/** The main menu as a drawer, for full-screen pages such as the POS (Design §6.x POS mode). */
export function NavDrawer({ onClose }: { onClose: () => void }) {
  const { data: me } = useMe();
  const groups = visibleNav((p: string) => can(me, p));
  const { data: badges } = useQuery({ queryKey: ['badges'], queryFn: () => get<Record<string, number>>('/api/v1/me/badges'), refetchInterval: 30_000, enabled: !!me });
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Menu chính">
      <div className="absolute inset-0 bg-ink-900/40" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 w-[288px] shadow-lg">
        <Sidebar groups={groups} badges={badges ?? {}} rail={false} onNavigate={onClose} />
        <button type="button" className="absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-full text-white" aria-label={t('common.close')} onClick={onClose}>
          <X size={20} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function Shell() {
  const { data: me } = useMe();
  const online = useOnline();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const has = (p: string) => can(me, p);
  const groups = visibleNav(has);
  const { data: badges } = useQuery({ queryKey: ['badges'], queryFn: () => get<Record<string, number>>('/api/v1/me/badges'), refetchInterval: 30_000, enabled: !!me });
  useEffect(() => setDrawer(false), [location.pathname]);
  if (!me) return null;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[72px_1fr] lg:grid-cols-[264px_1fr]">
      <aside className="sticky top-0 hidden h-dvh md:block">
        <div className="hidden h-full lg:block">
          <Sidebar groups={groups} badges={badges ?? {}} rail={false} />
        </div>
        <div className="h-full lg:hidden">
          <Sidebar groups={groups} badges={badges ?? {}} rail />
        </div>
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[288px] shadow-lg">
            <Sidebar groups={groups} badges={badges ?? {}} rail={false} onNavigate={() => setDrawer(false)} />
            <button type="button" className="absolute top-3 right-3 inline-flex size-10 items-center justify-center rounded-full text-white" aria-label={t('common.close')} onClick={() => setDrawer(false)}>
              <X size={20} aria-hidden />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-paper-300 bg-white px-4">
          <button type="button" className="inline-flex size-10 items-center justify-center rounded-full hover:bg-navy-50 md:hidden" aria-label={t('shell.menu')} onClick={() => setDrawer(true)}>
            <Menu size={20} aria-hidden />
          </button>
          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            {/* Connection status only when offline; nothing while online (Design §13.2). */}
            {!online && (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-warning-50 px-3 text-xs font-medium text-warning-700" role="status">
                <WifiOff size={14} aria-hidden />
                <span className="max-sm:sr-only">{t('shell.offline')}</span>
              </span>
            )}
            <NotificationBell />
            <UserMenu me={me} />
          </div>
        </header>
        {!online && (
          <div className="flex items-center gap-2 bg-warning-50 px-4 py-2 text-sm text-warning-700" role="alert">
            <WifiOff size={16} aria-hidden /> {t('shell.offlineBanner')}
          </div>
        )}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-6 lg:px-10 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

