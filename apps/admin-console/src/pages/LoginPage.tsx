import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, type Location } from 'react-router-dom';
import { Alert, Button, Input } from '@leen-mart/ui';
import { useLoginMutation, useVerifyMfaMutation } from '@/features/auth/auth.api';
import { apiErrorMessage } from '@/shared/api/base-api';

interface LoginLocationState {
  readonly from?: Location;
}

type LoginPhase = 'credentials' | 'totp';

/**
 * Admin sign-in (Phase L, SDD 7.1). Two phases within one page, mirroring
 * the two real HTTP calls that make up admin login: step 1
 * (email + password → an opaque MFA challenge, never a session) and step 2
 * (challenge + TOTP → a real session). There is no third, "skip MFA" path —
 * `POST /admin/login` refuses an administrator with no confirmed MFA
 * secret outright (`AdminLoginStepOneUseCase`), so a failed step 1 here is
 * never distinguishable from "you have not enrolled yet"; the link to
 * `/mfa/enroll` is therefore always shown, not conditionally revealed
 * after a failure (SEC-15 — see `auth.api.ts`'s own doc comment).
 *
 * The `mfaChallengeToken` lives only in this component's own state, never
 * in Redux and never in Web Storage: it is a short-lived, single-use
 * bearer credential for exactly one follow-up call, not a session.
 */
export const LoginPage = (): JSX.Element => {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LoginLocationState | null;

  const [phase, setPhase] = useState<LoginPhase>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [mfaChallengeToken, setMfaChallengeToken] = useState('');

  const [login, { isLoading: isLoggingIn, error: loginError }] = useLoginMutation();
  const [verifyMfa, { isLoading: isVerifying, error: verifyError }] = useVerifyMfaMutation();

  const handleCredentialsSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      const result = await login({ email, password }).unwrap();
      setMfaChallengeToken(result.mfaChallengeToken);
      setPhase('totp');
    } catch {
      // Surfaced below via `loginError`.
    }
  };

  const handleTotpSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await verifyMfa({ mfaChallengeToken, totpCode }).unwrap();
      void navigate(state?.from ? `${state.from.pathname}${state.from.search}` : '/', {
        replace: true,
      });
    } catch {
      // Surfaced below via `verifyError`.
    }
  };

  const handleStartOver = (): void => {
    setPhase('credentials');
    setTotpCode('');
    setMfaChallengeToken('');
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Admin sign in</h1>
        <p className="text-sm text-slate-600">Manage vendor KYC, product listings and reviews.</p>
      </header>

      {phase === 'credentials' ? (
        <form
          onSubmit={(event) => void handleCredentialsSubmit(event)}
          className="flex flex-col gap-4"
          noValidate
        >
          <Input
            label="Email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Input
            label="Password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {loginError !== undefined && (
            <Alert tone="danger">{apiErrorMessage(loginError, 'Sign in failed.')}</Alert>
          )}

          <Button type="submit" size="lg" loading={isLoggingIn} className="w-full">
            {isLoggingIn ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(event) => void handleTotpSubmit(event)}
          className="flex flex-col gap-4"
          noValidate
        >
          <p className="text-sm text-slate-600">
            Enter the 6-digit code from your authenticator app.
          </p>
          <Input
            label="Authentication code"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={totpCode}
            onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))}
          />

          {verifyError !== undefined && (
            <Alert tone="danger">{apiErrorMessage(verifyError, 'Verification failed.')}</Alert>
          )}

          <Button type="submit" size="lg" loading={isVerifying} className="w-full">
            {isVerifying ? 'Verifying…' : 'Verify'}
          </Button>
          <button
            type="button"
            onClick={handleStartOver}
            className="text-center text-xs text-slate-500 hover:text-slate-700"
          >
            Start over
          </button>
        </form>
      )}

      <p className="text-center text-xs text-slate-500">
        First time signing in?{' '}
        <Link to="/mfa/enroll" className="font-medium text-brand-700 hover:text-brand-600">
          Enrol multi-factor authentication
        </Link>
        .
      </p>
    </main>
  );
};
