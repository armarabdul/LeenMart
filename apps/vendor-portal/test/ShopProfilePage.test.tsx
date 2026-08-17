import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createStore } from '@/app/store';
import { ShopProfilePage } from '@/pages/ShopProfilePage';
import {
  useGetBusinessHoursQuery,
  useGetServiceablePincodesQuery,
  useGetShopProfileQuery,
  useSetBusinessHoursMutation,
  useSetServiceablePincodesMutation,
  useSetShopAddressMutation,
} from '@/features/shop-profile/shop-profile.api';

vi.mock('@/features/shop-profile/shop-profile.api', () => ({
  useGetShopProfileQuery: vi.fn(),
  useSetShopAddressMutation: vi.fn(),
  useGetServiceablePincodesQuery: vi.fn(),
  useSetServiceablePincodesMutation: vi.fn(),
  useGetBusinessHoursQuery: vi.fn(),
  useSetBusinessHoursMutation: vi.fn(),
}));

const mockedUseGetShopProfileQuery = vi.mocked(useGetShopProfileQuery);
const mockedUseSetShopAddressMutation = vi.mocked(useSetShopAddressMutation);
const mockedUseGetServiceablePincodesQuery = vi.mocked(useGetServiceablePincodesQuery);
const mockedUseSetServiceablePincodesMutation = vi.mocked(useSetServiceablePincodesMutation);
const mockedUseGetBusinessHoursQuery = vi.mocked(useGetBusinessHoursQuery);
const mockedUseSetBusinessHoursMutation = vi.mocked(useSetBusinessHoursMutation);

/** S4-HOURS. Defaults keep every earlier expectation in this file unaffected. */
const setBusinessHours = vi.fn();
interface HoursStub {
  configured?: boolean;
  intervals?: { weekday: number; openMinute: number; closeMinute: number }[];
  closures?: { weekday: number | null; date: string | null }[];
}
const stubHours = (options: HoursStub = {}): void => {
  // Module-level spy shared across the file, so each render starts from zero
  // and an assertion is about *this* test rather than the suite's history.
  setBusinessHours.mockClear();
  mockedUseGetBusinessHoursQuery.mockReturnValue({
    data: {
      id: 'vendor-1',
      configured: options.configured ?? false,
      intervals: options.intervals ?? [],
      closures: options.closures ?? [],
    },
    isLoading: false,
    isError: false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetBusinessHoursQuery>);
  setBusinessHours.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  mockedUseSetBusinessHoursMutation.mockReturnValue([
    setBusinessHours,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useSetBusinessHoursMutation>);
};

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
  hours?: HoursStub;
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
  stubHours(options.hours);

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

// A sibling top-level block rather than a nested one: the file's outer describe
// would otherwise exceed this repository's function-length budget.
describe('ShopProfilePage — business hours (S4-HOURS)', () => {
  it('tells an unconfigured vendor they currently accept delivery at any time (H4-A)', () => {
    renderPage({ hours: { configured: false } });

    expect(
      screen.getByText(/you currently accept delivery orders at any time/i),
    ).toBeInTheDocument();
  });

  it('does not show that notice once hours are configured', () => {
    renderPage({
      hours: { configured: true, intervals: [{ weekday: 1, openMinute: 540, closeMinute: 1080 }] },
    });

    expect(
      screen.queryByText(/you currently accept delivery orders at any time/i),
    ).not.toBeInTheDocument();
  });

  it('states that hours are IST and that pickup is unaffected', () => {
    renderPage({});

    expect(screen.getByText(/All times are IST/)).toBeInTheDocument();
    expect(screen.getByText(/Pickup orders are never affected by these hours/)).toBeInTheDocument();
  });

  it('marks a weekday with no intervals as closed', () => {
    renderPage({});

    expect(screen.getByText(/Closed — no delivery on Monday/)).toBeInTheDocument();
  });

  it('prefills a stored interval as clock times', () => {
    renderPage({
      hours: { configured: true, intervals: [{ weekday: 1, openMinute: 540, closeMinute: 1080 }] },
    });

    expect(screen.getByLabelText('Monday opening time')).toHaveValue('09:00');
    expect(screen.getByLabelText('Monday closing time')).toHaveValue('18:00');
  });

  it('shows a recurring weekly holiday as checked and explains it', () => {
    renderPage({
      hours: {
        configured: true,
        intervals: [{ weekday: 0, openMinute: 0, closeMinute: 1440 }],
        closures: [{ weekday: 0, date: null }],
      },
    });

    expect(screen.getByText(/Closed every Sunday/)).toBeInTheDocument();
  });

  it('prefills dated closures, one per line', () => {
    renderPage({
      hours: {
        configured: true,
        closures: [
          { weekday: null, date: '2026-01-26' },
          { weekday: null, date: '2026-08-15' },
        ],
      },
    });

    expect(screen.getByLabelText(/Closure dates/)).toHaveValue(
      ['2026-01-26', '2026-08-15'].join(String.fromCharCode(10)),
    );
  });

  it('submits intervals as minutes since midnight, with both closure kinds', async () => {
    renderPage({
      hours: {
        configured: true,
        intervals: [{ weekday: 2, openMinute: 420, closeMinute: 660 }],
        closures: [{ weekday: 0, date: null }],
      },
    });

    fireEvent.change(screen.getByLabelText(/Closure dates/), {
      target: { value: '2026-01-26' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save business hours' }));

    expect(setBusinessHours).toHaveBeenCalledWith({
      intervals: [{ weekday: 2, openMinute: 420, closeMinute: 660 }],
      closures: [
        { weekday: 0, date: null },
        { weekday: null, date: '2026-01-26' },
      ],
    });
    // The mutation resolves after the click, and the success notice is the
    // observable end of that update — awaiting it keeps the state change
    // inside the test rather than leaking past it.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Business hours saved.'),
    );
  });

  it('refuses to submit an interval that closes before it opens', () => {
    renderPage({
      hours: { configured: true, intervals: [{ weekday: 1, openMinute: 540, closeMinute: 1080 }] },
    });

    fireEvent.change(screen.getByLabelText('Monday closing time'), { target: { value: '08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save business hours' }));

    expect(screen.getByText(/must be a valid time before its closing time/i)).toBeInTheDocument();
    expect(setBusinessHours).not.toHaveBeenCalled();
  });

  it('removes an interval, returning the day to closed', () => {
    renderPage({
      hours: { configured: true, intervals: [{ weekday: 1, openMinute: 540, closeMinute: 1080 }] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByText(/Closed — no delivery on Monday/)).toBeInTheDocument();
  });
});
