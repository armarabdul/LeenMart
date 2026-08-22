import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Skeleton } from '@leen-mart/ui';
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
const NotificationsPage = lazy(() =>
  import('@/pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })),
);
const PreorderCampaignsPage = lazy(() =>
  import('@/pages/PreorderCampaignsPage').then((module) => ({
    default: module.PreorderCampaignsPage,
  })),
);
const PreorderCampaignDetailPage = lazy(() =>
  import('@/pages/PreorderCampaignDetailPage').then((module) => ({
    default: module.PreorderCampaignDetailPage,
  })),
);
const MyReservationsPage = lazy(() =>
  import('@/pages/MyReservationsPage').then((module) => ({ default: module.MyReservationsPage })),
);
const ReservationDetailPage = lazy(() =>
  import('@/pages/ReservationDetailPage').then((module) => ({
    default: module.ReservationDetailPage,
  })),
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

/**
 * The suspense fallback shown while a lazy route chunk loads (Phase G).
 *
 * Deliberately generic and small — this appears between every route
 * transition, for every page, so it can't mimic any one page's layout
 * without being wrong for all the others. `aria-label` carries the "Loading"
 * announcement; there is no visible text to avoid a layout-shifting flash for
 * the common case where the chunk is already cached and this never gets a
 * chance to render for more than a frame.
 */
const RouteFallback = (): JSX.Element => (
  <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
    <Skeleton shape="circle" className="h-8 w-8" />
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
      // Public: browsing a campaign never requires a session — only
      // reserving against it does (`PreorderCampaignDetailPage` shows a
      // "log in to reserve" prompt itself rather than redirecting away).
      { path: '/preorders', element: withBoundary(<PreorderCampaignsPage />) },
      { path: '/preorders/:campaignId', element: withBoundary(<PreorderCampaignDetailPage />) },
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
          { path: '/my-reservations', element: withBoundary(<MyReservationsPage />) },
          {
            path: '/my-reservations/:reservationId',
            element: withBoundary(<ReservationDetailPage />),
          },
          { path: '/notifications', element: withBoundary(<NotificationsPage />) },
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
