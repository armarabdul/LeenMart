import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createStore } from '@/app/store';
import { MfaEnrollPage } from '@/pages/MfaEnrollPage';
import { useConfirmMfaEnrollmentMutation, useEnrollMfaMutation } from '@/features/auth/auth.api';

vi.mock('@/features/auth/auth.api', () => ({
  useEnrollMfaMutation: vi.fn(),
  useConfirmMfaEnrollmentMutation: vi.fn(),
}));

const mockedUseEnrollMfaMutation = vi.mocked(useEnrollMfaMutation);
const mockedUseConfirmMfaEnrollmentMutation = vi.mocked(useConfirmMfaEnrollmentMutation);
const mockEnrollMfa = vi.fn();
const mockConfirm = vi.fn();

interface StubOptions {
  readonly enrollRejects?: boolean;
  readonly enrollError?: unknown;
  readonly confirmRejects?: boolean;
  readonly confirmError?: unknown;
}

const stub = (options: StubOptions = {}): void => {
  mockEnrollMfa.mockReset();
  mockConfirm.mockReset();
  mockEnrollMfa.mockReturnValue({
    unwrap: () =>
      options.enrollRejects === true
        ? Promise.reject(Object.assign(new Error('nope'), { status: 401 }))
        : Promise.resolve({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Leen%20Mart' }),
  });
  mockConfirm.mockReturnValue({
    unwrap: () =>
      options.confirmRejects === true
        ? Promise.reject(Object.assign(new Error('nope'), { status: 401 }))
        : Promise.resolve({}),
  });
  mockedUseEnrollMfaMutation.mockReturnValue([
    mockEnrollMfa,
    { isLoading: false, error: options.enrollError },
  ] as unknown as ReturnType<typeof useEnrollMfaMutation>);
  mockedUseConfirmMfaEnrollmentMutation.mockReturnValue([
    mockConfirm,
    { isLoading: false, error: options.confirmError },
  ] as unknown as ReturnType<typeof useConfirmMfaEnrollmentMutation>);
};

const renderEnroll = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/mfa/enroll']}>
        <Routes>
          <Route path="/mfa/enroll" element={<MfaEnrollPage />} />
          <Route path="/" element={<p>Dashboard</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

const startEnrolment = async (): Promise<void> => {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start enrolment' }));
  await screen.findByLabelText('Authentication code');
};

describe('MfaEnrollPage', () => {
  it('shows the one-time secret and otpauth URI once enrolment starts', async () => {
    stub();
    renderEnroll();

    await startEnrolment();

    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByText('otpauth://totp/Leen%20Mart')).toBeInTheDocument();
  });

  it('shows a server error and stays on the credentials phase when starting enrolment fails', async () => {
    stub({ enrollRejects: true, enrollError: { status: 401, data: {} } });
    renderEnroll();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start enrolment' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();
  });

  it('re-submits the same email and password on confirmation, matching the real contract', async () => {
    stub();
    renderEnroll();
    await startEnrolment();

    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));

    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith({
        email: 'admin@example.com',
        password: 'correct-horse',
        totpCode: '654321',
      }),
    );
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });

  it('shows a server error on a failed confirmation', async () => {
    stub({ confirmRejects: true, confirmError: { status: 401, data: {} } });
    renderEnroll();
    await startEnrolment();

    fireEvent.change(screen.getByLabelText('Authentication code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and sign in' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('links back to /login for an already-enrolled administrator', () => {
    stub();
    renderEnroll();

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
