import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PASSWORD_MIN_LENGTH, registerCustomerRequestSchema } from '@leen-mart/contracts';
import { Alert, Button, Input } from '@leen-mart/ui';
import { useRegisterMutation } from '@/features/auth/auth.api';
import { useRegisterVendorMutation } from '@/features/vendor/vendor.api';
import { apiErrorMessage, apiFieldErrors, isApiError } from '@/shared/api/base-api';
import { validateWithSchema } from '@/shared/lib/validate-with-schema';

type FieldName = 'email' | 'password';
const FIELD_ORDER: readonly FieldName[] = ['email', 'password'];

/**
 * Vendor registration (Phase J), composed from two real, existing endpoints
 * rather than a new one: `POST /identity/register` (creates the account,
 * mirroring customer-pwa's own `RegisterPage` field-for-field — same
 * `registerCustomerRequestSchema`, no invented confirm-password requirement)
 * followed by `POST /vendors` (promotes it to a vendor).
 *
 * The two cannot be one atomic step: `RegisterVendorUseCase` revokes every
 * session as part of the promotion (the JWT's `role` claim can only change on
 * a fresh token), so this page always ends by sending the customer to
 * `/login` to pick up a token that actually asserts `VENDOR_OWNER` — never by
 * pretending the session it started with still works.
 */
export const RegisterPage = (): JSX.Element => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [register, { isLoading: isCreatingAccount, error: accountError }] = useRegisterMutation();
  const [registerVendor, { isLoading: isRegisteringVendor, error: vendorError }] =
    useRegisterVendorMutation();
  const isLoading = isCreatingAccount || isRegisteringVendor;

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Record<FieldName, RefObject<HTMLInputElement>> = {
    email: emailRef,
    password: passwordRef,
  };

  const localErrors = validateWithSchema(registerCustomerRequestSchema, { email, password });
  const serverFieldErrors = apiFieldErrors(accountError);
  // `EMAIL_ALREADY_REGISTERED` is a conflict, not a schema failure — it
  // carries no `details` for `apiFieldErrors` to find, but the code alone
  // says unambiguously which field it's about (matches customer-pwa's own
  // `RegisterPage` idiom).
  const emailConflict =
    isApiError(accountError) && accountError.data.error.code === 'EMAIL_ALREADY_REGISTERED'
      ? apiErrorMessage(accountError)
      : undefined;
  const fieldError = (field: FieldName): string | undefined => {
    if (field === 'email' && emailConflict) return emailConflict;
    return (touched[field] ? localErrors[field] : undefined) ?? serverFieldErrors[field];
  };
  const hasMappedServerError =
    Object.keys(serverFieldErrors).length > 0 || emailConflict !== undefined;

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
      await register({ email, password }).unwrap();
    } catch {
      // Surfaced below via `accountError` from the mutation hook.
      return;
    }

    try {
      await registerVendor().unwrap();
    } catch {
      // The account exists and is still signed in (only a *successful*
      // promotion revokes the session) — surfaced below via `vendorError`,
      // with a way to retry from onboarding rather than losing the account.
      return;
    }

    void navigate('/login', { replace: true, state: { justRegistered: true } });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-5 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Become a vendor</h1>
        <p className="text-sm text-slate-600">Create your account to start selling on Leen Mart.</p>
      </header>

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

        <Input
          ref={passwordRef}
          label="Password"
          type="password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, password: true }))}
          error={fieldError('password')}
        />

        {accountError && !hasMappedServerError && (
          <Alert tone="danger">{apiErrorMessage(accountError)}</Alert>
        )}

        {vendorError !== undefined && (
          <Alert tone="danger" title="Your account was created">
            {apiErrorMessage(vendorError, 'We could not set your account up as a vendor just yet.')}{' '}
            You&apos;re already signed in — you can{' '}
            <Link to="/onboarding" className="font-medium underline">
              retry from onboarding
            </Link>
            .
          </Alert>
        )}

        <Button type="submit" size="lg" loading={isLoading} className="w-full">
          {isLoading ? 'Creating account…' : 'Create vendor account'}
        </Button>
      </form>

      <p className="text-center text-xs text-slate-500">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-brand-700 hover:text-brand-600">
          Sign in
        </Link>
      </p>
    </main>
  );
};
