import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthSessionResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { sessionEstablished } from '@/shared/api/session.slice';
import { AddToCartButton } from '@/features/product/components/AddToCartButton';

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

const renderButton = (
  store: ReturnType<typeof createStore>,
  props: Partial<{
    isLoading: boolean;
    justAdded: boolean;
    error: unknown;
    disabled: boolean;
  }> = {},
): { onAddToCart: ReturnType<typeof vi.fn> } => {
  const onAddToCart = vi.fn();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/products/abc']}>
        <Routes>
          <Route
            path="/products/abc"
            element={
              <AddToCartButton
                onAddToCart={onAddToCart}
                isLoading={props.isLoading ?? false}
                justAdded={props.justAdded ?? false}
                error={props.error}
                disabled={props.disabled}
              />
            }
          />
          <Route path="/login" element={<p>Login page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
  return { onAddToCart };
};

describe('AddToCartButton', () => {
  it('redirects an anonymous customer to /login instead of calling onAddToCart', () => {
    const { onAddToCart } = renderButton(createStore());

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(screen.getByText('Login page')).toBeInTheDocument();
    expect(onAddToCart).not.toHaveBeenCalled();
  });

  it('calls onAddToCart for an authenticated customer, without navigating away', () => {
    const store = createStore();
    store.dispatch(sessionEstablished(SESSION));
    const { onAddToCart } = renderButton(store);

    fireEvent.click(screen.getByRole('button', { name: /add to cart/i }));

    expect(onAddToCart).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Login page')).not.toBeInTheDocument();
  });

  it('shows a loading state and disables the button while the mutation is in flight', () => {
    const store = createStore();
    store.dispatch(sessionEstablished(SESSION));
    renderButton(store, { isLoading: true });

    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled();
  });

  it('shows success feedback after a successful add', () => {
    const store = createStore();
    store.dispatch(sessionEstablished(SESSION));
    renderButton(store, { justAdded: true });

    expect(screen.getByRole('button', { name: 'Added to cart' })).toBeInTheDocument();
  });

  it('surfaces a mutation error message', () => {
    const store = createStore();
    store.dispatch(sessionEstablished(SESSION));
    renderButton(store, {
      error: {
        status: 422,
        data: { error: { code: 'INSUFFICIENT_INVENTORY', message: 'Not enough stock.' } },
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Not enough stock.');
  });
});
