import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/features/auth/RequireAuth';

/**
 * Route-level code splitting from the start (SDD 21.5).
 *
 * Retro-fitting lazy routes once the bundle is already over budget is far more
 * work than starting this way.
 */
const HomePage = lazy(() =>
  import('@/pages/HomePage').then((module) => ({ default: module.HomePage })),
);
const CataloguePage = lazy(() =>
  import('@/pages/CataloguePage').then((module) => ({ default: module.CataloguePage })),
);
const SearchPage = lazy(() =>
  import('@/pages/SearchPage').then((module) => ({ default: module.SearchPage })),
);
const ProductDetailPage = lazy(() =>
  import('@/pages/ProductDetailPage').then((module) => ({ default: module.ProductDetailPage })),
);
const CartPage = lazy(() =>
  import('@/pages/CartPage').then((module) => ({ default: module.CartPage })),
);
const CheckoutPage = lazy(() =>
  import('@/pages/CheckoutPage').then((module) => ({ default: module.CheckoutPage })),
);
const OrderConfirmationPage = lazy(() =>
  import('@/pages/OrderConfirmationPage').then((module) => ({
    default: module.OrderConfirmationPage,
  })),
);
const OrderHistoryPage = lazy(() =>
  import('@/pages/OrderHistoryPage').then((module) => ({ default: module.OrderHistoryPage })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })),
);
const RegisterPage = lazy(() =>
  import('@/pages/RegisterPage').then((module) => ({ default: module.RegisterPage })),
);
const LoginPage = lazy(() =>
  import('@/pages/LoginPage').then((module) => ({ default: module.LoginPage })),
);
const AccountPage = lazy(() =>
  import('@/pages/AccountPage').then((module) => ({ default: module.AccountPage })),
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
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: withBoundary(<HomePage />) },
      { path: '/catalogue', element: withBoundary(<CataloguePage />) },
      { path: '/catalogue/:slug', element: withBoundary(<CataloguePage />) },
      { path: '/search', element: withBoundary(<SearchPage />) },
      // Public: browsing a product never requires a session — only adding
      // it to the cart does (`AddToCartButton` handles that redirect itself).
      { path: '/products/:id', element: withBoundary(<ProductDetailPage />) },
      // `/cart` needs both `AppLayout`'s chrome and `RequireAuth`'s guard, so
      // `RequireAuth` nests here instead of standing alongside `AppLayout`
      // the way it does for `/account` below — that route deliberately keeps
      // its own separate, unwrapped presentation and is left untouched.
      {
        element: withBoundary(<RequireAuth />),
        children: [
          { path: '/cart', element: withBoundary(<CartPage />) },
          { path: '/checkout', element: withBoundary(<CheckoutPage />) },
          { path: '/orders', element: withBoundary(<OrderHistoryPage />) },
          { path: '/orders/:id', element: withBoundary(<OrderConfirmationPage />) },
        ],
      },
    ],
  },
  { path: '/register', element: withBoundary(<RegisterPage />) },
  { path: '/login', element: withBoundary(<LoginPage />) },
  {
    element: withBoundary(<RequireAuth />),
    children: [{ path: '/account', element: withBoundary(<AccountPage />) }],
  },
  { path: '*', element: withBoundary(<NotFoundPage />) },
]);

export const AppRouter = (): JSX.Element => <RouterProvider router={router} />;
