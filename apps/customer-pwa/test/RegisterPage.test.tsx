import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createStore } from '@/app/store';
import { RegisterPage } from '@/pages/RegisterPage';

const mockRegister = vi.fn();

vi.mock('@/features/auth/auth.api', () => ({
  useRegisterMutation: () => [mockRegister, { isLoading: false, error: undefined }],
}));

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
    mockRegister.mockReturnValue({ unwrap: () => Promise.resolve({}) });
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
    mockRegister.mockReturnValue({ unwrap: () => Promise.resolve({}) });
    renderRegister();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'shopper@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Account page')).toBeInTheDocument();
  });

  it('does not weaken the minimum password length', () => {
    renderRegister();

    expect(screen.getByLabelText('Password')).toHaveAttribute('minLength', '8');
  });

  it('keeps the password field masked until the reader asks to reveal it', () => {
    renderRegister();

    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('offers a route back to /login', () => {
    renderRegister();

    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });
});
