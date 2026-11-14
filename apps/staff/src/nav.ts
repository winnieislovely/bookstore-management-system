import {
  BadgePercent,
  BookOpen,
  CalendarClock,
  Boxes,
  Building2,
  ArrowLeftRight,
  ClipboardList,
  Library,
  HandCoins,
  Handshake,
  Landmark,
  House,
  Monitor,
  Receipt,
  ShoppingCart,
  ScrollText,
  Truck,
  Settings,
  ShieldCheck,
  TrendingUp,
  Upload,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from './lib/i18n';

/**
 * Navigation map (SRS Appendix C, Design Appendix A). Items appear only with permission (FR-ADM-03).
 * Groups for later releases (Events, Website, HR) join with them.
 */
export interface NavItem {
  path: string;
  label: MessageKey;
  icon: LucideIcon;
  /** Any of these permissions shows the item. */
  anyOf: string[];
  /** Key(s) in `/api/v1/me/badges`; several keys are added up. */
  badge?: string | string[];
}

export interface NavGroup {
  label?: MessageKey;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { items: [{ path: '/dashboard', label: 'nav.overview', icon: House, anyOf: ['report.view'] }] },
  {
    label: 'nav.group.store',
    items: [
      { path: '/pos', label: 'nav.selling', icon: ShoppingCart, anyOf: ['sale.create'] },
      { path: '/preorders', label: 'nav.preorders', icon: CalendarClock, anyOf: ['sale.create'], badge: 'preordersAction' },
      { path: '/orders', label: 'nav.orders', icon: Truck, anyOf: ['online.manage'], badge: 'shipmentsWaiting' },
      { path: '/orders/cod', label: 'nav.cod', icon: HandCoins, anyOf: ['online.manage'], badge: 'codDifferences' },
      { path: '/sales', label: 'nav.sales', icon: Receipt, anyOf: ['sale.create', 'sale.view_all', 'online.manage', 'online.confirm'], badge: ['ordersNeedingAction', 'einvoicesFailed'] },
      { path: '/customers', label: 'nav.customers', icon: Users, anyOf: ['customer.view'] },
      { path: '/promotions', label: 'nav.promotions', icon: BadgePercent, anyOf: ['promotion.manage'] },
    ],
  },
  {
    label: 'nav.group.library',
    items: [
      { path: '/library', label: 'nav.libraryDesk', icon: ArrowLeftRight, anyOf: ['library.lend'], badge: 'libraryOverdue' },
      { path: '/library/catalog', label: 'nav.libraryCatalog', icon: Library, anyOf: ['library.manage', 'library.lend'] },
      { path: '/library/counts', label: 'nav.libraryCounts', icon: ClipboardList, anyOf: ['library.count'] },
    ],
  },
  {
    label: 'nav.group.catalog',
    items: [
      { path: '/products', label: 'nav.products', icon: BookOpen, anyOf: ['catalog.view'] },
      { path: '/stock', label: 'nav.stock', icon: Boxes, anyOf: ['inventory.view', 'purchasing.manage'] },
      { path: '/counts', label: 'nav.counts', icon: ClipboardList, anyOf: ['inventory.count'] },
      { path: '/suppliers', label: 'nav.suppliers', icon: Building2, anyOf: ['purchasing.manage'] },
      { path: '/consignment', label: 'nav.consignment', icon: Handshake, anyOf: ['purchasing.manage', 'purchasing.payables'] },
    ],
  },
  {
    label: 'nav.group.staff',
    items: [
      { path: '/users', label: 'nav.users', icon: UserRound, anyOf: ['user.manage', 'user.unlock'] },
      { path: '/roles', label: 'nav.roles', icon: ShieldCheck, anyOf: ['role.manage'] },
    ],
  },
  {
    label: 'nav.group.reports',
    items: [
      { path: '/shifts', label: 'nav.shifts', icon: Wallet, anyOf: ['shift.view_all'] },
      { path: '/reports/sales', label: 'nav.reportsSales', icon: TrendingUp, anyOf: ['report.view'] },
      { path: '/reports/inventory', label: 'nav.reportsInventory', icon: Boxes, anyOf: ['report.view'] },
      { path: '/reports/tax', label: 'nav.reportsTax', icon: Landmark, anyOf: ['report.view'] },
      { path: '/reports/library', label: 'nav.reportsLibrary', icon: Library, anyOf: ['report.view'] },
    ],
  },
  {
    label: 'nav.group.settings',
    items: [
      { path: '/settings', label: 'nav.settings', icon: Settings, anyOf: ['settings.manage'] },
      { path: '/import', label: 'nav.dataImport', icon: Upload, anyOf: ['catalog.import', 'data.import'] },
      { path: '/devices', label: 'nav.devices', icon: Monitor, anyOf: ['pos.offline.manage'] },
      { path: '/audit', label: 'nav.audit', icon: ScrollText, anyOf: ['audit.view'] },
    ],
  },
];

export function visibleNav(has: (p: string) => boolean): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.anyOf.some(has)) })).filter((g) => g.items.length > 0);
}

/** Landing page: the dashboard for report viewers, the POS for a cashier (SRS §5.1). */
export function landingPath(has: (p: string) => boolean): string {
  for (const g of visibleNav(has)) for (const i of g.items) return i.path;
  return '/no-access';
}

