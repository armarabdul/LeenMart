import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createStore } from '@/app/store';
import { VendorEarningsPage } from '@/pages/VendorEarningsPage';
import {
  useGetVendorEarningsQuery,
  type VendorEarningsPage as VendorEarningsPageResult,
  type VendorEarningsPageArg,
} from '@/features/vendor-earnings/vendor-earnings.api';

vi.mock('@/features/vendor-earnings/vendor-earnings.api', () => ({
  useGetVendorEarningsQuery: vi.fn(),
}));

const mockedUseGetVendorEarningsQuery = vi.mocked(useGetVendorEarningsQuery);

const summary = (
  overrides: Partial<VendorEarningsPageResult['summary']> = {},
): VendorEarningsPageResult['summary'] => ({
  vendorId: 'vendor-1',
  grossAccrued: { amount: '29800', currency: 'INR' },
  commission: { amount: '2980', currency: 'INR' },
  netAccrued: { amount: '26820', currency: 'INR' },
  ...overrides,
});

const line = (
  overrides: Partial<VendorEarningsPageResult['lines'][number]> = {},
): VendorEarningsPageResult['lines'][number] => ({
  subOrderId: 'sub-order-1',
  orderId: 'order-1',
  paymentAttemptId: 'payment-1',
  vendorId: 'vendor-1',
  occurredAt: '2026-01-01T00:00:00.000Z',
  grossAmount: { amount: '29800', currency: 'INR' },
  commissionAmount: { amount: '2980', currency: 'INR' },
  netAmount: { amount: '26820', currency: 'INR' },
  ...overrides,
});

const renderEarningsPage = (
  data: VendorEarningsPageResult | undefined,
  options: { isLoading?: boolean; isError?: boolean; isFetching?: boolean } = {},
): void => {
  mockedUseGetVendorEarningsQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    isFetching: options.isFetching ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetVendorEarningsQuery>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/earnings']}>
        <Routes>
          <Route path="/earnings" element={<VendorEarningsPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('VendorEarningsPage', () => {
  it('shows a loading skeleton while fetching', () => {
    renderEarningsPage(undefined, { isLoading: true });

    expect(screen.getByText('Earnings')).toBeInTheDocument();
    expect(screen.queryByText('Earnings summary')).not.toBeInTheDocument();
  });

  it('shows an error state when the statement cannot be loaded', () => {
    renderEarningsPage(undefined, { isError: true });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an empty state when there is no accrued activity', () => {
    renderEarningsPage({ summary: summary(), lines: [], nextCursor: null, hasMore: false });

    expect(
      screen.getByText('No accrued earnings yet. Confirmed customer payments will show up here.'),
    ).toBeInTheDocument();
  });

  it('renders gross, commission and net accrued from the summary', () => {
    renderEarningsPage({ summary: summary(), lines: [], nextCursor: null, hasMore: false });

    expect(screen.getByText('₹298.00')).toBeInTheDocument();
    expect(screen.getByText('₹29.80')).toBeInTheDocument();
    expect(screen.getByText('₹268.20')).toBeInTheDocument();
  });

  it('renders one statement row per line, with its sub-order id', () => {
    renderEarningsPage({
      summary: summary(),
      lines: [line({ subOrderId: 'sub-order-1' }), line({ subOrderId: 'sub-order-2' })],
      nextCursor: null,
      hasMore: false,
    });

    expect(screen.getByText('sub-order-1')).toBeInTheDocument();
    expect(screen.getByText('sub-order-2')).toBeInTheDocument();
  });

  it('shows accrued-vs-payout wording, never claiming a payout has occurred', () => {
    renderEarningsPage({ summary: summary(), lines: [], nextCursor: null, hasMore: false });

    expect(screen.getByText(/Accrued earnings, not a payout\./)).toBeInTheDocument();
    expect(screen.queryByText(/net payable/i)).not.toBeInTheDocument();
  });

  it('never renders a payout, withdrawal or settlement control', () => {
    renderEarningsPage({
      summary: summary(),
      lines: [line()],
      nextCursor: null,
      hasMore: false,
    });

    expect(screen.queryByRole('button', { name: /pay ?out/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /withdraw/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /settle/i })).not.toBeInTheDocument();
  });

  it('shows a "Load more" button only while another page exists', () => {
    renderEarningsPage({
      summary: summary(),
      lines: [line()],
      nextCursor: 'cursor-2',
      hasMore: true,
    });

    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('does not show a "Load more" button once the last page has loaded', () => {
    renderEarningsPage({
      summary: summary(),
      lines: [line()],
      nextCursor: null,
      hasMore: false,
    });

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('requests the next page by cursor when "Load more" is clicked', () => {
    const pageOne: VendorEarningsPageResult = {
      summary: summary(),
      lines: [line({ subOrderId: 'sub-order-1' })],
      nextCursor: 'cursor-2',
      hasMore: true,
    };
    mockedUseGetVendorEarningsQuery.mockImplementation(
      (arg) =>
        ({
          data:
            (arg as VendorEarningsPageArg | undefined)?.cursor === 'cursor-2'
              ? {
                  ...pageOne,
                  lines: [line({ subOrderId: 'sub-order-2' })],
                  nextCursor: null,
                  hasMore: false,
                }
              : pageOne,
          isLoading: false,
          isError: false,
          isFetching: false,
          error: undefined,
        }) as unknown as ReturnType<typeof useGetVendorEarningsQuery>,
    );

    render(
      <Provider store={createStore()}>
        <MemoryRouter initialEntries={['/earnings']}>
          <Routes>
            <Route path="/earnings" element={<VendorEarningsPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    expect(screen.getByText('sub-order-1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(screen.getByText('sub-order-1')).toBeInTheDocument();
    expect(screen.getByText('sub-order-2')).toBeInTheDocument();
  });
});
