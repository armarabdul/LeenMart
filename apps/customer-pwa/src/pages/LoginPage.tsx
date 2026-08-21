import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, type Location } from 'react-router-dom';
import { Alert, Button, Input } from '@leen-mart/ui';
import { useLoginMutation } from '@/features/auth/auth.api';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { PasswordField } from '@/features/auth/components/PasswordField';
import { apiErrorMessage } from '@/shared/api/base-api';

interface LoginLocationState {
  readonly from?: Location;
}

export const LoginPage = (): JSX.Element => {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [login, { isLoading, error }] = useLoginMutation();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await login({ email, password }).unwrap();
      // `RequireAuth` already sets this on its own redirect (`/account`,
      // `/cart`, or any future guarded route) — reading it back is what
      // makes "return to where you came from" actually true, rather than
      // every guarded route silently losing its destination to a hardcoded
      // `/account`.
      const from = (location.state as LoginLocationState | null)?.from;
      void navigate(from ? `${from.pathname}${from.search}` : '/account', { replace: true });
    } catch {
      // Surfaced below via `error` from the mutation hook.
    }
  };

  return (
    <AuthLayout
      title="Log in"
      subtitle="Welcome back to your marketplace."
      footer={
        <p className="text-center text-sm text-text-muted">
          Don&apos;t have an account?{' '}
          <Link
            to="/register"
            className="font-medium text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            Register
          </Link>
        </p>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <PasswordField
          label="Password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && <Alert tone="danger">{apiErrorMessage(error)}</Alert>}

        <Button type="submit" size="lg" loading={isLoading} className="w-full">
          {isLoading ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </AuthLayout>
  );
};
