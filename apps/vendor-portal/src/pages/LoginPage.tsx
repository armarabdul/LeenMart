import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, type Location } from 'react-router-dom';
import { Alert } from '@leen-mart/ui';
import { useLoginMutation } from '@/features/auth/auth.api';
import { apiErrorMessage } from '@/shared/api/base-api';

interface LoginLocationState {
  readonly from?: Location;
  /** Set by `RegisterPage` after a successful `POST /vendors` — that call revokes the session it was made with, so this is the first screen the new vendor actually reaches. */
  readonly justRegistered?: boolean;
}

/** Mirrors `customer-pwa`'s own `LoginPage` — same form shape, redirect-back behaviour, and error handling. */
export const LoginPage = (): JSX.Element => {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [login, { isLoading, error }] = useLoginMutation();

  const state = location.state as LoginLocationState | null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await login({ email, password }).unwrap();
      // `/`, not a hardcoded `/orders`: `HomeRedirect` (Phase J) sends an
      // ACTIVE vendor to `/orders` and everyone else to `/onboarding` —
      // `/orders` itself requires `requireActiveVendor` server-side, which a
      // brand-new REGISTERED vendor would simply fail.
      void navigate(state?.from ? `${state.from.pathname}${state.from.search}` : '/', {
        replace: true,
      });
    } catch {
      // Surfaced below via `error` from the mutation hook.
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vendor sign in</h1>
        <p className="text-sm text-slate-600">Manage your incoming orders.</p>
      </header>

      {state?.justRegistered && (
        <Alert tone="success">Your vendor account was created. Sign in to continue.</Alert>
      )}

      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {apiErrorMessage(error)}
          </p>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-center text-xs text-slate-500">
        Not a vendor yet?{' '}
        <Link to="/register" className="font-medium text-brand-700 hover:text-brand-600">
          Register as a vendor
        </Link>
        .
      </p>
    </main>
  );
};
