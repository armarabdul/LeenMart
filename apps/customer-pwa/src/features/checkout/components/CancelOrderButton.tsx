import { useState } from 'react';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useCancelOrderMutation } from '../checkout.api';

interface CancelOrderButtonProps {
  readonly orderId: string;
}

/**
 * S3-4. The backend is the only authority on whether cancellation actually
 * succeeded — this component never flips a local "cancelled" flag itself.
 * `useCancelOrderMutation`'s own tag invalidation is what makes the page's
 * `useGetOrderQuery` refetch and show the real, backend-confirmed status;
 * this button only tracks its own click-to-response loading/error state.
 */
export const CancelOrderButton = ({ orderId }: CancelOrderButtonProps): JSX.Element => {
  const [cancelOrder, { isLoading, error }] = useCancelOrderMutation();
  const [hasErrored, setHasErrored] = useState(false);

  const handleCancel = async (): Promise<void> => {
    setHasErrored(false);
    try {
      await cancelOrder(orderId).unwrap();
    } catch {
      setHasErrored(true);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {hasErrored && (
        <p role="alert" className="text-sm text-red-700">
          {apiErrorMessage(error, 'This order could not be cancelled. Please try again.')}
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleCancel()}
        disabled={isLoading}
        className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {isLoading ? 'Cancelling…' : 'Cancel order'}
      </button>
    </div>
  );
};
