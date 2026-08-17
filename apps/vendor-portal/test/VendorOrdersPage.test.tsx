import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { VendorSubOrderSummaryResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { VendorOrdersPage } from '@/pages/VendorOrdersPage';
import { useListVendorOrdersQuery } from '@/features/vendor-order/vendor-order.api';

vi.mock('@/features/vendor-order/vendor-order.api', () => ({ useListVendorOrdersQuery: vi.fn() }));

const mockedUseListVendorOrdersQuery = vi.mocked(useListVendorOrdersQuery);

const summary = (
  overrides: Partial<VendorSubOrderSummaryResponse> = {},
): VendorSubOrderSummaryResponse => ({
  id: 'sub-order-1',
  orderId: 'order-1',
  status: 'CONFIRMED',
  fulfilmentMode: 'DELIVERY',
  totalAmount: { amount: '19800', currency: 'INR' },
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderOrdersPage = (
  data: readonly VendorSubOrderSummaryResponse[] | undefined,
  options: { isLoading?: boolean; isError?: boolean } = {},
): void => {
  mockedUseListVendorOrdersQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useListVendorOrdersQuery>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route path="/orders" element={<VendorOrdersPage />} />
          <Route path="/orders/:id" element={<p>Vendor order detail page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('VendorOrdersPage', () => {
  it('shows a loading skeleton while fetching', () => {
    renderOrdersPage(undefined, { isLoading: true });

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
  });

  it('shows an error state when the list cannot be loaded', () => {
    renderOrdersPage(undefined, { isError: true });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an empty state when there are no orders', () => {
    renderOrdersPage([]);

    expect(screen.getByText('No orders yet')).toBeInTheDocument();
  });

  it('renders id, status, total and date for each order', () => {
    renderOrdersPage([
      summary({
        id: 'sub-order-1',
        status: 'CONFIRMED',
        totalAmount: { amount: '19800', currency: 'INR' },
      }),
    ]);

    expect(screen.getByText('sub-order-1')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('₹198.00')).toBeInTheDocument();
    expect(screen.getByText('1 Jan 2026')).toBeInTheDocument();
  });

  it('links each row to its own order detail page', () => {
    renderOrdersPage([summary({ id: 'sub-order-1' })]);

    expect(screen.getByRole('link')).toHaveAttribute('href', '/orders/sub-order-1');
  });

  it('renders one row per order, in the order the API returned them', () => {
    renderOrdersPage([
      summary({ id: 'sub-order-2', createdAt: '2026-01-02T00:00:00.000Z' }),
      summary({ id: 'sub-order-1', createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);

    const rows = screen.getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('href', '/orders/sub-order-2');
    expect(rows[1]).toHaveAttribute('href', '/orders/sub-order-1');
  });
});
