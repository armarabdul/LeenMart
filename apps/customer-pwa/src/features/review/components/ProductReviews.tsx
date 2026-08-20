import type { PublicReviewItem, ProductReviewSummary } from '@leen-mart/contracts';
import { useGetProductReviewsQuery } from '../review.api';
import { apiErrorMessage } from '@/shared/api/base-api';

const Stars = ({ rating }: { readonly rating: number }): JSX.Element => (
  <span aria-label={`${rating} out of 5 stars`} className="text-amber-500">
    {'★'.repeat(rating)}
    <span className="text-slate-300">{'★'.repeat(5 - rating)}</span>
  </span>
);

const SummaryLine = ({ summary }: { readonly summary: ProductReviewSummary }): JSX.Element => {
  if (summary.approvedReviewCount === 0 || summary.averageRating === null) {
    return <p className="text-sm text-slate-600">No reviews yet.</p>;
  }
  return (
    <p className="flex items-center gap-2 text-sm text-slate-700">
      <Stars rating={Math.round(summary.averageRating)} />
      <span className="font-medium text-slate-900">{summary.averageRating.toFixed(1)}</span>
      <span className="text-slate-500">
        ({summary.approvedReviewCount} review{summary.approvedReviewCount === 1 ? '' : 's'})
      </span>
    </p>
  );
};

const ReviewItem = ({ review }: { readonly review: PublicReviewItem }): JSX.Element => (
  <li className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4">
    <div className="flex items-center justify-between gap-3">
      <Stars rating={review.rating} />
      <time dateTime={review.createdAt} className="text-xs text-slate-500">
        {new Date(review.createdAt).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </time>
    </div>
    <p className="text-sm text-slate-700">{review.body}</p>
  </li>
);

/**
 * A product's approved reviews and rating summary (S8-REVIEWS). Simple
 * average and count only — no Bayesian weighting, no recency decay (deferred
 * requirements). No reviewer identity beyond what is shown here — locked V1
 * scope.
 */
export const ProductReviews = ({
  productId,
}: {
  readonly productId: string;
}): JSX.Element | null => {
  const { data, isLoading, isError, error } = useGetProductReviewsQuery(productId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-100" />
        <div className="h-16 w-full animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {apiErrorMessage(error, 'Reviews could not be loaded.')}
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-slate-900">Reviews</h2>
      <SummaryLine summary={data.summary} />
      {data.items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {data.items.map((review) => (
            <ReviewItem key={review.id} review={review} />
          ))}
        </ul>
      )}
    </section>
  );
};
