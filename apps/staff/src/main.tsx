import './styles.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Construction, Lock } from 'lucide-react';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { Toaster } from './components/data';
import { Shell } from './components/shell';
import { EmptyState, ErrorState, Skeleton } from './components/ui';
import { ApiError } from './lib/api';
import { t } from './lib/i18n';
import { can, useMe, useSetupStatus } from './lib/session';
import { landingPath, NAV } from './nav';
import { ChangePasswordPage, LoginPage, SetupPage } from './pages/auth';
import { DashboardPage } from './pages/dashboard';
import { ImportPage } from './pages/import';
import { AuditPage, DevicesPage, RolesPage, UsersPage } from './pages/admin';
import { ConsignmentPage } from './pages/consignment';
import { CountDetailPage, CountsPage } from './pages/counts';
import { CustomerDetailPage, CustomersPage } from './pages/customers';
import { LibraryCatalogPage, LibraryDeskPage, LibraryReportPage, LibrarySlipPage, LibraryTitlePage } from './pages/library';
import { LibraryCountDetailPage, LibraryCountsPage } from './pages/libraryCounts';
import { CodPage } from './pages/holds';
import { OrderDetailPage, OrderNewPage, OrdersPage } from './pages/orders';
import { ProductDetailPage } from './pages/productDetail';
import { ProductNewPage } from './pages/productNew';
import { ProductsPage } from './pages/products';
import { PromotionsPage } from './pages/promotions';
import { InventoryReportsPage, SalesReportsPage, TaxReportsPage } from './pages/reports';
import { SaleDetailPage, SalesPage } from './pages/sales';
import { SettingsPage } from './pages/settings';
import { ShiftDetailPage, ShiftsPage } from './pages/shifts';
import { StockItemPage, StockPage } from './pages/stock';
import { SuppliersPage } from './pages/suppliers';
import { PosPage } from './pos/PosPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});

function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-8">
      <Skeleton className="h-10 w-64" />
    </div>
  );
}

/** Sends the visitor to setup, login or password change, otherwise renders the page. */
function Gate({ children }: { children: ReactNode }) {
  const setup = useSetupStatus();
  const me = useMe();
  const location = useLocation();
  if (setup.isLoading || me.isLoading) return <Loading />;
  if (setup.isError) return <ErrorState error={setup.error} onRetry={() => setup.refetch()} />;
  if (setup.data?.needsSetup) return <Navigate to="/setup" replace />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => me.refetch()} />;
  if (!me.data) {
    // A must-change-password session reads /me as forbidden until the password is changed.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (me.data.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <>{children}</>;
}

function Landing() {
  const { data: me } = useMe();
  return <Navigate to={landingPath((p) => can(me, p))} replace />;
}

function RequirePermission({ anyOf, children }: { anyOf: string[]; children: ReactNode }) {
  const { data: me } = useMe();
  if (!anyOf.some((p) => can(me, p))) return <EmptyState icon={Lock} title={t('error.noPermission')} />;
  return <>{children}</>;
}

function Placeholder() {
  return <EmptyState icon={Construction} title={t('placeholder.title')} help={t('placeholder.help')} />;
}

const BUILT: Record<string, ReactNode> = {
  '/dashboard': <DashboardPage />,
  '/products': <ProductsPage />,
  '/orders': <OrdersPage />,
  '/sales': <SalesPage />,
  '/shifts': <ShiftsPage />,
  '/customers': <CustomersPage />,
  '/promotions': <PromotionsPage />,
  '/stock': <StockPage />,
  '/counts': <CountsPage />,
  '/suppliers': <SuppliersPage />,
  '/consignment': <ConsignmentPage />,
  '/users': <UsersPage />,
  '/roles': <RolesPage />,
  '/reports/sales': <SalesReportsPage />,
  '/reports/inventory': <InventoryReportsPage />,
  '/reports/tax': <TaxReportsPage />,
  '/library': <LibraryDeskPage />,
  '/library/catalog': <LibraryCatalogPage />,
  '/library/counts': <LibraryCountsPage />,
  '/reports/library': <LibraryReportPage />,
  '/settings': <SettingsPage />,
  '/import': <ImportPage />,
  '/devices': <DevicesPage />,
  '/audit': <AuditPage />,
};

/** Detail pages, guarded by the permission of their list (Design §12.3). */
const DETAILS: { path: string; anyOf: string[]; element: ReactNode }[] = [
  { path: 'sales/:id', anyOf: ['sale.create'], element: <SaleDetailPage /> },
  { path: 'orders/cod', anyOf: ['online.manage'], element: <CodPage /> },
  { path: 'orders/new', anyOf: ['online.manage'], element: <OrderNewPage /> },
  { path: 'orders/:id', anyOf: ['online.manage'], element: <OrderDetailPage /> },
  { path: 'shifts/:id', anyOf: ['shift.view_all'], element: <ShiftDetailPage /> },
  { path: 'customers/:id', anyOf: ['customer.view'], element: <CustomerDetailPage /> },
  // Stock-in lives on the Stock page now (Design §12.1); old links land there.
  { path: 'stock-in', anyOf: ['inventory.view', 'purchasing.manage'], element: <Navigate to="/stock" replace /> },
  { path: 'stock/:id', anyOf: ['inventory.view', 'purchasing.manage'], element: <StockItemPage /> },
  { path: 'products/new', anyOf: ['catalog.edit'], element: <ProductNewPage /> },
  { path: 'products/:id', anyOf: ['catalog.view'], element: <ProductDetailPage /> },
  // One page per report area now (Design §12.6); the old link opens sales.
  { path: 'reports', anyOf: ['report.view'], element: <Navigate to="/reports/sales" replace /> },
  { path: 'counts/:id', anyOf: ['inventory.count'], element: <CountDetailPage /> },
  { path: 'library/titles/:id', anyOf: ['library.manage', 'library.lend'], element: <LibraryTitlePage /> },
  { path: 'library/counts/:id', anyOf: ['library.count'], element: <LibraryCountDetailPage /> },
  { path: 'library/slips/:id', anyOf: ['library.lend'], element: <LibrarySlipPage /> },
  // The cash book page is gone; its old link opens every slip on Mượn / trả (FR-LIB-09a).
  { path: 'library/payments', anyOf: ['library.lend'], element: <Navigate to="/library?tab=all" replace /> },
];

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/change-password', element: <ChangePasswordPage /> },
  // The POS is full screen, outside the back-office shell (Design §13).
  {
    path: '/pos',
    element: (
      <Gate>
        <RequirePermission anyOf={['sale.create']}>
          <PosPage />
        </RequirePermission>
      </Gate>
    ),
  },
  {
    path: '/',
    element: (
      <Gate>
        <Shell />
      </Gate>
    ),
    children: [
      { index: true, element: <Landing /> },
      ...NAV.flatMap((g) =>
        g.items.filter((item) => item.path !== '/pos').map((item) => ({
          path: item.path.slice(1),
          element: <RequirePermission anyOf={item.anyOf}>{BUILT[item.path] ?? <Placeholder />}</RequirePermission>,
        })),
      ),
      ...DETAILS.map((d) => ({ path: d.path, element: <RequirePermission anyOf={d.anyOf}>{d.element}</RequirePermission> })),
      { path: 'no-access', element: <EmptyState icon={Lock} title={t('error.noPermission')} /> },
      { path: '*', element: <Landing /> },
    ],
  },
]);

// App shell cache so a registered POS reloads offline (TDD §7.2).
if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.register('/sw.js');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
