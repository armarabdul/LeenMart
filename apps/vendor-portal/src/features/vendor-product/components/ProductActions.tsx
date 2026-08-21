import type { VendorProduct } from '@leen-mart/contracts';
import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';

const canSubmitForReview = (status: VendorProduct['status']): boolean =>
  status === 'DRAFT' || status === 'REJECTED';

interface ProductActionsProps {
  readonly status: VendorProduct['status'];
  readonly isSubmittingForReview: boolean;
  readonly submitError: unknown;
  readonly onSubmitForReview: () => void;
  readonly isDeleting: boolean;
  readonly deleteError: unknown;
  readonly onDelete: () => void;
}

/** The submit-for-review and delete buttons — split out of `VendorProductEditPage` purely to keep it within this repository's complexity budget. */
export const ProductActions = ({
  status,
  isSubmittingForReview,
  submitError,
  onSubmitForReview,
  isDeleting,
  deleteError,
  onDelete,
}: ProductActionsProps): JSX.Element => (
  <div className="flex flex-col gap-3 border-t border-border pt-6">
    {canSubmitForReview(status) && (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          loading={isSubmittingForReview}
          className="self-start"
          onClick={onSubmitForReview}
        >
          Submit for review
        </Button>
        {submitError !== undefined && (
          <Alert tone="danger">
            {apiErrorMessage(submitError, 'This product could not be submitted for review.')}
          </Alert>
        )}
      </div>
    )}

    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="secondary"
        loading={isDeleting}
        className="self-start text-danger hover:bg-danger/10"
        onClick={onDelete}
      >
        Delete product
      </Button>
      {deleteError !== undefined && (
        <Alert tone="danger">
          {apiErrorMessage(deleteError, 'This product could not be removed.')}
        </Alert>
      )}
    </div>
  </div>
);
