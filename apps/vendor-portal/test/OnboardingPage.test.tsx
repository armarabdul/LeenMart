import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { VendorShopAddressResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { OnboardingPage } from '@/pages/OnboardingPage';
import { sessionEstablished } from '@/shared/api/session.slice';
import { useGetShopProfileQuery } from '@/features/shop-profile/shop-profile.api';
import { useRegisterVendorMutation } from '@/features/vendor/vendor.api';
import { useCreateKycUploadIntentMutation, useSubmitKycMutation } from '@/features/vendor/kyc.api';

vi.mock('@/features/shop-profile/shop-profile.api', () => ({
  useGetShopProfileQuery: vi.fn(),
}));
vi.mock('@/features/vendor/vendor.api', () => ({ useRegisterVendorMutation: vi.fn() }));
vi.mock('@/features/vendor/kyc.api', () => ({
  useCreateKycUploadIntentMutation: vi.fn(),
  useSubmitKycMutation: vi.fn(),
}));

const mockedUseGetShopProfileQuery = vi.mocked(useGetShopProfileQuery);
const mockedUseRegisterVendorMutation = vi.mocked(useRegisterVendorMutation);
const mockedUseCreateKycUploadIntentMutation = vi.mocked(useCreateKycUploadIntentMutation);
const mockedUseSubmitKycMutation = vi.mocked(useSubmitKycMutation);

const PROFILE: VendorShopAddressResponse = {
  id: 'vendor-1',
  status: 'REGISTERED',
  shopName: null,
  supportsPickup: false,
  shopAddress: null,
};

const stubMutations = (): void => {
  mockedUseRegisterVendorMutation.mockReturnValue([
    vi.fn(),
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useRegisterVendorMutation>);
  mockedUseCreateKycUploadIntentMutation.mockReturnValue([
    vi.fn(),
    { error: undefined },
  ] as unknown as ReturnType<typeof useCreateKycUploadIntentMutation>);
  mockedUseSubmitKycMutation.mockReturnValue([
    vi.fn(),
    { error: undefined },
  ] as unknown as ReturnType<typeof useSubmitKycMutation>);
};

const renderPage = (
  options: {
    profile?: Partial<VendorShopAddressResponse>;
    isLoading?: boolean;
    isError?: boolean;
    isVendorAccount?: boolean;
  } = {},
): void => {
  stubMutations();
  mockedUseGetShopProfileQuery.mockReturnValue({
    data:
      options.isError === true || options.isLoading === true
        ? undefined
        : { ...PROFILE, ...options.profile },
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetShopProfileQuery>);

  const store = createStore();
  if (options.isVendorAccount !== false) {
    store.dispatch(
      sessionEstablished({
        user: { id: 'user-1', role: 'VENDOR_OWNER', email: 'vendor@example.com' },
        accessToken: 'token',
        accessTokenExpiresAt: '2026-01-01T01:00:00.000Z',
        refreshToken: 'refresh',
        refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
      }),
    );
  } else {
    store.dispatch(
      sessionEstablished({
        user: { id: 'user-1', role: 'CUSTOMER', email: 'shopper@example.com' },
        accessToken: 'token',
        accessTokenExpiresAt: '2026-01-01T01:00:00.000Z',
        refreshToken: 'refresh',
        refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
      }),
    );
  }

  render(
    <Provider store={store}>
      <MemoryRouter>
        <OnboardingPage />
      </MemoryRouter>
    </Provider>,
  );
};

describe('OnboardingPage', () => {
  it('offers to become a vendor for a signed-in customer account', () => {
    renderPage({ isVendorAccount: false });

    expect(screen.getByText("You're not a vendor yet")).toBeInTheDocument();
    expect(mockedUseGetShopProfileQuery).toHaveBeenCalledWith(undefined, { skip: true });
  });

  it('shows a loading skeleton while the vendor profile loads', () => {
    renderPage({ isLoading: true });

    expect(screen.getByRole('heading', { name: 'Vendor onboarding' })).toBeInTheDocument();
    expect(screen.queryByText(/Vendor status/)).not.toBeInTheDocument();
  });

  it('surfaces a load failure', () => {
    renderPage({ isError: true });

    expect(screen.getByRole('alert')).toHaveTextContent('Your vendor status could not be loaded.');
  });

  it('shows the KYC submission form for a REGISTERED vendor', () => {
    renderPage({ profile: { status: 'REGISTERED' } });

    expect(screen.getByLabelText('PAN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument();
  });

  it('shows a review notice for KYC_SUBMITTED, with no submission form', () => {
    renderPage({ profile: { status: 'KYC_SUBMITTED' } });

    expect(screen.getByText(/being reviewed/)).toBeInTheDocument();
    expect(screen.queryByLabelText('PAN')).not.toBeInTheDocument();
  });

  it('shows the same review notice for KYC_UNDER_REVIEW', () => {
    renderPage({ profile: { status: 'KYC_UNDER_REVIEW' } });

    expect(screen.getByText(/being reviewed/)).toBeInTheDocument();
  });

  it('shows a rejection alert and offers resubmission for KYC_REJECTED', () => {
    renderPage({ profile: { status: 'KYC_REJECTED' } });

    expect(screen.getByText('Your KYC submission was rejected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resubmit for review' })).toBeInTheDocument();
  });

  it('tells an approved vendor that activation is pending', () => {
    renderPage({ profile: { status: 'KYC_APPROVED' } });

    expect(
      screen.getByText(/An administrator will activate your shop shortly/),
    ).toBeInTheDocument();
  });

  it('links an ACTIVE vendor to their products', () => {
    renderPage({ profile: { status: 'ACTIVE' } });

    expect(screen.getByText(/Your shop is active/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'products' })).toHaveAttribute('href', '/products');
  });

  it('shows a contact-support notice for a SUSPENDED vendor', () => {
    renderPage({ profile: { status: 'SUSPENDED' } });

    expect(screen.getByText(/Contact support/)).toBeInTheDocument();
  });

  it('shows a contact-support notice for a TERMINATED vendor', () => {
    renderPage({ profile: { status: 'TERMINATED' } });

    expect(screen.getByText(/Contact support/)).toBeInTheDocument();
  });

  it('shows the vendor status badge with the shop name', () => {
    renderPage({ profile: { status: 'ACTIVE', shopName: 'FreshMart' } });

    expect(screen.getByText('FreshMart')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
