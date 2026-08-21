import type { AdminReviewQueueItem } from '@leen-mart/contracts';
import { Alert, Button, StatusBadge } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useDecideReviewMutation } from '../review-moderation.api';
import { REVIEW_STATUS_LABEL } from '../lib/review-status-label';
import { REVIEW_STATUS_TONE } from '../lib/review-status-tone';

interface ReviewQueueRowProps {
  readonly item: AdminReviewQueueItem;
}

/**
 * Full row detail (there is no separate review detail page — the queue item
 * already carries everything the backend read model exposes, per
 * `adminReviewQueueItemSchema`'s own doc comment) with inline decide
 * actions. `HIDDEN` → `APPROVE` is how a review is restored; the backend
 * defines no separate `RESTORE` verb, so none is offered here.
 */
export const ReviewQueueRow = ({ item }: ReviewQueueRowProps): JSX.Element => {
  const [decideReview, { isLoading, error }] = useDecideReviewMutation();

  const decide = (decision: 'APPROVE' | 'HIDE'): void => {
    void decideReview({ reviewId: item.id, body: { decision } });
  };

  return (
    <li className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-text">Rating {item.rating} / 5</p>
        <StatusBadge
          tone={REVIEW_STATUS_TONE[item.status]}
          label={REVIEW_STATUS_LABEL[item.status]}
        />
      </div>

      <p className="text-sm text-text">{item.body}</p>

      <dl className="grid grid-cols-1 gap-1 text-xs text-text-muted sm:grid-cols-3">
        <div>
          <dt className="inline">Customer: </dt>
          <dd className="inline">{item.customerId}</dd>
        </div>
        <div>
          <dt className="inline">Product: </dt>
          <dd className="inline">{item.productId}</dd>
        </div>
        <div>
          <dt className="inline">Variant: </dt>
          <dd className="inline">{item.variantId}</dd>
        </div>
      </dl>

      {error !== undefined && (
        <Alert tone="danger">{apiErrorMessage(error, 'The decision could not be saved.')}</Alert>
      )}

      <div className="flex flex-wrap gap-2">
        {item.status !== 'APPROVED' && (
          <Button type="button" loading={isLoading} onClick={() => decide('APPROVE')}>
            Approve
          </Button>
        )}
        {item.status !== 'HIDDEN' && (
          <Button type="button" variant="danger" loading={isLoading} onClick={() => decide('HIDE')}>
            Hide
          </Button>
        )}
      </div>
    </li>
  );
};
