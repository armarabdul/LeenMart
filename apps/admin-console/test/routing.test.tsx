import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthSessionResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { sessionEstablished } from '@/shared/api/session.slice';

const SESSION: AuthSessionResponse = {
  user: {
    id: '00000000-0000-7000-8000-000000000001',
    email: 'admin@example.com',
    role: 'SUPER_ADMIN',
  },
  accessToken: 'access-token',
  accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: '2026-01-31T00:00:00.000Z',
};

/** Mirrors `vendor-portal`'s own `routing.test.tsx` — a lean fixture rather than booting the full lazy-loaded `AppRouter`. */
const renderAt = (path: string, store: ReturnType<typeof createStore>): void => {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>Login page</p>} />
          <Route element={<RequireAuth />}>
            <Route path="/kyc-review" element={<p>KYC queue page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('admin console route guarding (Phase L, L2)', () => {
  it('redirects an anonymous visitor from a protected route to /login', () => {
    renderAt('/kyc-review', createStore());
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('renders the protected page for an authenticated session', () => {
    const store = createStore();
    store.dispatch(sessionEstablished(SESSION));
    renderAt('/kyc-review', store);
    expect(screen.getByText('KYC queue page')).toBeInTheDocument();
  });
});
