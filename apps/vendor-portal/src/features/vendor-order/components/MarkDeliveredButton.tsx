import { useState } from 'react';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useDeliverSubOrderMutation } from '../vendor-order.api';

interface MarkDeliveredButtonProps {
  readonly subOrderId: string;
}

/**
 * Mirrors `StartProcessingButton`/`MarkShippedButton` exactly (S3-6): the
 * backend is the only authority on whether SHIPPED -> DELIVERED actually
 * succeeded — this component never flips a local status flag itself.
 */
export const MarkDeliveredButton = ({ subOrderId }: MarkDeliveredButtonProps): JSX.Element => {
  const [deliverSubOrder, { isLoading, error }] = useDeliverSubOrderMutation();
  const [hasErrored, setHasErrored] = useState(false);

  const handleDeliver = async (): Promise<void> => {
    setHasErrored(false);
    try {
      await deliverSubOrder(subOrderId).unwrap();
    } catch {
      setHasErrored(true);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {hasErrored && (
        <p role="alert" className="text-sm text-red-700">
          {apiErrorMessage(error, 'This order could not be marked delivered. Please try again.')}
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleDeliver()}
        disabled={isLoading}
        className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {isLoading ? 'Marking delivered…' : 'Mark delivered'}
      </button>
    </div>
  );
};
