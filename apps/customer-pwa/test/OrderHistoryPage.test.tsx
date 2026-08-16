import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OrderSummaryResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { OrderHistoryPage } from '@/pages/OrderHistoryPage';
import { useListOrdersQuery } from '@/features/checkout/checkout.api';

vi.mock('@/features/checkout/checkout.api', () => ({ useListOrdersQuery: vi.fn() }));

const mockedUseListOrdersQuery = vi.mocked(useListOrdersQuery);

const summary = (overrides: Partial<OrderSummaryResponse> = {}): OrderSummaryResponse => ({
  id: 'order-1',
  status: 'CONFIRMED',
  totalAmount: { amount: '19800', currency: 'INR' },
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderHistoryPage = (
  data: readonly OrderSummaryResponse[] | undefined,
  options: { isLoading?: boolean; isError?: boolean } = {},
): void => {
  mockedUseListOrdersQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useListOrdersQuery>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/orders']}>
        <Routes>
          <Route path="/orders" element={<OrderHistoryPage />} />
          <Route path="/orders/:id" element={<p>Order confirmation page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('OrderHistoryPage', () => {
  it('shows a loading skeleton while fetching', () => {
    renderHistoryPage(undefined, { isLoading: true });

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('My orders')).toBeInTheDocument();
  });

  it('shows an error state when the list cannot be loaded', () => {
    renderHistoryPage(undefined, { isError: true });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an empty state with a link back to the catalogue when there are no orders', () => {
    renderHistoryPage([]);

    expect(screen.getByText('No orders yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to catalogue' })).toHaveAttribute(
      'href',
      '/catalogue',
    );
  });

  it('renders id, status, total and date for each order', () => {
    renderHistoryPage([
      summary({
        id: 'order-1',
        status: 'CONFIRMED',
        totalAmount: { amount: '19800', currency: 'INR' },
      }),
    ]);

    expect(screen.getByText('order-1')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('₹198.00')).toBeInTheDocument();
    expect(screen.getByText('1 Jan 2026')).toBeInTheDocument();
  });

  it('renders one row per order, newest first as returned by the API', () => {
    renderHistoryPage([
      summary({ id: 'order-2', createdAt: '2026-01-02T00:00:00.000Z' }),
      summary({ id: 'order-1', createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);

    const rows = screen.getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('href', '/orders/order-2');
    expect(rows[1]).toHaveAttribute('href', '/orders/order-1');
  });

  it('links each row to its own order detail page', () => {
    renderHistoryPage([summary({ id: 'order-1' })]);

    expect(screen.getByRole('link')).toHaveAttribute('href', '/orders/order-1');
  });

  it('shows no cancel action on the list — cancellation lives only on order detail', () => {
    renderHistoryPage([summary()]);

    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
  });
});
