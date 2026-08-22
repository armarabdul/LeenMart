import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { AuditLogEntryDto } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { AuditLogPage } from '@/pages/AuditLogPage';
import { useListAuditLogQuery } from '@/features/audit-log/audit-log.api';
import type { AuditLogPage as AuditLogPageResult } from '@/features/audit-log/audit-log.api';

vi.mock('@/features/audit-log/audit-log.api', () => ({ useListAuditLogQuery: vi.fn() }));

const mockedUseListAuditLogQuery = vi.mocked(useListAuditLogQuery);
const mockRefetch = vi.fn();

const entry = (overrides: Partial<AuditLogEntryDto> = {}): AuditLogEntryDto => ({
  id: 'entry-1',
  actorId: '00000000-0000-7000-8000-000000000001',
  actorRole: 'SUPER_ADMIN',
  impersonatedBy: null,
  action: 'catalogue.category.created',
  entityType: 'category',
  entityId: '00000000-0000-7000-8000-000000000002',
  before: null,
  after: { name: 'Groceries', slug: 'groceries' },
  reason: null,
  ipAddress: '203.0.113.5',
  userAgent: 'Mozilla/5.0',
  requestId: 'req-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderPage = (
  data: AuditLogPageResult | undefined,
  options: { isLoading?: boolean; isFetching?: boolean; isError?: boolean } = {},
): void => {
  mockRefetch.mockClear();
  mockedUseListAuditLogQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isFetching: options.isFetching ?? false,
    isError: options.isError ?? false,
    error: undefined,
    refetch: mockRefetch,
  } as unknown as ReturnType<typeof useListAuditLogQuery>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <AuditLogPage />
      </MemoryRouter>
    </Provider>,
  );
};

describe('AuditLogPage', () => {
  it('shows a loading skeleton while fetching', () => {
    renderPage(undefined, { isLoading: true });

    expect(screen.getByText('Audit Log')).toBeInTheDocument();
    expect(screen.queryByText('No matching entries')).not.toBeInTheDocument();
  });

  it('shows an error state with a retry action', () => {
    renderPage(undefined, { isError: true });

    expect(screen.getByRole('alert')).toHaveTextContent('The audit log could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows an empty state when nothing matches the filters', () => {
    renderPage({ items: [], nextCursor: null, hasMore: false });

    expect(screen.getByText('No matching entries')).toBeInTheDocument();
  });

  it('lists each entry with its action, entity, and actor', () => {
    renderPage({
      items: [entry({ action: 'catalogue.category.created', entityType: 'category' })],
      nextCursor: null,
      hasMore: false,
    });

    expect(screen.getByText('catalogue.category.created')).toBeInTheDocument();
    expect(screen.getByText(/Actor 00000000-0000-7000-8000-000000000001/)).toBeInTheDocument();
  });

  it('renders the after snapshot as pretty-printed JSON and a dash for an absent before snapshot', () => {
    renderPage({
      items: [entry({ before: null, after: { name: 'Groceries', slug: 'groceries' } })],
      nextCursor: null,
      hasMore: false,
    });

    expect(screen.getByText(/"name": "Groceries"/)).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows a load-more control only when the backend reports another page', () => {
    renderPage({ items: [entry()], nextCursor: 'cursor-2', hasMore: true });

    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('applies typed filters and refetches with them', () => {
    renderPage({ items: [], nextCursor: null, hasMore: false });

    fireEvent.change(screen.getByLabelText('Action'), {
      target: { value: 'catalogue.category.created' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const lastCall = mockedUseListAuditLogQuery.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ action: 'catalogue.category.created' });
  });

  it('clears filters back to an unfiltered query', () => {
    renderPage({ items: [], nextCursor: null, hasMore: false });

    fireEvent.change(screen.getByLabelText('Entity type'), { target: { value: 'category' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    const lastCall = mockedUseListAuditLogQuery.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({ entityType: undefined });
  });
});
