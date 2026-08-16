import { useState } from 'react';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useShipSubOrderMutation } from '../vendor-order.api';

interface MarkShippedButtonProps {
  readonly subOrderId: string;
}

/**
 * Mirrors `StartProcessingButton` exactly (S3-6): the backend is the only
 * authority on whether PROCESSING -> SHIPPED actually succeeded — this
 * component never flips a local status flag itself.
 */
export const MarkShippedButton = ({ subOrderId }: MarkShippedButtonProps): JSX.Element => {
  const [shipSubOrder, { isLoading, error }] = useShipSubOrderMutation();
  const [hasErrored, setHasErrored] = useState(false);

  const handleShip = async (): Promise<void> => {
    setHasErrored(false);
    try {
      await shipSubOrder(subOrderId).unwrap();
    } catch {
      setHasErrored(true);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {hasErrored && (
        <p role="alert" className="text-sm text-red-700">
          {apiErrorMessage(error, 'This order could not be marked shipped. Please try again.')}
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleShip()}
        disabled={isLoading}
        className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {isLoading ? 'Marking shipped…' : 'Mark shipped'}
      </button>
    </div>
  );
};
