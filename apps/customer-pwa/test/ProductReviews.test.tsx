import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ListProductReviewsResponse, PublicReviewItem } from '@leen-mart/contracts';
import { ProductReviews } from '@/features/review/components/ProductReviews';
import { useGetProductReviewsQuery } from '@/features/review/review.api';

vi.mock('@/features/review/review.api', () => ({
  useGetProductReviewsQuery: vi.fn(),
}));

const mockedQuery = vi.mocked(useGetProductReviewsQuery);

const PRODUCT_ID = '01a02222-2222-7222-8222-222222222222';

const review = (overrides: Partial<PublicReviewItem> = {}): PublicReviewItem =>
  ({
    id: '01a03333-3333-7333-8333-333333333333',
    rating: 5,
    body: 'Sweet and fresh.',
    createdAt: '2026-08-20T06:00:00.000Z',
    ...overrides,
  }) as PublicReviewItem;

const renderReviews = (
  data: Partial<ListProductReviewsResponse> | undefined,
  options: { isLoading?: boolean; isError?: boolean } = {},
): void => {
  mockedQuery.mockReturnValue({
    data: data
      ? { items: [], summary: { averageRating: null, approvedReviewCount: 0 }, ...data }
      : undefined,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetProductReviewsQuery>);

  render(<ProductReviews productId={PRODUCT_ID} />);
};

describe('ProductReviews (S8-REVIEWS)', () => {
  it('says there are no reviews rather than showing an empty rating', () => {
    renderReviews({ items: [], summary: { averageRating: null, approvedReviewCount: 0 } });

    expect(screen.getByText('No reviews yet.')).toBeInTheDocument();
  });

  it('shows the average and the approved count', () => {
    renderReviews({
      items: [review()],
      summary: { averageRating: 4.5, approvedReviewCount: 2 },
    });

    expect(screen.getByText('4.5')).toBeInTheDocument();
    expect(screen.getByText('(2 reviews)')).toBeInTheDocument();
  });

  it('says "1 review", not "1 reviews"', () => {
    renderReviews({
      items: [review()],
      summary: { averageRating: 5, approvedReviewCount: 1 },
    });

    expect(screen.getByText('(1 review)')).toBeInTheDocument();
  });

  it('renders each review’s rating and body', () => {
    renderReviews({
      items: [review({ body: 'Sweet and fresh.' })],
      summary: { averageRating: 5, approvedReviewCount: 1 },
    });

    expect(screen.getByText('Sweet and fresh.')).toBeInTheDocument();
    // Two star rows render: the summary's rounded average and the review's own.
    expect(screen.getAllByLabelText('5 out of 5 stars')).toHaveLength(2);
  });

  it('never renders a moderation status — the public surface shows approved rows only', () => {
    renderReviews({
      items: [review()],
      summary: { averageRating: 5, approvedReviewCount: 1 },
    });

    expect(document.body.textContent).not.toMatch(/SUBMITTED|APPROVED|HIDDEN|status/i);
  });

  it('shows an error state rather than pretending there are no reviews', () => {
    renderReviews(undefined, { isError: true });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
