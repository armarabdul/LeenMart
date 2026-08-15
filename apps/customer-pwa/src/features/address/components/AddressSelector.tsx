import { useState } from 'react';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useGetAddressesQuery } from '../address.api';
import { AddressForm } from './AddressForm';

interface AddressSelectorProps {
  readonly selectedAddressId: string | null;
  readonly onSelect: (addressId: string) => void;
}

const AddressSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-2">
    {Array.from({ length: 2 }, (_, index) => (
      <div key={index} className="h-16 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/**
 * Checkout's address step. Reuses the existing `/me/addresses` API — no
 * duplicate address model, no standalone address-book page (out of S3-3A's
 * scope; this selector is the only place addresses are managed today).
 */
export const AddressSelector = ({
  selectedAddressId,
  onSelect,
}: AddressSelectorProps): JSX.Element => {
  const { data: addresses, isLoading, isError, error } = useGetAddressesQuery();
  const [isAdding, setIsAdding] = useState(false);

  if (isLoading) {
    return <AddressSkeleton />;
  }

  if (isError || !addresses) {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        {apiErrorMessage(error, 'Your addresses could not be loaded. Please try again.')}
      </p>
    );
  }

  if (isAdding || addresses.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {addresses.length === 0 && (
          <p className="text-sm text-slate-600">
            You have no saved addresses yet — add one to continue.
          </p>
        )}
        <AddressForm
          onAdded={(addressId) => {
            onSelect(addressId);
            setIsAdding(false);
          }}
          onCancel={() => setIsAdding(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {addresses.map((address) => (
          <li key={address.id}>
            <label
              className={`flex cursor-pointer flex-col gap-1 rounded-md border p-3 text-sm ${
                selectedAddressId === address.id
                  ? 'border-brand-500 bg-brand-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="address"
                  checked={selectedAddressId === address.id}
                  onChange={() => onSelect(address.id)}
                />
                <span className="font-medium text-slate-900">{address.label}</span>
                {address.isDefault && (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
                    Default
                  </span>
                )}
              </span>
              <span className="pl-6 text-slate-600">
                {address.recipientName}, {address.line1}
                {address.line2 ? `, ${address.line2}` : ''}, {address.city}, {address.state}{' '}
                {address.pincode}
              </span>
              <span className="pl-6 text-slate-500">{address.phone}</span>
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setIsAdding(true)}
        className="self-start text-sm font-medium text-brand-700 hover:text-brand-600"
      >
        + Add a new address
      </button>
    </div>
  );
};
