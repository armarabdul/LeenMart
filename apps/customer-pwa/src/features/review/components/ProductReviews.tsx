import type { PublicReviewItem, ProductReviewSummary } from '@leen-mart/contracts';
import { Alert, Badge, Card, Rating, Skeleton } from '@leen-mart/ui';
import { useGetProductReviewsQuery } from '../review.api';
import { apiErrorMessage } from '@/shared/api/base-api';

const SummaryLine = ({ summary }: { readonly summary: ProductReviewSummary }): JSX.Element => {
  if (summary.approvedReviewCount === 0 || summary.averageRating === null) {
    return <p className="text-sm text-text-muted">No reviews yet.</p>;
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
      <Rating value={Math.round(summary.averageRating)} size="sm" />
      <span className="text-base font-semibold text-text">{summary.averageRating.toFixed(1)}</span>
      <span>
        ({summary.approvedReviewCount} review{summary.approvedReviewCount === 1 ? '' : 's'})
      </span>
    </p>
  );
};

const formatReviewDate = (isoDateTime: string): string =>
  new Date(isoDateTime).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const ReviewItem = ({ review }: { readonly review: PublicReviewItem }): JSX.Element => (
  <li>
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Rating value={review.rating} size="sm" />
          {/* Every review in this system is tied to a delivered order item
              (S8-REVIEWS write path) — this is a structural fact about every
              row here, not a per-review field fetched from the server. */}
          <Badge tone="success">Verified purchase</Badge>
        </div>
        <time dateTime={review.createdAt} className="text-xs text-text-faint">
          {formatReviewDate(review.createdAt)}
        </time>
      </div>
      <p className="text-sm leading-relaxed text-text">{review.body}</p>
    </Card>
  </li>
);

const ReviewsSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading reviews">
    <Skeleton shape="text" className="h-5 w-40" />
    <Skeleton shape="rect" className="h-24 w-full" />
  </div>
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
    return <ReviewsSkeleton />;
  }

  if (isError || !data) {
    return <Alert tone="danger">{apiErrorMessage(error, 'Reviews could not be loaded.')}</Alert>;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold text-text">Reviews</h2>
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
