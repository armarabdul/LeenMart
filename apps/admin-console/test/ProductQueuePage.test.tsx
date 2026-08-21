import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { AdminProductQueueItem } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { ProductQueuePage } from '@/pages/ProductQueuePage';
import { useListProductQueueQuery } from '@/features/product-moderation/product-moderation.api';
import type { ProductQueuePage as ProductQueuePageResult } from '@/features/product-moderation/product-moderation.api';

vi.mock('@/features/product-moderation/product-moderation.api', () => ({
  useListProductQueueQuery: vi.fn(),
}));

const mockedUseListProductQueueQuery = vi.mocked(useListProductQueueQuery);
const mockRefetch = vi.fn();

const item = (overrides: Partial<AdminProductQueueItem> = {}): AdminProductQueueItem => ({
  productId: 'product-1',
  vendorId: 'vendor-1',
  categoryId: 'category-1',
  name: 'Fresh apples',
  status: 'PENDING_REVIEW',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderPage = (
  data: ProductQueuePageResult | undefined,
  options: { isLoading?: boolean; isFetching?: boolean; isError?: boolean } = {},
): void => {
  mockRefetch.mockClear();
  mockedUseListProductQueueQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isFetching: options.isFetching ?? false,
    isError: options.isError ?? false,
    error: undefined,
    refetch: mockRefetch,
  } as unknown as ReturnType<typeof useListProductQueueQuery>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <ProductQueuePage />
      </MemoryRouter>
    </Provider>,
  );
};

describe('ProductQueuePage', () => {
  it('shows a loading skeleton while fetching', () => {
    renderPage(undefined, { isLoading: true });

    expect(screen.getByText('Product Moderation')).toBeInTheDocument();
    expect(screen.queryByText('No products in this view')).not.toBeInTheDocument();
  });

  it('shows an error state with a retry action', () => {
    renderPage(undefined, { isError: true });

    expect(screen.getByRole('alert')).toHaveTextContent('The product queue could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows an empty state when nothing matches the filters', () => {
    renderPage({ items: [], nextCursor: null, hasMore: false });

    expect(screen.getByText('No products in this view')).toBeInTheDocument();
  });

  it('lists each product and links it to its detail page', () => {
    renderPage({
      items: [item({ productId: 'product-1', name: 'Fresh apples' })],
      nextCursor: null,
      hasMore: false,
    });

    expect(screen.getByText('Fresh apples')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Fresh apples/ })).toHaveAttribute(
      'href',
      '/product-moderation/product-1',
    );
  });

  it('shows a load-more control only when the backend reports another page', () => {
    renderPage({ items: [item()], nextCursor: 'cursor-2', hasMore: true });

    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('defaults the status filter to PENDING_REVIEW only', () => {
    renderPage({ items: [], nextCursor: null, hasMore: false });

    expect(screen.getByRole('button', { name: 'Pending review' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Approved' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
