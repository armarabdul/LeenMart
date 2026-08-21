import { Alert } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';

/** The save outcome for one stock update — split out of `VariantInventoryEditor` purely to keep it within this repository's complexity budget. */
export const InventorySaveFeedback = ({
  saveError,
  isVersionConflict,
  saved,
}: {
  readonly saveError: unknown;
  readonly isVersionConflict: boolean;
  readonly saved: boolean;
}): JSX.Element | null => {
  if (saveError !== undefined) {
    return (
      <Alert tone="danger" className="w-full">
        {isVersionConflict
          ? 'This stock figure changed since it was loaded. Refresh to see the latest value.'
          : apiErrorMessage(saveError, 'Stock could not be updated.')}
      </Alert>
    );
  }
  if (saved) {
    return (
      <Alert tone="success" className="w-full">
        Stock updated.
      </Alert>
    );
  }
  return null;
};
