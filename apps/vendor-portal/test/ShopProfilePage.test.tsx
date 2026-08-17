import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createStore } from '@/app/store';
import { ShopProfilePage } from '@/pages/ShopProfilePage';
import {
  useGetServiceablePincodesQuery,
  useGetShopProfileQuery,
  useSetServiceablePincodesMutation,
  useSetShopAddressMutation,
} from '@/features/shop-profile/shop-profile.api';

vi.mock('@/features/shop-profile/shop-profile.api', () => ({
  useGetShopProfileQuery: vi.fn(),
  useSetShopAddressMutation: vi.fn(),
  useGetServiceablePincodesQuery: vi.fn(),
  useSetServiceablePincodesMutation: vi.fn(),
}));

const mockedUseGetShopProfileQuery = vi.mocked(useGetShopProfileQuery);
const mockedUseSetShopAddressMutation = vi.mocked(useSetShopAddressMutation);
const mockedUseGetServiceablePincodesQuery = vi.mocked(useGetServiceablePincodesQuery);
const mockedUseSetServiceablePincodesMutation = vi.mocked(useSetServiceablePincodesMutation);

/** S4-SERV. Defaults keep every S4-ADDR expectation in this file unaffected. */
const setServiceablePincodes = vi.fn();
const stubPincodes = (options: { configured?: boolean; pincodes?: string[] } = {}): void => {
  mockedUseGetServiceablePincodesQuery.mockReturnValue({
    data: {
      id: 'vendor-1',
      configured: options.configured ?? false,
      pincodes: options.pincodes ?? [],
    },
    isLoading: false,
    isError: false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetServiceablePincodesQuery>);
  setServiceablePincodes.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  mockedUseSetServiceablePincodesMutation.mockReturnValue([
    setServiceablePincodes,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useSetServiceablePincodesMutation>);
};

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
  pincodes?: { configured?: boolean; pincodes?: string[] };
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

  stubPincodes(options.pincodes);

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
  describe('delivery areas (S4-SERV)', () => {
    it('tells an unconfigured vendor they currently deliver everywhere', () => {
      renderPage({ pincodes: { configured: false, pincodes: [] } });

      expect(
        screen.getByText(/you currently receive delivery orders from everywhere/i),
      ).toBeInTheDocument();
    });

    it('does not show the everywhere notice once pincodes are configured', () => {
      renderPage({ pincodes: { configured: true, pincodes: ['560001'] } });

      expect(
        screen.queryByText(/you currently receive delivery orders from everywhere/i),
      ).not.toBeInTheDocument();
    });

    it('prefills the stored pincodes, one per line', () => {
      renderPage({ pincodes: { configured: true, pincodes: ['560001', '560002'] } });

      expect(screen.getByLabelText(/Delivery pincodes/)).toHaveValue(
        ['560001', '560002'].join('\n'),
      );
    });

    it('submits pincodes parsed from newlines, commas and stray spaces', () => {
      renderPage({});

      fireEvent.change(screen.getByLabelText(/Delivery pincodes/), {
        // Newline, comma and stray spaces all in one paste.
        target: { value: ['560001, 560002', ' 560003 '].join('\n') },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save delivery areas' }));

      expect(setServiceablePincodes).toHaveBeenCalledWith({
        pincodes: ['560001', '560002', '560003'],
      });
    });

    it('submits an empty set when the box is cleared', () => {
      renderPage({ pincodes: { configured: true, pincodes: ['560001'] } });

      fireEvent.change(screen.getByLabelText(/Delivery pincodes/), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save delivery areas' }));

      expect(setServiceablePincodes).toHaveBeenCalledWith({ pincodes: [] });
    });

    it('states that pickup orders are unaffected', () => {
      renderPage({});

      expect(screen.getByText(/Pickup orders are never affected by this list/)).toBeInTheDocument();
    });
  });
});
