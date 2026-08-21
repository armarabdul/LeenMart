import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { AdminReviewQueueItem } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { ReviewQueuePage } from '@/pages/ReviewQueuePage';
import {
  useDecideReviewMutation,
  useListReviewQueueQuery,
} from '@/features/review-moderation/review-moderation.api';
import type { ReviewQueuePage as ReviewQueuePageResult } from '@/features/review-moderation/review-moderation.api';

vi.mock('@/features/review-moderation/review-moderation.api', () => ({
  useListReviewQueueQuery: vi.fn(),
  useDecideReviewMutation: vi.fn(),
}));

const mockedUseListReviewQueueQuery = vi.mocked(useListReviewQueueQuery);
const mockedUseDecideReviewMutation = vi.mocked(useDecideReviewMutation);
const mockRefetch = vi.fn();
const mockDecideReview = vi.fn();

const item = (overrides: Partial<AdminReviewQueueItem> = {}): AdminReviewQueueItem => ({
  id: 'review-1',
  customerId: 'customer-1',
  productId: 'product-1',
  variantId: 'variant-1',
  rating: 4,
  body: 'Great product, fast delivery.',
  status: 'SUBMITTED',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const stub = (
  data: ReviewQueuePageResult | undefined,
  options: { isLoading?: boolean; isFetching?: boolean; isError?: boolean } = {},
): void => {
  mockRefetch.mockClear();
  mockDecideReview.mockReset();
  mockedUseListReviewQueueQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isFetching: options.isFetching ?? false,
    isError: options.isError ?? false,
    error: undefined,
    refetch: mockRefetch,
  } as unknown as ReturnType<typeof useListReviewQueueQuery>);
  mockedUseDecideReviewMutation.mockReturnValue([
    mockDecideReview,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useDecideReviewMutation>);
};

const renderPage = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <ReviewQueuePage />
      </MemoryRouter>
    </Provider>,
  );
};

describe('ReviewQueuePage', () => {
  it('shows a loading skeleton while fetching', () => {
    stub(undefined, { isLoading: true });
    renderPage();

    expect(screen.getByText('Review Moderation')).toBeInTheDocument();
    expect(screen.queryByText('No reviews in this view')).not.toBeInTheDocument();
  });

  it('shows an error state with a retry action', () => {
    stub(undefined, { isError: true });
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('The review queue could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows an empty state when nothing matches the filters', () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    expect(screen.getByText('No reviews in this view')).toBeInTheDocument();
  });

  it('shows the full review body and rating inline, since there is no separate detail page', () => {
    stub({
      items: [item({ rating: 5, body: 'Excellent quality.' })],
      nextCursor: null,
      hasMore: false,
    });
    renderPage();

    expect(screen.getByText('Rating 5 / 5')).toBeInTheDocument();
    expect(screen.getByText('Excellent quality.')).toBeInTheDocument();
  });

  it('approves a submitted review', () => {
    stub({
      items: [item({ id: 'review-1', status: 'SUBMITTED' })],
      nextCursor: null,
      hasMore: false,
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(mockDecideReview).toHaveBeenCalledWith({
      reviewId: 'review-1',
      body: { decision: 'APPROVE' },
    });
  });

  it('hides a submitted review', () => {
    stub({
      items: [item({ id: 'review-1', status: 'SUBMITTED' })],
      nextCursor: null,
      hasMore: false,
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(mockDecideReview).toHaveBeenCalledWith({
      reviewId: 'review-1',
      body: { decision: 'HIDE' },
    });
  });

  it('restores visibility on a hidden review by re-applying APPROVE, never a separate RESTORE action', () => {
    stub({ items: [item({ id: 'review-1', status: 'HIDDEN' })], nextCursor: null, hasMore: false });
    renderPage();

    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(mockDecideReview).toHaveBeenCalledWith({
      reviewId: 'review-1',
      body: { decision: 'APPROVE' },
    });
  });

  it('does not offer a hide action on an already-hidden review', () => {
    stub({ items: [item({ status: 'HIDDEN' })], nextCursor: null, hasMore: false });
    renderPage();

    expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
  });
});
