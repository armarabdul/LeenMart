import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createStore } from '@/app/store';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { sessionEstablished } from '@/shared/api/session.slice';

const renderWithGuard = (store: ReturnType<typeof createStore>): void => {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/account']}>
        <Routes>
          <Route path="/login" element={<p>Login page</p>} />
          <Route element={<RequireAuth />}>
            <Route path="/account" element={<p>Account page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('RequireAuth', () => {
  it('redirects to /login when no session exists', () => {
    renderWithGuard(createStore());
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('renders the protected route when a session exists', () => {
    const store = createStore();
    store.dispatch(
      sessionEstablished({
        user: {
          id: '00000000-0000-7000-8000-000000000001',
          email: 'shopper@example.com',
          role: 'CUSTOMER',
        },
        accessToken: 'access-token',
        accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
        refreshToken: 'refresh-token',
        refreshTokenExpiresAt: '2026-01-31T00:00:00.000Z',
      }),
    );

    renderWithGuard(store);
    expect(screen.getByText('Account page')).toBeInTheDocument();
  });
});
