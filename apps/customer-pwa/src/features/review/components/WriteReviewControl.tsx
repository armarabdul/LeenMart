import { useRef, useState } from 'react';
import { reviewBodySchema } from '@leen-mart/contracts';
import { Alert, Button, Rating, Textarea } from '@leen-mart/ui';
import { useCreateReviewMutation, useGetMyReviewsQuery } from '../review.api';
import { apiErrorMessage, apiFieldErrors } from '@/shared/api/base-api';

interface ReviewFormProps {
  readonly orderItemId: string;
  /** The server accepted the review. Only this may move the control to its 'reviewed' state. */
  readonly onSubmitted: () => void;
  /** The reader backed out. Nothing was written, so the control must return to offering the form. */
  readonly onCancel: () => void;
}

const ReviewForm = ({ orderItemId, onSubmitted, onCancel }: ReviewFormProps): JSX.Element => {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [bodyTouched, setBodyTouched] = useState(false);
  const [createReview, { isLoading, error }] = useCreateReviewMutation();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // The exact schema `POST /me/reviews` validates the body with (Phase H) —
  // "write a few words" is never a guessed rule, and a 2000-character cap
  // can never quietly drift from what the server actually enforces.
  const bodyResult = reviewBodySchema.safeParse(body);
  const bodyLocalError = bodyResult.success ? undefined : bodyResult.error.issues[0]?.message;
  const serverFieldErrors = apiFieldErrors(error);
  const hasMappedServerError = Object.keys(serverFieldErrors).length > 0;
  const bodyError = (bodyTouched ? bodyLocalError : undefined) ?? serverFieldErrors.body;

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    if (isLoading) return;

    setBodyTouched(true);
    if (!bodyResult.success) {
      bodyRef.current?.focus();
      return;
    }

    void (async (): Promise<void> => {
      try {
        // `.unwrap()` throws on a rejected mutation, so `onSubmitted` is
        // reachable only after the server actually accepted the review.
        await createReview({ orderItemId, rating, body }).unwrap();
        onSubmitted();
      } catch {
        // Surfaced below via `error` from the mutation hook.
      }
    })();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 flex flex-col gap-2 rounded-card border border-border bg-surface-alt p-3"
      noValidate
    >
      <Rating value={rating} onChange={setRating} size="lg" />
      <Textarea
        ref={bodyRef}
        label="Your review"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onBlur={() => setBodyTouched(true)}
        placeholder="Share your experience with this product"
        rows={3}
        maxLength={2000}
        required
        error={bodyError}
      />
      {error && !hasMappedServerError && (
        <Alert tone="danger" className="text-xs">
          {apiErrorMessage(error, 'Your review could not be submitted. Please try again.')}
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={isLoading} disabled={!bodyResult.success}>
          {isLoading ? 'Submitting…' : 'Submit review'}
        </Button>
      </div>
    </form>
  );
};

interface WriteReviewControlProps {
  readonly orderItemId: string;
  /** Only `DELIVERED`/`COMPLETED` sub-orders make their items reviewable (S8-REVIEWS locked V1 scope). */
  readonly subOrderStatus: string;
}

/**
 * Per-order-item review affordance (S8-REVIEWS): "not reviewable yet",
 * "already reviewed" (any moderation status — the server, not this
 * component, decides what counts as a duplicate), or "write a review".
 *
 * `useGetMyReviewsQuery` is shared across every item on the page — RTK
 * Query deduplicates the request, so this costs one fetch, not one per item.
 */
export const WriteReviewControl = ({
  orderItemId,
  subOrderStatus,
}: WriteReviewControlProps): JSX.Element | null => {
  const [formOpen, setFormOpen] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const { data: myReviews } = useGetMyReviewsQuery();

  if (subOrderStatus !== 'DELIVERED' && subOrderStatus !== 'COMPLETED') {
    return null;
  }

  const existingReview = myReviews?.find((review) => review.orderItemId === orderItemId);

  if (existingReview || justSubmitted) {
    return <p className="mt-1 text-xs font-medium text-text-muted">You reviewed this item</p>;
  }

  if (formOpen) {
    return (
      <ReviewForm
        orderItemId={orderItemId}
        onSubmitted={() => {
          setFormOpen(false);
          setJustSubmitted(true);
        }}
        onCancel={() => setFormOpen(false)}
      />
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setFormOpen(true)}
      className="mt-1 -ml-2"
    >
      Write a review
    </Button>
  );
};
