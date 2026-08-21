import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Button, Input } from '@leen-mart/ui';
import { useConfirmMfaEnrollmentMutation, useEnrollMfaMutation } from '@/features/auth/auth.api';
import { apiErrorMessage } from '@/shared/api/base-api';

type EnrollPhase = 'credentials' | 'confirm';

/**
 * Admin MFA enrolment (Phase L, SDD 7.1). Mirrors `LoginPage`'s own
 * two-phase shape: phase 1 (email + password) starts enrolment and returns
 * a plaintext secret + `otpauthUri` — shown here **exactly once**, never
 * re-fetchable (`AdminMfaEnrollUseCase`'s own doc comment). Phase 2 proves
 * possession of that secret with a TOTP code and, per the real contract
 * (`adminMfaEnrollConfirmRequestSchema`), re-submits the *same* email and
 * password rather than a token from phase 1 — `AdminMfaEnrollConfirmUseCase`
 * re-verifies the password independently, trusting nothing carried over
 * from the enrol step.
 *
 * Email and password are therefore held in this component's own state
 * across both phases — never in Redux, never in Web Storage, never sent
 * anywhere except these two calls — the same "in memory only" boundary
 * every credential on this platform already keeps.
 */
export const MfaEnrollPage = (): JSX.Element => {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<EnrollPhase>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');

  const [enrollMfa, { isLoading: isStarting, error: enrollError }] = useEnrollMfaMutation();
  const [confirmMfaEnrollment, { isLoading: isConfirming, error: confirmError }] =
    useConfirmMfaEnrollmentMutation();

  const handleStart = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      const result = await enrollMfa({ email, password }).unwrap();
      setSecret(result.secret);
      setOtpauthUri(result.otpauthUri);
      setPhase('confirm');
    } catch {
      // Surfaced below via `enrollError`.
    }
  };

  const handleConfirm = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    try {
      await confirmMfaEnrollment({ email, password, totpCode }).unwrap();
      void navigate('/', { replace: true });
    } catch {
      // Surfaced below via `confirmError`.
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Enrol multi-factor authentication
        </h1>
        <p className="text-sm text-slate-600">
          Required for every admin account before it can sign in.
        </p>
      </header>

      {phase === 'credentials' ? (
        <form
          onSubmit={(event) => void handleStart(event)}
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

          {enrollError !== undefined && (
            <Alert tone="danger">
              {apiErrorMessage(enrollError, 'Enrolment could not be started.')}
            </Alert>
          )}

          <Button type="submit" size="lg" loading={isStarting} className="w-full">
            {isStarting ? 'Starting…' : 'Start enrolment'}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(event) => void handleConfirm(event)}
          className="flex flex-col gap-4"
          noValidate
        >
          <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-700">
              Add this key to your authenticator app
            </p>
            <p className="break-all font-mono text-sm text-slate-900">{secret}</p>
            <p className="text-xs text-slate-500">
              Shown once — if you lose it before confirming, start over.
            </p>
            <p className="break-all text-xs text-slate-400">{otpauthUri}</p>
          </div>

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

          {confirmError !== undefined && (
            <Alert tone="danger">
              {apiErrorMessage(confirmError, 'Enrolment could not be confirmed.')}
            </Alert>
          )}

          <Button type="submit" size="lg" loading={isConfirming} className="w-full">
            {isConfirming ? 'Confirming…' : 'Confirm and sign in'}
          </Button>
        </form>
      )}

      <p className="text-center text-xs text-slate-500">
        Already enrolled?{' '}
        <Link to="/login" className="font-medium text-brand-700 hover:text-brand-600">
          Sign in
        </Link>
        .
      </p>
    </main>
  );
};
