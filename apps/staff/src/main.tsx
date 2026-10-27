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
import { ProductDetailPage } from './pages/productDetail';
import { ProductNewPage } from './pages/productNew';
import { ProductsPage } from './pages/products';
import { PromotionsPage } from './pages/promotions';
import { ReportsPage } from './pages/reports';
import { SaleDetailPage, SalesPage } from './pages/sales';
import { SettingsPage } from './pages/settings';
import { ShiftDetailPage, ShiftsPage } from './pages/shifts';
import { StockPage } from './pages/stock';
import { StockInPage } from './pages/stockin';
import { SupplierOrderDetailPage, SupplierOrdersPage } from './pages/supplierOrders';
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
  '/sales': <SalesPage />,
  '/shifts': <ShiftsPage />,
  '/customers': <CustomersPage />,
  '/promotions': <PromotionsPage />,
  '/stock-in': <StockInPage />,
  '/stock': <StockPage />,
  '/counts': <CountsPage />,
  '/suppliers': <SuppliersPage />,
  '/supplier-orders': <SupplierOrdersPage />,
  '/consignment': <ConsignmentPage />,
  '/users': <UsersPage />,
  '/roles': <RolesPage />,
  '/reports': <ReportsPage />,
  '/settings': <SettingsPage />,
  '/import': <ImportPage />,
  '/devices': <DevicesPage />,
  '/audit': <AuditPage />,
};

/** Detail pages, guarded by the permission of their list (Design §12.3). */
const DETAILS: { path: string; anyOf: string[]; element: ReactNode }[] = [
  { path: 'sales/:id', anyOf: ['sale.create'], element: <SaleDetailPage /> },
  { path: 'shifts/:id', anyOf: ['shift.view_all'], element: <ShiftDetailPage /> },
  { path: 'customers/:id', anyOf: ['customer.view'], element: <CustomerDetailPage /> },
  { path: 'products/new', anyOf: ['catalog.edit'], element: <ProductNewPage /> },
  { path: 'products/:id', anyOf: ['catalog.view'], element: <ProductDetailPage /> },
  { path: 'counts/:id', anyOf: ['inventory.count'], element: <CountDetailPage /> },
  { path: 'supplier-orders/:id', anyOf: ['purchasing.manage'], element: <SupplierOrderDetailPage /> },
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
