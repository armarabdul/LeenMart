import { useState } from 'react';
import { Alert, Button } from '@leen-mart/ui';
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
        <Alert tone="danger">
          {apiErrorMessage(error, 'This order could not be cancelled. Please try again.')}
        </Alert>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => void handleCancel()}
        disabled={isLoading}
        loading={isLoading}
        className="min-h-11 border-danger/40 text-danger hover:bg-danger/10"
      >
        {isLoading ? 'Cancelling…' : 'Cancel order'}
      </Button>
    </div>
  );
};
