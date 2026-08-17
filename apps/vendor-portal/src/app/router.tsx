import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/features/auth/RequireAuth';

/** Route-level code splitting from the start — mirrors `customer-pwa`'s own `router.tsx` reasoning. */
const LoginPage = lazy(() =>
  import('@/pages/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const VendorOrdersPage = lazy(() =>
  import('@/pages/VendorOrdersPage').then((module) => ({ default: module.VendorOrdersPage })),
);
const VendorOrderDetailPage = lazy(() =>
  import('@/pages/VendorOrderDetailPage').then((module) => ({
    default: module.VendorOrderDetailPage,
  })),
);
const VendorEarningsPage = lazy(() =>
  import('@/pages/VendorEarningsPage').then((module) => ({ default: module.VendorEarningsPage })),
);
const RedeemPickupPage = lazy(() =>
  import('@/pages/RedeemPickupPage').then((module) => ({ default: module.RedeemPickupPage })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
);

const RouteFallback = (): JSX.Element => (
  <div className="flex min-h-screen items-center justify-center">
    <p className="text-sm text-slate-500">Loading…</p>
  </div>
);

const withBoundary = (element: JSX.Element): JSX.Element => (
  <ErrorBoundary>
    <Suspense fallback={<RouteFallback />}>{element}</Suspense>
  </ErrorBoundary>
);

const router = createBrowserRouter([
  { path: '/login', element: withBoundary(<LoginPage />) },
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Navigate to="/orders" replace /> },
      {
        element: withBoundary(<RequireAuth />),
        children: [
          { path: '/orders', element: withBoundary(<VendorOrdersPage />) },
          { path: '/orders/:id', element: withBoundary(<VendorOrderDetailPage />) },
          { path: '/earnings', element: withBoundary(<VendorEarningsPage />) },
          { path: '/pickup/redeem', element: withBoundary(<RedeemPickupPage />) },
        ],
      },
      { path: '*', element: withBoundary(<NotFoundPage />) },
    ],
  },
]);

export const AppRouter = (): JSX.Element => <RouterProvider router={router} />;
