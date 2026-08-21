import { useState } from 'react';
import { Alert, Badge, Button, Skeleton, cn } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useGetAddressesQuery } from '../address.api';
import { AddressForm } from './AddressForm';

interface AddressSelectorProps {
  readonly selectedAddressId: string | null;
  readonly onSelect: (addressId: string) => void;
}

const AddressSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading your addresses">
    {Array.from({ length: 2 }, (_, index) => (
      <Skeleton key={index} shape="rect" className="h-16 w-full" />
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
      <Alert tone="danger">
        {apiErrorMessage(error, 'Your addresses could not be loaded. Please try again.')}
      </Alert>
    );
  }

  if (isAdding || addresses.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {addresses.length === 0 && (
          <p className="text-sm text-text-muted">
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
        {addresses.map((address) => {
          const isSelected = selectedAddressId === address.id;
          return (
            <li key={address.id}>
              <label
                className={cn(
                  'flex cursor-pointer flex-col gap-1 rounded-card border p-3 text-sm transition-colors',
                  isSelected
                    ? 'border-primary bg-primary-soft'
                    : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="address"
                    checked={isSelected}
                    onChange={() => onSelect(address.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="font-medium text-text">{address.label}</span>
                  {address.isDefault && <Badge>Default</Badge>}
                </span>
                <span className="pl-6 text-text-muted">
                  {address.recipientName}, {address.line1}
                  {address.line2 ? `, ${address.line2}` : ''}, {address.city}, {address.state}{' '}
                  {address.pincode}
                </span>
                <span className="pl-6 text-text-faint">{address.phone}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setIsAdding(true)}
        className="self-start -ml-2"
      >
        + Add a new address
      </Button>
    </div>
  );
};
