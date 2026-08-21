import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createStore } from '@/app/store';
import { LoginPage } from '@/pages/LoginPage';
import { useLoginMutation, useVerifyMfaMutation } from '@/features/auth/auth.api';

vi.mock('@/features/auth/auth.api', () => ({
  useLoginMutation: vi.fn(),
  useVerifyMfaMutation: vi.fn(),
}));

const mockedUseLoginMutation = vi.mocked(useLoginMutation);
const mockedUseVerifyMfaMutation = vi.mocked(useVerifyMfaMutation);
const mockLogin = vi.fn();
const mockVerifyMfa = vi.fn();

interface StubOptions {
  readonly loginRejects?: boolean;
  readonly loginLoading?: boolean;
  readonly loginError?: unknown;
  readonly verifyRejects?: boolean;
  readonly verifyLoading?: boolean;
  readonly verifyError?: unknown;
}

const stub = (options: StubOptions = {}): void => {
  mockLogin.mockReset();
  mockVerifyMfa.mockReset();
  mockLogin.mockReturnValue({
    unwrap: () =>
      options.loginRejects === true
        ? Promise.reject(Object.assign(new Error('nope'), { status: 401 }))
        : Promise.resolve({ mfaChallengeToken: 'challenge-1' }),
  });
  mockVerifyMfa.mockReturnValue({
    unwrap: () =>
      options.verifyRejects === true
        ? Promise.reject(Object.assign(new Error('nope'), { status: 401 }))
        : Promise.resolve({}),
  });
  mockedUseLoginMutation.mockReturnValue([
    mockLogin,
    { isLoading: options.loginLoading ?? false, error: options.loginError },
  ] as unknown as ReturnType<typeof useLoginMutation>);
  mockedUseVerifyMfaMutation.mockReturnValue([
    mockVerifyMfa,
    { isLoading: options.verifyLoading ?? false, error: options.verifyError },
  ] as unknown as ReturnType<typeof useVerifyMfaMutation>);
};

const renderLogin = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p>Dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('LoginPage', () => {
  it('always offers the MFA enrolment link, since a failed sign-in cannot be told apart from "not enrolled yet"', () => {
    stub();
    renderLogin();

    expect(screen.getByRole('link', { name: 'Enrol multi-factor authentication' })).toHaveAttribute(
      'href',
      '/mfa/enroll',
    );
  });

  it('submits credentials and advances to the TOTP phase on a successful challenge', async () => {
    stub();
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() =>
      expect(mockLogin).toHaveBeenCalledWith({
        email: 'admin@example.com',
        password: 'correct-horse',
      }),
    );
    expect(await screen.findByLabelText('Authentication code')).toBeInTheDocument();
    expect(mockVerifyMfa).not.toHaveBeenCalled();
  });

  it('shows a server error and stays on the credentials phase when step one fails', async () => {
    stub({ loginRejects: true, loginError: { status: 401, data: {} } });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();
  });

  it('verifies the TOTP code and redirects to / on success', async () => {
    stub();
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.change(await screen.findByLabelText('Authentication code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(mockVerifyMfa).toHaveBeenCalledWith({
        mfaChallengeToken: 'challenge-1',
        totpCode: '123456',
      }),
    );
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('lets the administrator start over from the TOTP phase, discarding the challenge token', async () => {
    stub();
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByLabelText('Authentication code');

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));

    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();
  });

  it('shows a server error on a failed TOTP verification', async () => {
    stub({ verifyRejects: true, verifyError: { status: 401, data: {} } });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.change(await screen.findByLabelText('Authentication code'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
