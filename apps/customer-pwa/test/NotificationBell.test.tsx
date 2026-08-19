import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { AuthSessionResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { sessionEstablished } from '@/shared/api/session.slice';
import { NotificationBell } from '@/features/notification/components/NotificationBell';
import { useUnreadNotificationCountQuery } from '@/features/notification/notification.api';

vi.mock('@/features/notification/notification.api', () => ({
  useUnreadNotificationCountQuery: vi.fn(),
}));

const mockedCount = vi.mocked(useUnreadNotificationCountQuery);

const session: AuthSessionResponse = {
  user: {
    id: '00000000-0000-7000-8000-000000000001',
    email: 'shopper@example.com',
    role: 'CUSTOMER',
  },
  accessToken: 'access-token',
  accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: '2026-01-31T00:00:00.000Z',
};

const renderBell = (options: { unread?: number; authenticated?: boolean } = {}): void => {
  mockedCount.mockClear();
  mockedCount.mockReturnValue({
    data: options.unread === undefined ? undefined : { unread: options.unread },
  } as unknown as ReturnType<typeof useUnreadNotificationCountQuery>);

  const store = createStore();
  if (options.authenticated !== false) {
    store.dispatch(sessionEstablished(session));
  }

  render(
    <Provider store={store}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </Provider>,
  );
};

describe('NotificationBell', () => {
  it('renders nothing for an anonymous visitor', () => {
    renderBell({ authenticated: false });

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('never asks for a count without a session', () => {
    // The route is SELF_SCOPED; asking anonymously buys a 401 the shell has no
    // useful way to display.
    renderBell({ authenticated: false });

    expect(mockedCount).toHaveBeenCalledWith(undefined, expect.objectContaining({ skip: true }));
  });

  it('polls the count, because nothing else can tell it a notification arrived', () => {
    // Notifications are written server-side by a worker; no client action
    // invalidates the cache, so without a poll the badge is frozen at whatever
    // was true when the page loaded.
    renderBell({ unread: 0 });

    const options = mockedCount.mock.calls[0]?.[1] as
      | { pollingInterval?: number; refetchOnFocus?: boolean }
      | undefined;
    expect(options?.pollingInterval).toBeGreaterThan(0);
    expect(options?.refetchOnFocus).toBe(true);
  });

  it('links to the inbox', () => {
    renderBell({ unread: 0 });

    expect(screen.getByRole('link')).toHaveAttribute('href', '/notifications');
  });

  it('says so plainly when nothing is unread', () => {
    renderBell({ unread: 0 });

    expect(screen.getByRole('link', { name: 'Notifications, none unread' })).toBeInTheDocument();
  });

  it('puts the unread count in the accessible name, not only in the badge', () => {
    renderBell({ unread: 3 });

    expect(screen.getByRole('link', { name: 'Notifications, 3 unread' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('caps the badge rather than letting a large number distort the header', () => {
    renderBell({ unread: 42 });

    expect(screen.getByText('9+')).toBeInTheDocument();
    // The exact figure survives where there is room to read it in full.
    expect(screen.getByRole('link', { name: 'Notifications, 42 unread' })).toBeInTheDocument();
  });

  it('treats a not-yet-loaded count as zero rather than flashing a wrong number', () => {
    renderBell({});

    expect(screen.getByRole('link', { name: 'Notifications, none unread' })).toBeInTheDocument();
  });
});
