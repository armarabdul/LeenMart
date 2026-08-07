import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';

/**
 * Route-level code splitting from the start (SDD 21.5).
 *
 * Retro-fitting lazy routes once the bundle is already over budget is far more
 * work than starting this way.
 */
const HomePage = lazy(() =>
  import('@/pages/HomePage').then((module) => ({ default: module.HomePage })),
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
  { path: '/', element: withBoundary(<HomePage />) },
  { path: '*', element: withBoundary(<NotFoundPage />) },
]);

export const AppRouter = (): JSX.Element => <RouterProvider router={router} />;
