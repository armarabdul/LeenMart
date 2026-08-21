import { Navigate } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { selectCurrentUser } from '@/shared/api/session.slice';
import { useGetShopProfileQuery } from '@/features/shop-profile/shop-profile.api';

/**
 * `/` (Phase J) — sends a signed-in vendor to the surface that actually
 * matches their real status, rather than always assuming `/orders` (which
 * `requireActiveVendor` refuses for anyone not yet `ACTIVE`). A CUSTOMER who
 * has not yet called `POST /vendors` goes to onboarding too, where that is
 * offered.
 */
export const HomeRedirect = (): JSX.Element => {
  const user = useAppSelector(selectCurrentUser);
  const isVendorAccount = user?.role !== undefined && user.role !== 'CUSTOMER';
  const { data: profile, isLoading } = useGetShopProfileQuery(undefined, {
    skip: !isVendorAccount,
  });

  if (!isVendorAccount) return <Navigate to="/onboarding" replace />;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  return <Navigate to={profile?.status === 'ACTIVE' ? '/orders' : '/onboarding'} replace />;
};
