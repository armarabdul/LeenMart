import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { HomeRedirect } from '@/components/HomeRedirect';

/** Route-level code splitting from the start — mirrors `customer-pwa`'s own `router.tsx` reasoning. */
const LoginPage = lazy(() =>
  import('@/pages/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const RegisterPage = lazy(() =>
  import('@/pages/RegisterPage').then((module) => ({ default: module.RegisterPage })),
);
const OnboardingPage = lazy(() =>
  import('@/pages/OnboardingPage').then((module) => ({ default: module.OnboardingPage })),
);
const VendorProductsPage = lazy(() =>
  import('@/pages/VendorProductsPage').then((module) => ({ default: module.VendorProductsPage })),
);
const VendorProductCreatePage = lazy(() =>
  import('@/pages/VendorProductCreatePage').then((module) => ({
    default: module.VendorProductCreatePage,
  })),
);
const VendorProductEditPage = lazy(() =>
  import('@/pages/VendorProductEditPage').then((module) => ({
    default: module.VendorProductEditPage,
  })),
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
const ShopProfilePage = lazy(() =>
  import('@/pages/ShopProfilePage').then((module) => ({ default: module.ShopProfilePage })),
);
const RedeemPickupPage = lazy(() =>
  import('@/pages/RedeemPickupPage').then((module) => ({ default: module.RedeemPickupPage })),
);
const NotificationsPage = lazy(() =>
  import('@/pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })),
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
  { path: '/register', element: withBoundary(<RegisterPage />) },
  {
    element: <AppLayout />,
    children: [
      {
        element: withBoundary(<RequireAuth />),
        children: [
          { path: '/', element: withBoundary(<HomeRedirect />) },
          { path: '/onboarding', element: withBoundary(<OnboardingPage />) },
          { path: '/orders', element: withBoundary(<VendorOrdersPage />) },
          { path: '/orders/:id', element: withBoundary(<VendorOrderDetailPage />) },
          { path: '/earnings', element: withBoundary(<VendorEarningsPage />) },
          { path: '/pickup/redeem', element: withBoundary(<RedeemPickupPage />) },
          { path: '/shop-profile', element: withBoundary(<ShopProfilePage />) },
          { path: '/products', element: withBoundary(<VendorProductsPage />) },
          { path: '/products/new', element: withBoundary(<VendorProductCreatePage />) },
          { path: '/products/:id', element: withBoundary(<VendorProductEditPage />) },
          { path: '/notifications', element: withBoundary(<NotificationsPage />) },
        ],
      },
      { path: '*', element: withBoundary(<NotFoundPage />) },
    ],
  },
]);

export const AppRouter = (): JSX.Element => <RouterProvider router={router} />;
