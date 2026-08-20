import { useState } from 'react';
import { useCreateReviewMutation, useGetMyReviewsQuery } from '../review.api';
import { apiErrorMessage } from '@/shared/api/base-api';

const RATINGS = [1, 2, 3, 4, 5] as const;

const RatingPicker = ({
  value,
  onChange,
}: {
  readonly value: number;
  readonly onChange: (rating: number) => void;
}): JSX.Element => (
  <div role="radiogroup" aria-label="Rating" className="flex gap-1">
    {RATINGS.map((rating) => (
      <button
        key={rating}
        type="button"
        role="radio"
        aria-checked={value === rating}
        aria-label={`${rating} star${rating === 1 ? '' : 's'}`}
        onClick={() => onChange(rating)}
        className={`text-2xl leading-none ${rating <= value ? 'text-amber-500' : 'text-slate-300'}`}
      >
        ★
      </button>
    ))}
  </div>
);

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
  const [createReview, { isLoading, error }] = useCreateReviewMutation();

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
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
      className="mt-2 flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-3"
    >
      <RatingPicker value={rating} onChange={setRating} />
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Share your experience with this product"
        rows={3}
        maxLength={2000}
        required
        className="w-full rounded-md border border-slate-300 p-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {apiErrorMessage(error, 'Your review could not be submitted. Please try again.')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading || body.trim().length === 0}
          className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {isLoading ? 'Submitting…' : 'Submit review'}
        </button>
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
    return <p className="mt-1 text-xs font-medium text-slate-500">You reviewed this item</p>;
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
    <button
      type="button"
      onClick={() => setFormOpen(true)}
      className="mt-1 text-xs font-medium text-brand-700 hover:text-brand-600"
    >
      Write a review
    </button>
  );
};
