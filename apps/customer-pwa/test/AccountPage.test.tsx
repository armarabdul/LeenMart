import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthSessionResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { sessionEstablished } from '@/shared/api/session.slice';
import { AccountPage } from '@/pages/AccountPage';
import { useLogoutMutation } from '@/features/auth/auth.api';
import { useUnreadNotificationCountQuery } from '@/features/notification/notification.api';

vi.mock('@/features/auth/auth.api', () => ({
  useLogoutMutation: vi.fn(),
}));
vi.mock('@/features/notification/notification.api', () => ({
  useUnreadNotificationCountQuery: vi.fn(),
}));

const mockedLogout = vi.mocked(useLogoutMutation);
const mockedUnreadCount = vi.mocked(useUnreadNotificationCountQuery);

const SESSION: AuthSessionResponse = {
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

const logout = vi.fn();

const renderAccount = (options: { unread?: number } = {}): void => {
  logout.mockReset().mockResolvedValue({ data: { success: true } });
  mockedLogout.mockReturnValue([logout, { isLoading: false }] as unknown as ReturnType<
    typeof useLogoutMutation
  >);
  mockedUnreadCount.mockReturnValue({
    data: { unread: options.unread ?? 0 },
  } as unknown as ReturnType<typeof useUnreadNotificationCountQuery>);

  const store = createStore();
  store.dispatch(sessionEstablished(SESSION));

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/account']}>
        <Routes>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/login" element={<p>Login page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('AccountPage', () => {
  it("shows the signed-in customer's email", () => {
    renderAccount();

    expect(screen.getByText('shopper@example.com')).toBeInTheDocument();
  });

  it('links to the orders the app actually has', () => {
    renderAccount();

    expect(screen.getByRole('link', { name: /my orders/i })).toHaveAttribute('href', '/orders');
  });

  it('links to notifications', () => {
    renderAccount();

    expect(screen.getByRole('link', { name: /notifications/i })).toHaveAttribute(
      'href',
      '/notifications',
    );
  });

  it('surfaces the unread notification count', () => {
    renderAccount({ unread: 3 });

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows no unread badge when there is nothing unread', () => {
    renderAccount({ unread: 0 });

    const notificationsLink = screen.getByRole('link', { name: /notifications/i });
    expect(notificationsLink).not.toHaveTextContent(/^\d/);
  });

  it('logs out and redirects to /login', async () => {
    renderAccount();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    expect(logout).toHaveBeenCalledWith({ refreshToken: 'refresh-token' });
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });
});
