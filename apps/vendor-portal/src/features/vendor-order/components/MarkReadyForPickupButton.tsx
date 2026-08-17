import { useState } from 'react';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useMarkReadyForPickupMutation } from '../vendor-order.api';

interface MarkReadyForPickupButtonProps {
  readonly subOrderId: string;
}

/**
 * Mirrors `MarkShippedButton` exactly (S4-QR) — the pickup-mode analogue of
 * PROCESSING -> SHIPPED. The backend is the only authority on whether the
 * transition succeeded; this component never flips a local status itself,
 * and the mutation's tag invalidation is what refetches the authoritative
 * sub-order.
 */
export const MarkReadyForPickupButton = ({
  subOrderId,
}: MarkReadyForPickupButtonProps): JSX.Element => {
  const [markReadyForPickup, { isLoading, error }] = useMarkReadyForPickupMutation();
  const [hasErrored, setHasErrored] = useState(false);

  const handleReady = async (): Promise<void> => {
    setHasErrored(false);
    try {
      await markReadyForPickup(subOrderId).unwrap();
    } catch {
      setHasErrored(true);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {hasErrored && (
        <p role="alert" className="text-sm text-red-700">
          {apiErrorMessage(
            error,
            'This order could not be marked ready for pickup. Please try again.',
          )}
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleReady()}
        disabled={isLoading}
        className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {isLoading ? 'Marking ready…' : 'Mark ready for pickup'}
      </button>
    </div>
  );
};
