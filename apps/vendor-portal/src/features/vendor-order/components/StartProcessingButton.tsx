import { useState } from 'react';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useStartProcessingMutation } from '../vendor-order.api';

interface StartProcessingButtonProps {
  readonly subOrderId: string;
}

/**
 * Mirrors `customer-pwa`'s own `CancelOrderButton` exactly: the backend is
 * the only authority on whether the transition actually succeeded — this
 * component never flips a local "processing" flag itself.
 * `useStartProcessingMutation`'s own tag invalidation is what makes the
 * page's `useGetVendorOrderQuery` refetch and show the real,
 * backend-confirmed status; this button only tracks its own
 * click-to-response loading/error state.
 */
export const StartProcessingButton = ({ subOrderId }: StartProcessingButtonProps): JSX.Element => {
  const [startProcessing, { isLoading, error }] = useStartProcessingMutation();
  const [hasErrored, setHasErrored] = useState(false);

  const handleStart = async (): Promise<void> => {
    setHasErrored(false);
    try {
      await startProcessing(subOrderId).unwrap();
    } catch {
      setHasErrored(true);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {hasErrored && (
        <p role="alert" className="text-sm text-red-700">
          {apiErrorMessage(error, 'This order could not be started. Please try again.')}
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleStart()}
        disabled={isLoading}
        className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {isLoading ? 'Starting…' : 'Start processing'}
      </button>
    </div>
  );
};
