import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { AddressResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { AddressSelector } from '@/features/address/components/AddressSelector';
import { useAddAddressMutation, useGetAddressesQuery } from '@/features/address/address.api';

vi.mock('@/features/address/address.api', () => ({
  useGetAddressesQuery: vi.fn(),
  useAddAddressMutation: vi.fn(),
}));

const mockedUseGetAddressesQuery = vi.mocked(useGetAddressesQuery);
const mockedUseAddAddressMutation = vi.mocked(useAddAddressMutation);

const address = (overrides: Partial<AddressResponse> = {}): AddressResponse => ({
  id: 'address-1',
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  landmark: null,
  label: 'Home',
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderSelector = (
  addresses: AddressResponse[] | undefined,
  options: { isLoading?: boolean; isError?: boolean } = {},
): { onSelect: ReturnType<typeof vi.fn>; addAddress: ReturnType<typeof vi.fn> } => {
  const onSelect = vi.fn();
  const addAddress = vi.fn();

  mockedUseGetAddressesQuery.mockReturnValue({
    data: addresses,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetAddressesQuery>);
  mockedUseAddAddressMutation.mockReturnValue([
    addAddress,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useAddAddressMutation>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <AddressSelector selectedAddressId={null} onSelect={onSelect} />
      </MemoryRouter>
    </Provider>,
  );

  return { onSelect, addAddress };
};

describe('AddressSelector', () => {
  it('shows an error state when addresses cannot be loaded', () => {
    renderSelector(undefined, { isError: true });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('goes straight to the add-address form when the caller has no saved addresses', () => {
    renderSelector([]);

    expect(
      screen.getByText('You have no saved addresses yet — add one to continue.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save address' })).toBeInTheDocument();
  });

  it('lists saved addresses with the default one marked', () => {
    renderSelector([address(), address({ id: 'address-2', label: 'Office', isDefault: false })]);

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Office')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('calls onSelect when a saved address is chosen', () => {
    const { onSelect } = renderSelector([address()]);

    fireEvent.click(screen.getByRole('radio'));

    expect(onSelect).toHaveBeenCalledWith('address-1');
  });

  it('reveals the add-address form on demand even with existing addresses', () => {
    renderSelector([address()]);

    fireEvent.click(screen.getByText('+ Add a new address'));

    expect(screen.getByRole('button', { name: 'Save address' })).toBeInTheDocument();
  });

  it('selects the newly created address and closes the form on success', async () => {
    const { onSelect, addAddress } = renderSelector([]);
    addAddress.mockReturnValue({ unwrap: () => Promise.resolve(address({ id: 'address-new' })) });

    fireEvent.change(screen.getByLabelText('Recipient name'), { target: { value: 'Asha Rao' } });
    fireEvent.change(screen.getByLabelText('Phone (+91XXXXXXXXXX)'), {
      target: { value: '+919876543210' },
    });
    fireEvent.change(screen.getByLabelText('Address line 1'), {
      target: { value: '221B Baker Street' },
    });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Bengaluru' } });
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Karnataka' } });
    fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '560001' } });
    fireEvent.change(screen.getByLabelText('Label (e.g. Home, Office)'), {
      target: { value: 'Home' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith('address-new'));
  });
});
