import type { JSX } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { selectIsAuthenticated } from '@/shared/api/session.slice';

/**
 * Route guard, mirroring `vendor-portal`'s own `RequireAuth` exactly —
 * authentication only. Whether the signed-in account actually holds the
 * permission a given screen needs is the backend's job
 * (`requirePermission`/`requireFullAccess`) — this guard's only claim is
 * "a session exists," never "this session may do X." Frontend guards are
 * UX only (L2/L8): the true enforcement lives entirely server-side, and a
 * caller lacking a permission still reaches the page and gets an honest
 * 403 from the API a screen renders as a message, never a silent redirect
 * that pretends the capability was never offered.
 */
export const RequireAuth = (): JSX.Element => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
};
