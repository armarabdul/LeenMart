import type { JSX } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { selectIsAuthenticated } from '@/shared/api/session.slice';

/**
 * Route guard, mirroring `customer-pwa`'s own `RequireAuth` exactly —
 * authentication only. Whether the signed-in account is actually a vendor
 * (and an ACTIVE one) is the backend's job: `VIEW_VENDOR_ORDERS`/
 * `ACCEPT_OR_REJECT_ORDER` refuse a non-vendor role, and
 * `requireActiveVendor` refuses a vendor who isn't ACTIVE — both surface as
 * an honest error on the page rather than this guard silently guessing who
 * is allowed in.
 */
export const RequireAuth = (): JSX.Element => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
};
