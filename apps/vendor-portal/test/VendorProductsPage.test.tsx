import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { VendorProduct } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { VendorProductsPage } from '@/pages/VendorProductsPage';
import { useListProductsQuery } from '@/features/vendor-product/vendor-product.api';

vi.mock('@/features/vendor-product/vendor-product.api', () => ({
  useListProductsQuery: vi.fn(),
}));

const mockedUseListProductsQuery = vi.mocked(useListProductsQuery);
const mockRefetch = vi.fn();

const product = (overrides: Partial<VendorProduct> = {}): VendorProduct => ({
  id: 'product-1',
  categoryId: 'category-1',
  name: 'Fresh apples',
  brand: null,
  description: null,
  hsnCode: null,
  countryOfOrigin: null,
  netQuantity: null,
  attributeValues: {},
  status: 'DRAFT',
  rejectionReason: null,
  rejectionNote: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderPage = (
  data: readonly VendorProduct[] | undefined,
  options: { isLoading?: boolean; isError?: boolean } = {},
): void => {
  mockRefetch.mockClear();
  mockedUseListProductsQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
    refetch: mockRefetch,
  } as unknown as ReturnType<typeof useListProductsQuery>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <VendorProductsPage />
      </MemoryRouter>
    </Provider>,
  );
};

describe('VendorProductsPage', () => {
  it('shows a loading skeleton while fetching', () => {
    renderPage(undefined, { isLoading: true });

    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.queryByText('No products yet')).not.toBeInTheDocument();
  });

  it('shows an error state with a retry action', () => {
    renderPage(undefined, { isError: true });

    expect(screen.getByRole('alert')).toHaveTextContent('Your products could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows an empty state with a way to add the first product', () => {
    renderPage([]);

    expect(screen.getByText('No products yet')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Add product' })[0]).toHaveAttribute(
      'href',
      '/products/new',
    );
  });

  it('lists each product with its name, brand and status', () => {
    renderPage([product({ id: 'product-1', name: 'Fresh apples', brand: 'Local Farms' })]);

    expect(screen.getByText('Fresh apples')).toBeInTheDocument();
    expect(screen.getByText('Local Farms')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('links each row to its own edit page', () => {
    renderPage([product({ id: 'product-1' })]);

    expect(screen.getByRole('link', { name: /Fresh apples/ })).toHaveAttribute(
      'href',
      '/products/product-1',
    );
  });

  it('shows the right status label for each product state', () => {
    renderPage([
      product({ id: 'p1', name: 'A', status: 'PENDING_REVIEW' }),
      product({ id: 'p2', name: 'B', status: 'APPROVED' }),
      product({ id: 'p3', name: 'C', status: 'REJECTED' }),
    ]);

    expect(screen.getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });
});
