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
    email: 'vendor@example.com',
    role: 'VENDOR_OWNER',
  },
  accessToken: 'access-token',
  accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: '2026-01-31T00:00:00.000Z',
};

/** Mirrors `customer-pwa`'s own `routing.test.tsx` — a lean fixture rather than booting the full lazy-loaded `AppRouter`. */
const renderAt = (path: string, store: ReturnType<typeof createStore>): void => {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<p>Login page</p>} />
          <Route element={<RequireAuth />}>
            <Route path="/orders" element={<p>Vendor orders page</p>} />
            <Route path="/orders/:id" element={<p>Vendor order detail page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('vendor order route guarding (S3-5)', () => {
  it('redirects an anonymous visitor from /orders to /login', () => {
    renderAt('/orders', createStore());
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('renders the vendor orders page for an authenticated session', () => {
    const store = createStore();
    store.dispatch(sessionEstablished(SESSION));
    renderAt('/orders', store);
    expect(screen.getByText('Vendor orders page')).toBeInTheDocument();
  });

  it('redirects an anonymous visitor from /orders/:id to /login', () => {
    renderAt('/orders/00000000-0000-7000-8000-000000000099', createStore());
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('renders the vendor order detail page for an authenticated session', () => {
    const store = createStore();
    store.dispatch(sessionEstablished(SESSION));
    renderAt('/orders/00000000-0000-7000-8000-000000000099', store);
    expect(screen.getByText('Vendor order detail page')).toBeInTheDocument();
  });
});
