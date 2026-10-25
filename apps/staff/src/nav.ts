import {
  BadgePercent,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  ClipboardList,
  FileInput,
  Handshake,
  LayoutDashboard,
  Monitor,
  PackagePlus,
  Receipt,
  ScanBarcode,
  ScrollText,
  Settings,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from './lib/i18n';

/**
 * Navigation map (SRS Appendix C, Design Appendix A). Items appear only with permission (FR-ADM-03).
 * Groups for later releases (Orders & delivery, Events, Library, Website, HR) join with them.
 */
export interface NavItem {
  path: string;
  label: MessageKey;
  icon: LucideIcon;
  /** Any of these permissions shows the item. */
  anyOf: string[];
  /** Key in `/api/v1/me/badges`. */
  badge?: string;
}

export interface NavGroup {
  label?: MessageKey;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { items: [{ path: '/dashboard', label: 'nav.overview', icon: LayoutDashboard, anyOf: ['report.view'] }] },
  {
    label: 'nav.group.store',
    items: [
      { path: '/pos', label: 'nav.selling', icon: ScanBarcode, anyOf: ['sale.create'] },
      { path: '/sales', label: 'nav.sales', icon: Receipt, anyOf: ['sale.create', 'sale.view_all'], badge: 'einvoicesFailed' },
      { path: '/customers', label: 'nav.customers', icon: Users, anyOf: ['customer.view'] },
      { path: '/promotions', label: 'nav.promotions', icon: BadgePercent, anyOf: ['promotion.manage'] },
      { path: '/shifts', label: 'nav.shifts', icon: Wallet, anyOf: ['shift.view_all'] },
    ],
  },
  {
    label: 'nav.group.catalog',
    items: [
      { path: '/products', label: 'nav.products', icon: BookOpen, anyOf: ['catalog.view'] },
      { path: '/stock-in', label: 'nav.stockIn', icon: PackagePlus, anyOf: ['purchasing.manage'] },
      { path: '/stock', label: 'nav.stock', icon: Boxes, anyOf: ['inventory.view'] },
      { path: '/counts', label: 'nav.counts', icon: ClipboardList, anyOf: ['inventory.count'] },
      { path: '/supplier-orders', label: 'nav.supplierOrders', icon: FileInput, anyOf: ['purchasing.manage'] },
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
  { label: 'nav.group.reports', items: [{ path: '/reports', label: 'nav.reports', icon: BarChart3, anyOf: ['report.view'] }] },
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

