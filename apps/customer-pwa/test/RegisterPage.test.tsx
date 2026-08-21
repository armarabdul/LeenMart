import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PASSWORD_MIN_LENGTH } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { RegisterPage } from '@/pages/RegisterPage';
import { useRegisterMutation } from '@/features/auth/auth.api';

vi.mock('@/features/auth/auth.api', () => ({
  useRegisterMutation: vi.fn(),
}));

const mockedUseRegisterMutation = vi.mocked(useRegisterMutation);
const mockRegister = vi.fn();

interface StubOptions {
  readonly isLoading?: boolean;
  readonly error?: unknown;
}

const stubRegister = (options: StubOptions = {}): void => {
  mockRegister.mockReset();
  mockRegister.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  mockedUseRegisterMutation.mockReturnValue([
    mockRegister,
    { isLoading: options.isLoading ?? false, error: options.error },
  ] as unknown as ReturnType<typeof useRegisterMutation>);
};

const renderRegister = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/account" element={<p>Account page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('RegisterPage', () => {
  it('preserves the exact registration contract — email and password only, no invented fields', async () => {
    stubRegister();
    renderRegister();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'shopper@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith({
        email: 'shopper@example.com',
        password: 'correct-horse-battery',
      }),
    );
  });

  it('navigates to /account once the server accepts the registration', async () => {
    stubRegister();
    renderRegister();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'shopper@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Account page')).toBeInTheDocument();
  });

  it('matches the real backend password-length rule, not a guessed one', () => {
    // Phase H: this was previously hardcoded to 8, which silently drifted
    // from the actual `PASSWORD_MIN_LENGTH` (10) the API enforces — a
    // customer could pass this page's own validation and still have the
    // server reject an 8- or 9-character password. Asserting against the
    // shared contract constant, not a literal, is what keeps this from
    // drifting again.
    stubRegister();
    renderRegister();

    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'minLength',
      String(PASSWORD_MIN_LENGTH),
    );
  });

  it('keeps the password field masked until the reader asks to reveal it', () => {
    stubRegister();
    renderRegister();

    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('offers a route back to /login', () => {
    stubRegister();
    renderRegister();

    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });
});

describe('RegisterPage field validation (Phase H)', () => {
  it('shows an inline error for an invalid email and does not call the API', () => {
    stubRegister();
    renderRegister();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Invalid email')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('shows an inline error for a too-short password using the real minimum, and does not call the API', () => {
    stubRegister();
    renderRegister();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'shopper@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(
      screen.getByText(`String must contain at least ${PASSWORD_MIN_LENGTH} character(s)`),
    ).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('clears the inline password error once it reaches the minimum length', () => {
    stubRegister();
    renderRegister();
    const password = screen.getByLabelText('Password');

    fireEvent.change(password, { target: { value: 'short' } });
    fireEvent.blur(password);
    expect(
      screen.getByText(`String must contain at least ${PASSWORD_MIN_LENGTH} character(s)`),
    ).toBeInTheDocument();

    fireEvent.change(password, { target: { value: 'correct-horse-battery' } });
    expect(
      screen.queryByText(`String must contain at least ${PASSWORD_MIN_LENGTH} character(s)`),
    ).not.toBeInTheDocument();
  });

  it('associates the password error with the field for assistive technology', () => {
    stubRegister();
    renderRegister();
    const password = screen.getByLabelText('Password');

    fireEvent.change(password, { target: { value: 'short' } });
    fireEvent.blur(password);

    expect(password).toHaveAttribute('aria-invalid', 'true');
    const describedBy = password.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(
      `String must contain at least ${PASSWORD_MIN_LENGTH} character(s)`,
    );
  });
});

describe('RegisterPage server-side error presentation (Phase H)', () => {
  it('maps a duplicate-email conflict onto the email field, not a generic banner', () => {
    stubRegister({
      error: {
        status: 409,
        data: {
          error: {
            code: 'EMAIL_ALREADY_REGISTERED',
            message: 'An account with this email address already exists.',
            requestId: 'req-1',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    renderRegister();

    expect(
      screen.getByText('An account with this email address already exists.'),
    ).toBeInTheDocument();
    // Mapped to the field — not repeated a second time as a form-level banner.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
