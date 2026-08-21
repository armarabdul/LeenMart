import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router-dom';
import { createStore } from '@/app/store';
import { LoginPage } from '@/pages/LoginPage';
import { useLoginMutation } from '@/features/auth/auth.api';

vi.mock('@/features/auth/auth.api', () => ({
  useLoginMutation: vi.fn(),
}));

const mockedUseLoginMutation = vi.mocked(useLoginMutation);
const mockLogin = vi.fn();

interface StubOptions {
  readonly isLoading?: boolean;
  readonly error?: unknown;
}

const stubLogin = (options: StubOptions = {}): void => {
  mockLogin.mockReset();
  mockLogin.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  mockedUseLoginMutation.mockReturnValue([
    mockLogin,
    { isLoading: options.isLoading ?? false, error: options.error },
  ] as unknown as ReturnType<typeof useLoginMutation>);
};

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
    stubLogin();
    renderLoginAt(['/login']);

    submitLogin();

    await waitFor(() => expect(screen.getByText('Account page')).toBeInTheDocument());
  });

  it('returns to the page that redirected here (e.g. a product page reached via Add to Cart)', async () => {
    stubLogin();
    renderLoginAt([
      { pathname: '/login', state: { from: { pathname: '/products/abc', search: '' } } },
    ]);

    submitLogin();

    await waitFor(() => expect(screen.getByText('Product page')).toBeInTheDocument());
  });
});

describe('LoginPage password visibility', () => {
  it('keeps the password field masked until the reader asks to reveal it', () => {
    stubLogin();
    renderLoginAt(['/login']);

    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });
});

describe('LoginPage field validation (Phase H)', () => {
  it('shows an inline error for an invalid email and does not call the API', () => {
    stubLogin();
    renderLoginAt(['/login']);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByText('Invalid email')).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('reports an empty password as its own inline error, not a native-only bubble', () => {
    stubLogin();
    renderLoginAt(['/login']);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'shopper@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(screen.getByText('String must contain at least 1 character(s)')).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('clears the inline error once the value becomes valid', () => {
    stubLogin();
    renderLoginAt(['/login']);
    const email = screen.getByLabelText('Email');

    fireEvent.change(email, { target: { value: 'not-an-email' } });
    fireEvent.blur(email);
    expect(screen.getByText('Invalid email')).toBeInTheDocument();

    fireEvent.change(email, { target: { value: 'shopper@example.com' } });
    expect(screen.queryByText('Invalid email')).not.toBeInTheDocument();
  });

  it('associates the error with the field for assistive technology', () => {
    stubLogin();
    renderLoginAt(['/login']);
    const email = screen.getByLabelText('Email');

    fireEvent.change(email, { target: { value: 'not-an-email' } });
    fireEvent.blur(email);

    expect(email).toHaveAttribute('aria-invalid', 'true');
    const describedBy = email.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent('Invalid email');
  });

  it('does not submit while a request is already in flight', () => {
    stubLogin({ isLoading: true });
    renderLoginAt(['/login']);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'shopper@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    // The submit button is disabled while loading (`Button`'s own
    // `loading` behaviour) — this exercises the form's own `isLoading`
    // guard directly, the same defence-in-depth the other forms this phase
    // touched all share.
    const form = screen.getByRole('button', { name: 'Logging in…' }).closest('form');
    if (form) fireEvent.submit(form);

    expect(mockLogin).not.toHaveBeenCalled();
  });
});

describe('LoginPage server-side error presentation (Phase H)', () => {
  it('surfaces a generic credential error as a form-level alert, not attached to one field', () => {
    stubLogin({
      error: {
        status: 401,
        data: {
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
            requestId: 'req-1',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    renderLoginAt(['/login']);

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('maps a field-scoped validation error from the API onto that field', () => {
    stubLogin({
      error: {
        status: 400,
        data: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The request payload failed validation.',
            details: [{ field: 'body.email', issue: 'Must be a valid email address.' }],
            requestId: 'req-2',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    renderLoginAt(['/login']);

    expect(screen.getByText('Must be a valid email address.')).toBeInTheDocument();
  });
});
