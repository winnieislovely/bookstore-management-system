import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { AlertOctagon, AlertTriangle, Bell, LogOut, Menu, Search, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { get, post } from '../lib/api';
import { formatRelative, formatVnd } from '../lib/format';
import { t } from '../lib/i18n';
import { can, useMe, useSignOut, type Me } from '../lib/session';
import { visibleNav, type NavGroup } from '../nav';
import { CompactMark, Wordmark } from './logo';
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
  return (
    <nav className="on-navy flex h-full flex-col bg-navy-700 text-white/80" aria-label="Menu chính">
      <div className={clsx('flex h-16 shrink-0 items-center', rail ? 'justify-center' : 'px-6')}>{rail ? <CompactMark /> : <Wordmark />}</div>
      <div className="flex-1 overflow-y-auto pb-6">
        {groups.map((g, gi) => (
          <div key={gi} className="mt-4">
            {g.label && !rail && <div className="px-6 pb-1 text-xs font-semibold tracking-[0.08em] text-white/56 uppercase">{t(g.label)}</div>}
            <ul>
              {g.items.map((item) => {
                const count = item.badge ? (badges[item.badge] ?? 0) : 0;
                return (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      onClick={onNavigate}
                      title={rail ? t(item.label) : undefined}
                      className={({ isActive }) =>
                        clsx(
                          'relative flex h-10 items-center gap-3 font-medium pointer-coarse:h-11',
                          rail ? 'justify-center' : 'px-6',
                          isActive ? 'bg-navy-900 text-white' : 'hover:bg-navy-800 hover:text-white',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && <span className="absolute inset-y-0 left-0 w-[3px] bg-sand-300" aria-hidden />}
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
    </nav>
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
    case 'consignment.deadline':
      return t('notify.consignment.deadline', { sku: String(v.sku ?? '') });
    default:
      return n.template;
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
        <div className="absolute right-0 z-30 mt-2 w-[400px] max-w-[calc(100vw-2rem)] rounded-lg border border-paper-300 bg-white shadow-md">
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
                          {n.template === 'einvoice.failed' ? <AlertOctagon size={20} className="shrink-0 text-danger-700" aria-hidden /> : <AlertTriangle size={20} className="shrink-0 text-warning-700" aria-hidden />}
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold">{notificationTitle(n)}</p>
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

function UserMenu({ me }: { me: Me }) {
  const signOut = useSignOut();
  const initials = me.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .slice(-2)
    .join('')
    .toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-9 items-center justify-center rounded-full bg-navy-100 text-sm font-semibold text-navy-700" aria-hidden>
        {initials}
      </span>
      <span className="hidden text-sm font-medium md:inline">{me.displayName}</span>
      <button type="button" className="inline-flex size-10 items-center justify-center rounded-full text-ink-700 hover:bg-navy-50" aria-label={t('auth.signOut')} title={t('auth.signOut')} onClick={signOut}>
        <LogOut size={20} aria-hidden />
      </button>
    </div>
  );
}

export function Shell() {
  const { data: me } = useMe();
  const online = useOnline();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const has = (p: string) => can(me, p);
  const groups = visibleNav(has);
  const { data: badges } = useQuery({ queryKey: ['badges'], queryFn: () => get<Record<string, number>>('/api/v1/me/badges'), refetchInterval: 30_000, enabled: !!me });
  useEffect(() => setDrawer(false), [location.pathname]);
  const [q, setQ] = useState('');
  const search = (e: FormEvent) => {
    e.preventDefault();
    if (q.trim()) navigate(`/products?q=${encodeURIComponent(q.trim())}`);
  };
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
          {has('catalog.view') && (
            <form onSubmit={search} className="relative max-w-md flex-1" role="search">
              <Search size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-500" aria-hidden />
              <input
                className="h-10 w-full rounded-full border border-paper-300 bg-paper-50 pr-3 pl-10 text-sm placeholder:text-ink-500 focus:border-navy-700 max-sm:text-base"
                placeholder={t('shell.globalSearch')}
                aria-label={t('shell.globalSearch')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </form>
          )}
          <div className="ml-auto flex items-center gap-1 sm:gap-3">
            <span
              className={clsx('inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium', online ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700')}
              role="status"
              aria-live="polite"
            >
              {online ? <Wifi size={14} aria-hidden /> : <WifiOff size={14} aria-hidden />}
              <span className="max-sm:sr-only">{online ? t('shell.online') : t('shell.offline')}</span>
            </span>
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

