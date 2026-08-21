import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PASSWORD_MIN_LENGTH } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { RegisterPage } from '@/pages/RegisterPage';
import { useRegisterMutation } from '@/features/auth/auth.api';
import { useRegisterVendorMutation } from '@/features/vendor/vendor.api';

vi.mock('@/features/auth/auth.api', () => ({ useRegisterMutation: vi.fn() }));
vi.mock('@/features/vendor/vendor.api', () => ({ useRegisterVendorMutation: vi.fn() }));

const mockedUseRegisterMutation = vi.mocked(useRegisterMutation);
const mockedUseRegisterVendorMutation = vi.mocked(useRegisterVendorMutation);
const mockRegister = vi.fn();
const mockRegisterVendor = vi.fn();

interface StubOptions {
  readonly accountLoading?: boolean;
  readonly accountError?: unknown;
  readonly accountRejects?: boolean;
  readonly vendorLoading?: boolean;
  readonly vendorError?: unknown;
  readonly vendorRejects?: boolean;
}

const stub = (options: StubOptions = {}): void => {
  mockRegister.mockReset();
  mockRegisterVendor.mockReset();
  mockRegister.mockReturnValue({
    unwrap: () =>
      options.accountRejects === true
        ? Promise.reject(Object.assign(new Error('nope'), { status: 400 }))
        : Promise.resolve({}),
  });
  mockRegisterVendor.mockReturnValue({
    unwrap: () =>
      options.vendorRejects === true
        ? Promise.reject(Object.assign(new Error('nope'), { status: 400 }))
        : Promise.resolve({}),
  });
  mockedUseRegisterMutation.mockReturnValue([
    mockRegister,
    { isLoading: options.accountLoading ?? false, error: options.accountError },
  ] as unknown as ReturnType<typeof useRegisterMutation>);
  mockedUseRegisterVendorMutation.mockReturnValue([
    mockRegisterVendor,
    { isLoading: options.vendorLoading ?? false, error: options.vendorError },
  ] as unknown as ReturnType<typeof useRegisterVendorMutation>);
};

const renderRegister = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<p>Login page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

const fillValid = (): void => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'vendor@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'correct-horse-battery' },
  });
};

describe('RegisterPage', () => {
  it('shows inline errors for an empty submission and never calls either endpoint', () => {
    stub();
    renderRegister();

    fireEvent.click(screen.getByRole('button', { name: 'Create vendor account' }));

    expect(screen.getByText('Invalid email')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockRegisterVendor).not.toHaveBeenCalled();
  });

  it('shows an inline error for an invalid email and does not submit', () => {
    stub();
    renderRegister();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create vendor account' }));

    expect(screen.getByText('Invalid email')).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('shows an inline error for a too-short password using the real minimum', () => {
    stub();
    renderRegister();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'vendor@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create vendor account' }));

    expect(
      screen.getByText(`String must contain at least ${PASSWORD_MIN_LENGTH} character(s)`),
    ).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('clears the inline password error live, without a resubmit', () => {
    stub();
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

  it('does not invent a confirm-password field the backend contract has no room for', () => {
    stub();
    renderRegister();

    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
  });

  it('registers the account, then promotes it to vendor, on a valid submission', async () => {
    stub();
    renderRegister();

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Create vendor account' }));

    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith({
        email: 'vendor@example.com',
        password: 'correct-horse-battery',
      }),
    );
    await waitFor(() => expect(mockRegisterVendor).toHaveBeenCalledWith());
  });

  it('sends the vendor to /login (never keeps the pre-promotion session) once both steps succeed', async () => {
    stub();
    renderRegister();

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Create vendor account' }));

    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('links back to /login for an already-registered vendor', () => {
    stub();
    renderRegister();

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});

// A sibling top-level block rather than a nested one: the file's outer
// describe would otherwise exceed this repository's function-length budget.
describe('RegisterPage server-side error presentation', () => {
  it('maps a duplicate-email conflict onto the email field, not a generic banner', () => {
    stub({
      accountError: {
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
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('offers a retry from onboarding, without discarding the account, if the vendor step fails', () => {
    stub({
      vendorError: {
        status: 500,
        data: {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Something went wrong.',
            requestId: 'req-1',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    renderRegister();

    expect(screen.getByText('Your account was created')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'retry from onboarding' })).toHaveAttribute(
      'href',
      '/onboarding',
    );
  });

  it('disables further submission while either step is in flight', () => {
    stub({ accountLoading: true });
    renderRegister();

    expect(screen.getByRole('button', { name: 'Creating account…' })).toBeDisabled();
  });
});
