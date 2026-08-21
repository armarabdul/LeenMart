import type { RoleDto } from '@leen-mart/contracts';
import { Alert } from '@leen-mart/ui';
import { useAppSelector } from '@/app/hooks';
import { selectCurrentUser } from '@/shared/api/session.slice';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useGetShopProfileQuery } from '@/features/shop-profile/shop-profile.api';
import { BecomeVendorPrompt } from '@/features/vendor/components/BecomeVendorPrompt';
import { VendorStatusPanel } from '@/features/vendor/components/VendorStatusPanel';

/** Named predicates, not inline `&&`/`||` chains, purely to keep `OnboardingPage` within this repository's complexity budget. */
const isVendorRole = (role: RoleDto | undefined): boolean =>
  role !== undefined && role !== 'CUSTOMER';
const hasStatusLoadError = (
  isVendorAccount: boolean,
  isLoading: boolean,
  isError: boolean,
  profile: unknown,
): boolean => isVendorAccount && !isLoading && (isError || !profile);

const OnboardingSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading your vendor status">
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-16 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/**
 * The vendor's own onboarding/KYC surface (Phase J). Renders strictly from
 * `VendorProfile.status` as the backend reports it — every branch below is
 * one of the eight states `vendorStatusSchema` actually declares, and none
 * is invented.
 */
export const OnboardingPage = (): JSX.Element => {
  const user = useAppSelector(selectCurrentUser);
  const isVendorAccount = isVendorRole(user?.role);
  // Only fetched once the account is actually a vendor — `MANAGE_SHOP_PROFILE`
  // refuses a CUSTOMER role outright, so asking otherwise would just be an
  // expected 403 this page can skip entirely.
  const {
    data: profile,
    isLoading,
    isError,
    error,
  } = useGetShopProfileQuery(undefined, {
    skip: !isVendorAccount,
  });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Vendor onboarding</h1>
        <p className="text-sm text-slate-600">Your registration and KYC status.</p>
      </header>

      {!isVendorAccount && <BecomeVendorPrompt />}

      {isVendorAccount && isLoading && <OnboardingSkeleton />}

      {hasStatusLoadError(isVendorAccount, isLoading, isError, profile) && (
        <Alert tone="danger">
          {apiErrorMessage(error, 'Your vendor status could not be loaded.')}
        </Alert>
      )}

      {isVendorAccount && profile && <VendorStatusPanel profile={profile} />}
    </main>
  );
};
