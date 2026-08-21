import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Input } from '@leen-mart/ui';
import { useRegisterMutation } from '@/features/auth/auth.api';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { PasswordField } from '@/features/auth/components/PasswordField';
import { apiErrorMessage } from '@/shared/api/base-api';

export const RegisterPage = (): JSX.Element => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, { isLoading, error }] = useRegisterMutation();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await register({ email, password }).unwrap();
      void navigate('/account');
    } catch {
      // Surfaced below via `error` from the mutation hook.
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Register with your email to get started."
      footer={
        <p className="text-center text-sm text-text-muted">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            Log in
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
          minLength={8}
          autoComplete="new-password"
          hint="At least 8 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && <Alert tone="danger">{apiErrorMessage(error)}</Alert>}

        <Button type="submit" size="lg" loading={isLoading} className="w-full">
          {isLoading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
};
