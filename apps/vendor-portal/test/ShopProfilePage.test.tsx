import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createStore } from '@/app/store';
import { ShopProfilePage } from '@/pages/ShopProfilePage';
import {
  useGetShopProfileQuery,
  useSetShopAddressMutation,
} from '@/features/shop-profile/shop-profile.api';

vi.mock('@/features/shop-profile/shop-profile.api', () => ({
  useGetShopProfileQuery: vi.fn(),
  useSetShopAddressMutation: vi.fn(),
}));

const mockedUseGetShopProfileQuery = vi.mocked(useGetShopProfileQuery);
const mockedUseSetShopAddressMutation = vi.mocked(useSetShopAddressMutation);

const ADDRESS = {
  line1: '12 Market Road',
  line2: 'Near the clock tower',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

const PROFILE = {
  id: 'vendor-1',
  status: 'ACTIVE' as const,
  shopName: 'FreshMart',
  supportsPickup: true,
  shopAddress: null as typeof ADDRESS | null,
};

const renderPage = (options: {
  profile?: typeof PROFILE;
  isLoading?: boolean;
  isError?: boolean;
  saveRejects?: boolean;
}): { setShopAddress: ReturnType<typeof vi.fn> } => {
  mockedUseGetShopProfileQuery.mockReturnValue({
    data: options.isError === true ? undefined : (options.profile ?? PROFILE),
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetShopProfileQuery>);

  const setShopAddress = vi.fn().mockReturnValue({
    unwrap: () =>
      options.saveRejects === true
        ? Promise.reject(Object.assign(new Error('nope'), { status: 400 }))
        : Promise.resolve(PROFILE),
  });
  mockedUseSetShopAddressMutation.mockReturnValue([
    setShopAddress,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useSetShopAddressMutation>);

  render(
    <Provider store={createStore()}>
      <ShopProfilePage />
    </Provider>,
  );
  return { setShopAddress };
};

const fill = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(new RegExp(label), { selector: 'input' }), {
    target: { value },
  });
};

describe('ShopProfilePage', () => {
  it('shows a loading state before the profile arrives', () => {
    renderPage({ isLoading: true });

    expect(screen.getByRole('heading', { name: 'Shop profile' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save shop address/ })).not.toBeInTheDocument();
  });

  it('surfaces a load failure without an empty form', () => {
    renderPage({ isError: true });

    expect(screen.getByRole('alert')).toHaveTextContent('Your shop profile could not be loaded.');
    expect(screen.queryByRole('button', { name: /Save shop address/ })).not.toBeInTheDocument();
  });

  it('starts empty for a vendor who has set no address', () => {
    renderPage({});

    expect(screen.getByLabelText(/Address line 1/, { selector: 'input' })).toHaveValue('');
  });

  it('prefills every field from the stored address', () => {
    renderPage({ profile: { ...PROFILE, shopAddress: ADDRESS } });

    expect(screen.getByLabelText(/Address line 1/, { selector: 'input' })).toHaveValue(
      ADDRESS.line1,
    );
    expect(screen.getByLabelText(/Address line 2/, { selector: 'input' })).toHaveValue(
      ADDRESS.line2,
    );
    expect(screen.getByLabelText(/City/, { selector: 'input' })).toHaveValue(ADDRESS.city);
    expect(screen.getByLabelText(/State/, { selector: 'input' })).toHaveValue(ADDRESS.state);
    expect(screen.getByLabelText(/Pincode/, { selector: 'input' })).toHaveValue(ADDRESS.pincode);
  });

  it('submits the whole address, sending null for an empty optional line', () => {
    const { setShopAddress } = renderPage({});

    fill('Address line 1', ADDRESS.line1);
    fill('City', ADDRESS.city);
    fill('State', ADDRESS.state);
    fill('Pincode', ADDRESS.pincode);
    fireEvent.click(screen.getByRole('button', { name: 'Save shop address' }));

    expect(setShopAddress).toHaveBeenCalledWith({
      line1: ADDRESS.line1,
      line2: null,
      city: ADDRESS.city,
      state: ADDRESS.state,
      pincode: ADDRESS.pincode,
    });
  });

  it('confirms a successful save', async () => {
    renderPage({ profile: { ...PROFILE, shopAddress: ADDRESS } });

    fireEvent.click(screen.getByRole('button', { name: 'Save shop address' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Shop address saved.'),
    );
  });

  it('reports a failed save without claiming it succeeded', async () => {
    renderPage({ profile: { ...PROFILE, shopAddress: ADDRESS }, saveRejects: true });

    fireEvent.click(screen.getByRole('button', { name: 'Save shop address' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Your shop address could not be saved.'),
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('tells the vendor that editing does not affect existing orders', () => {
    renderPage({});

    expect(
      screen.getByText(/Changing it here does not affect orders that have already been placed/),
    ).toBeInTheDocument();
  });
});
