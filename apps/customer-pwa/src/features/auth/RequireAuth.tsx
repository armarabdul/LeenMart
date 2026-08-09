import type { JSX } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { selectIsAuthenticated } from '@/shared/api/session.slice';

/**
 * Route guard for the protected customer area (Milestone 3 Step 1).
 *
 * Not lazy-loaded like the pages it guards: it decides where the router
 * sends the customer, so it needs to be available immediately rather than
 * behind its own loading state.
 */
export const RequireAuth = (): JSX.Element => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
};
