import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { AdminKycQueueItem } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { KycQueuePage } from '@/pages/KycQueuePage';
import { useListKycQueueQuery } from '@/features/kyc-review/kyc-review.api';
import type { KycQueuePage as KycQueuePageResult } from '@/features/kyc-review/kyc-review.api';

vi.mock('@/features/kyc-review/kyc-review.api', () => ({ useListKycQueueQuery: vi.fn() }));

const mockedUseListKycQueueQuery = vi.mocked(useListKycQueueQuery);
const mockRefetch = vi.fn();

const item = (overrides: Partial<AdminKycQueueItem> = {}): AdminKycQueueItem => ({
  kycId: 'kyc-1',
  vendorId: 'vendor-1',
  vendorStatus: 'KYC_SUBMITTED',
  panLast4: '1234',
  gstin: '27AAAAA0000A1Z5',
  submittedAt: '2026-01-01T00:00:00.000Z',
  reviewedBy: null,
  startedAt: null,
  ...overrides,
});

const renderPage = (
  data: KycQueuePageResult | undefined,
  options: { isLoading?: boolean; isFetching?: boolean; isError?: boolean } = {},
): void => {
  mockRefetch.mockClear();
  mockedUseListKycQueueQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isFetching: options.isFetching ?? false,
    isError: options.isError ?? false,
    error: undefined,
    refetch: mockRefetch,
  } as unknown as ReturnType<typeof useListKycQueueQuery>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <KycQueuePage />
      </MemoryRouter>
    </Provider>,
  );
};

describe('KycQueuePage', () => {
  it('shows a loading skeleton while fetching', () => {
    renderPage(undefined, { isLoading: true });

    expect(screen.getByText('KYC Review')).toBeInTheDocument();
    expect(screen.queryByText('No submissions in this view')).not.toBeInTheDocument();
  });

  it('shows an error state with a retry action', () => {
    renderPage(undefined, { isError: true });

    expect(screen.getByRole('alert')).toHaveTextContent('The KYC queue could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows an empty state when nothing matches the filters', () => {
    renderPage({ items: [], nextCursor: null, hasMore: false });

    expect(screen.getByText('No submissions in this view')).toBeInTheDocument();
  });

  it('lists each submission and links it to its detail page', () => {
    renderPage({
      items: [item({ kycId: 'kyc-1', vendorId: 'vendor-1' })],
      nextCursor: null,
      hasMore: false,
    });

    expect(screen.getByText('Vendor vendor-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Vendor vendor-1/ })).toHaveAttribute(
      'href',
      '/kyc-review/kyc-1',
    );
  });

  it('shows a load-more control only when the backend reports another page', () => {
    renderPage({ items: [item()], nextCursor: 'cursor-2', hasMore: true });

    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('toggles a status filter', () => {
    renderPage({ items: [], nextCursor: null, hasMore: false });

    const approvedButton = screen.getByRole('button', { name: 'Approved' });
    expect(approvedButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(approvedButton);

    expect(approvedButton).toHaveAttribute('aria-pressed', 'true');
  });
});
