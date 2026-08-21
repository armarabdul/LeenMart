import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { Link, useLocation, useNavigate, type Location } from 'react-router-dom';
import { loginRequestSchema } from '@leen-mart/contracts';
import { Alert, Button, Input } from '@leen-mart/ui';
import { useLoginMutation } from '@/features/auth/auth.api';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { PasswordField } from '@/features/auth/components/PasswordField';
import { apiErrorMessage, apiFieldErrors } from '@/shared/api/base-api';
import { validateWithSchema } from '@/shared/lib/validate-with-schema';

interface LoginLocationState {
  readonly from?: Location;
}

type FieldName = 'email' | 'password';
const FIELD_ORDER: readonly FieldName[] = ['email', 'password'];

export const LoginPage = (): JSX.Element => {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [login, { isLoading, error }] = useLoginMutation();

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Record<FieldName, RefObject<HTMLInputElement>> = {
    email: emailRef,
    password: passwordRef,
  };

  // Live, not just on submit — a field's error clears the moment its value
  // becomes valid, matching every other form this phase touched.
  const localErrors = validateWithSchema(loginRequestSchema, { email, password });
  const serverFieldErrors = apiFieldErrors(error);
  const fieldError = (field: FieldName): string | undefined =>
    (touched[field] ? localErrors[field] : undefined) ?? serverFieldErrors[field];
  // A field-mapped server error already explains itself next to the field —
  // repeating it in a form-level banner too would just be noise. Only show
  // the banner when nothing could be pinned to a specific field (e.g. the
  // deliberately generic "invalid email or password", SEC-15).
  const hasMappedServerError = Object.keys(serverFieldErrors).length > 0;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isLoading) return;

    setTouched({ email: true, password: true });
    if (Object.keys(localErrors).length > 0) {
      const firstInvalid = FIELD_ORDER.find((field) => localErrors[field]);
      if (firstInvalid) fieldRefs[firstInvalid].current?.focus();
      return;
    }

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
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-4"
        noValidate
      >
        <Input
          ref={emailRef}
          label="Email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, email: true }))}
          error={fieldError('email')}
        />

        <PasswordField
          ref={passwordRef}
          label="Password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, password: true }))}
          error={fieldError('password')}
        />

        {error && !hasMappedServerError && <Alert tone="danger">{apiErrorMessage(error)}</Alert>}

        <Button type="submit" size="lg" loading={isLoading} className="w-full">
          {isLoading ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </AuthLayout>
  );
};
