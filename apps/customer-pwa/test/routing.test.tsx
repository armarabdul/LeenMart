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
    email: 'shopper@example.com',
    role: 'CUSTOMER',
  },
  accessToken: 'access-token',
  accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: '2026-01-31T00:00:00.000Z',
};

/**
 * Mirrors the exact nesting `router.tsx` uses — `/products/:id` public,
 * `/cart` wrapped in `RequireAuth` the same way `/account` already is — as a
 * lean fixture rather than booting the full lazy-loaded `AppRouter` (which
 * would also exercise every other page's own data fetching). This verifies
 * the guarding *behaviour*; the actual `router.tsx` wiring is additionally
 * exercised by the manual browser walkthrough.
 */
const renderAt = (path: string, store: ReturnType<typeof createStore>): void => {
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/products/:id" element={<p>Product detail page</p>} />
          <Route path="/login" element={<p>Login page</p>} />
          <Route element={<RequireAuth />}>
            <Route path="/cart" element={<p>Cart page</p>} />
            <Route path="/checkout" element={<p>Checkout page</p>} />
            <Route path="/orders/:id" element={<p>Order confirmation page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('product detail and cart route guarding', () => {
  it('renders the product detail page without a session', () => {
    renderAt('/products/abc', createStore());
    expect(screen.getByText('Product detail page')).toBeInTheDocument();
  });

  it('redirects an anonymous visitor from /cart to /login', () => {
    renderAt('/cart', createStore());
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('renders the cart page for an authenticated session', () => {
    const store = createStore();
    store.dispatch(sessionEstablished(SESSION));
    renderAt('/cart', store);
    expect(screen.getByText('Cart page')).toBeInTheDocument();
  });
});

describe('checkout and order confirmation route guarding (S3-3A)', () => {
  it('redirects an anonymous visitor from /checkout to /login', () => {
    renderAt('/checkout', createStore());
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('renders the checkout page for an authenticated session', () => {
    const store = createStore();
    store.dispatch(sessionEstablished(SESSION));
    renderAt('/checkout', store);
    expect(screen.getByText('Checkout page')).toBeInTheDocument();
  });

  it('redirects an anonymous visitor from /orders/:id to /login', () => {
    renderAt('/orders/00000000-0000-7000-8000-000000000099', createStore());
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });

  it('renders the order confirmation page for an authenticated session', () => {
    const store = createStore();
    store.dispatch(sessionEstablished(SESSION));
    renderAt('/orders/00000000-0000-7000-8000-000000000099', store);
    expect(screen.getByText('Order confirmation page')).toBeInTheDocument();
  });
});
