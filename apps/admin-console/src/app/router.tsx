import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { HomeRedirect } from '@/components/HomeRedirect';

/** Route-level code splitting from the start — mirrors `vendor-portal`'s own `router.tsx` reasoning. */
const LoginPage = lazy(() =>
  import('@/pages/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const MfaEnrollPage = lazy(() =>
  import('@/pages/MfaEnrollPage').then((module) => ({ default: module.MfaEnrollPage })),
);
const KycQueuePage = lazy(() =>
  import('@/pages/KycQueuePage').then((module) => ({ default: module.KycQueuePage })),
);
const KycDetailPage = lazy(() =>
  import('@/pages/KycDetailPage').then((module) => ({ default: module.KycDetailPage })),
);
const ProductQueuePage = lazy(() =>
  import('@/pages/ProductQueuePage').then((module) => ({ default: module.ProductQueuePage })),
);
const ProductDetailPage = lazy(() =>
  import('@/pages/ProductDetailPage').then((module) => ({ default: module.ProductDetailPage })),
);
const ReviewQueuePage = lazy(() =>
  import('@/pages/ReviewQueuePage').then((module) => ({ default: module.ReviewQueuePage })),
);
const CategoriesPage = lazy(() =>
  import('@/pages/CategoriesPage').then((module) => ({ default: module.CategoriesPage })),
);
const CategoryDetailPage = lazy(() =>
  import('@/pages/CategoryDetailPage').then((module) => ({ default: module.CategoryDetailPage })),
);
const AuditLogPage = lazy(() =>
  import('@/pages/AuditLogPage').then((module) => ({ default: module.AuditLogPage })),
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
  { path: '/mfa/enroll', element: withBoundary(<MfaEnrollPage />) },
  {
    element: <AppLayout />,
    children: [
      {
        element: withBoundary(<RequireAuth />),
        children: [
          { path: '/', element: withBoundary(<HomeRedirect />) },
          { path: '/kyc-review', element: withBoundary(<KycQueuePage />) },
          { path: '/kyc-review/:kycId', element: withBoundary(<KycDetailPage />) },
          { path: '/product-moderation', element: withBoundary(<ProductQueuePage />) },
          { path: '/product-moderation/:productId', element: withBoundary(<ProductDetailPage />) },
          { path: '/review-moderation', element: withBoundary(<ReviewQueuePage />) },
          { path: '/categories', element: withBoundary(<CategoriesPage />) },
          { path: '/categories/:categoryId', element: withBoundary(<CategoryDetailPage />) },
          { path: '/audit-log', element: withBoundary(<AuditLogPage />) },
        ],
      },
      { path: '*', element: withBoundary(<NotFoundPage />) },
    ],
  },
]);

export const AppRouter = (): JSX.Element => <RouterProvider router={router} />;
