import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { NotificationResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { NotificationsPage } from '@/pages/NotificationsPage';
import {
  useListNotificationsQuery,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useUnreadNotificationCountQuery,
} from '@/features/notification/notification.api';

vi.mock('@/features/notification/notification.api', () => ({
  useListNotificationsQuery: vi.fn(),
  useUnreadNotificationCountQuery: vi.fn(),
  useMarkNotificationReadMutation: vi.fn(),
  useMarkAllNotificationsReadMutation: vi.fn(),
}));

const mockedList = vi.mocked(useListNotificationsQuery);
const mockedCount = vi.mocked(useUnreadNotificationCountQuery);
const mockedMarkRead = vi.mocked(useMarkNotificationReadMutation);
const mockedMarkAllRead = vi.mocked(useMarkAllNotificationsReadMutation);

const ORDER_ID = '01a02222-2222-7222-8222-222222222222';

const notification = (overrides: Partial<NotificationResponse> = {}): NotificationResponse => ({
  id: '01a01111-1111-7111-8111-111111111111',
  createdAt: '2026-08-19T06:00:00.000Z',
  recipientKind: 'CUSTOMER',
  channel: 'IN_APP',
  eventType: 'order.confirmed',
  title: 'Order confirmed',
  body: 'Your order 89ABCDEF has been confirmed.',
  payload: { orderId: ORDER_ID },
  readAt: null,
  ...overrides,
});

interface RenderOptions {
  readonly items?: readonly NotificationResponse[];
  readonly nextCursor?: string | null;
  readonly unread?: number;
  readonly isLoading?: boolean;
  readonly isError?: boolean;
}

const markRead = vi.fn();
const markAllRead = vi.fn();

const renderPage = (options: RenderOptions = {}): void => {
  markRead.mockReset().mockResolvedValue({ updated: true });
  markAllRead.mockReset().mockResolvedValue({ updated: 1 });
  mockedList.mockClear();

  const failed = options.isLoading === true || options.isError === true;
  mockedList.mockReturnValue({
    data: failed
      ? undefined
      : { items: options.items ?? [], nextCursor: options.nextCursor ?? null },
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useListNotificationsQuery>);

  mockedCount.mockReturnValue({
    data: { unread: options.unread ?? 0 },
  } as unknown as ReturnType<typeof useUnreadNotificationCountQuery>);

  mockedMarkRead.mockReturnValue([markRead, { isLoading: false }] as unknown as ReturnType<
    typeof useMarkNotificationReadMutation
  >);
  mockedMarkAllRead.mockReturnValue([markAllRead, { isLoading: false }] as unknown as ReturnType<
    typeof useMarkAllNotificationsReadMutation
  >);

  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/orders/:id" element={<p>Order page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('NotificationsPage', () => {
  it('shows an error state when the list cannot be loaded', () => {
    renderPage({ isError: true });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an empty state rather than a bare list when there is nothing', () => {
    renderPage({ items: [] });

    expect(screen.getByText(/no notifications yet/i)).toBeInTheDocument();
  });

  it('renders the title and body the server sent', () => {
    renderPage({ items: [notification()], unread: 1 });

    expect(screen.getByText('Order confirmed')).toBeInTheDocument();
    expect(screen.getByText('Your order 89ABCDEF has been confirmed.')).toBeInTheDocument();
  });

  it('deep-links to the order named in the payload', () => {
    renderPage({ items: [notification()], unread: 1 });

    expect(screen.getByRole('link', { name: 'View order' })).toHaveAttribute(
      'href',
      `/orders/${ORDER_ID}`,
    );
  });

  it('offers no order link when the payload names no order', () => {
    renderPage({ items: [notification({ payload: {} })], unread: 1 });

    expect(screen.queryByRole('link', { name: 'View order' })).not.toBeInTheDocument();
  });

  it('does not mark anything read merely by rendering the list', () => {
    // The locked decision: opening the list is not reading what is in it.
    renderPage({ items: [notification()], unread: 1 });

    expect(markRead).not.toHaveBeenCalled();
    expect(markAllRead).not.toHaveBeenCalled();
  });

  it('marks one notification read when the reader asks', () => {
    renderPage({ items: [notification()], unread: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));

    expect(markRead).toHaveBeenCalledWith('01a01111-1111-7111-8111-111111111111');
  });

  it('offers no per-item action on a notification that is already read', () => {
    renderPage({ items: [notification({ readAt: '2026-08-19T07:00:00.000Z' })] });

    expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument();
  });

  it('announces unread state to a screen reader, not only through colour', () => {
    renderPage({ items: [notification()], unread: 1 });

    expect(screen.getByText('(unread)')).toBeInTheDocument();
  });

  it('marks the whole inbox read on request', () => {
    renderPage({ items: [notification()], unread: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));

    expect(markAllRead).toHaveBeenCalledTimes(1);
  });

  it('hides "Mark all as read" when nothing is unread', () => {
    renderPage({ items: [notification({ readAt: '2026-08-19T07:00:00.000Z' })], unread: 0 });

    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument();
  });

  it('offers "Load more" only while the server says there is more', () => {
    renderPage({ items: [notification()], nextCursor: '2026-08-19T06:00:00.000Z|abc' });

    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('offers no "Load more" at the end of the list', () => {
    renderPage({ items: [notification()], nextCursor: null });

    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('requests the next page with the cursor the server returned', () => {
    renderPage({ items: [notification()], nextCursor: '2026-08-19T06:00:00.000Z|abc' });

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(mockedList).toHaveBeenCalledWith({ cursor: '2026-08-19T06:00:00.000Z|abc' });
  });

  it('asks for the first page with no cursor at all', () => {
    // `undefined` is the absence of a position, not a position named
    // "undefined" — sending the string would be a 400.
    renderPage({ items: [notification()] });

    expect(mockedList).toHaveBeenCalledWith(undefined);
  });
});
