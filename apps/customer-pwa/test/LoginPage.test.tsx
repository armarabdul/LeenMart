import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router-dom';
import { createStore } from '@/app/store';
import { LoginPage } from '@/pages/LoginPage';

const mockLogin = vi.fn();

vi.mock('@/features/auth/auth.api', () => ({
  useLoginMutation: () => [mockLogin, { isLoading: false, error: undefined }],
}));

const renderLoginAt = (initialEntries: InitialEntry[]): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/account" element={<p>Account page</p>} />
          <Route path="/products/:id" element={<p>Product page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

const submitLogin = (): void => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'shopper@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
};

/**
 * `RequireAuth` already sets `state: { from: location }` on its own
 * redirect (see `RequireAuth.test.tsx`) — this covers the other half: that
 * `LoginPage` actually reads it back, which is what makes "return to where
 * you came from" (e.g. `AddToCartButton`'s anonymous redirect) true rather
 * than every guarded route silently losing its destination.
 */
describe('LoginPage post-login redirect', () => {
  it('falls back to /account when no prior destination was recorded', async () => {
    mockLogin.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    renderLoginAt(['/login']);

    submitLogin();

    await waitFor(() => expect(screen.getByText('Account page')).toBeInTheDocument());
  });

  it('returns to the page that redirected here (e.g. a product page reached via Add to Cart)', async () => {
    mockLogin.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    renderLoginAt([
      { pathname: '/login', state: { from: { pathname: '/products/abc', search: '' } } },
    ]);

    submitLogin();

    await waitFor(() => expect(screen.getByText('Product page')).toBeInTheDocument());
  });
});
