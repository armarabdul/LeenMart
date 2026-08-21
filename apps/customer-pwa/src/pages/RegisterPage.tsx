import { useRef, useState, type FormEvent, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PASSWORD_MIN_LENGTH, registerCustomerRequestSchema } from '@leen-mart/contracts';
import { Alert, Button, Input } from '@leen-mart/ui';
import { useRegisterMutation } from '@/features/auth/auth.api';
import { AuthLayout } from '@/features/auth/components/AuthLayout';
import { PasswordField } from '@/features/auth/components/PasswordField';
import { apiErrorMessage, apiFieldErrors, isApiError } from '@/shared/api/base-api';
import { validateWithSchema } from '@/shared/lib/validate-with-schema';

type FieldName = 'email' | 'password';
const FIELD_ORDER: readonly FieldName[] = ['email', 'password'];

export const RegisterPage = (): JSX.Element => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [register, { isLoading, error }] = useRegisterMutation();

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Record<FieldName, RefObject<HTMLInputElement>> = {
    email: emailRef,
    password: passwordRef,
  };

  const localErrors = validateWithSchema(registerCustomerRequestSchema, { email, password });
  const serverFieldErrors = apiFieldErrors(error);
  // `EMAIL_ALREADY_REGISTERED` is a conflict, not a schema failure — it
  // carries no `details` for `apiFieldErrors` to find, but the code alone
  // says unambiguously which field it's about, the same way `CheckoutPage`
  // already switches on `error.code` for its own domain-specific messages.
  const emailConflict =
    isApiError(error) && error.data.error.code === 'EMAIL_ALREADY_REGISTERED'
      ? apiErrorMessage(error)
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
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, password: true }))}
          error={fieldError('password')}
        />

        {error && !hasMappedServerError && <Alert tone="danger">{apiErrorMessage(error)}</Alert>}

        <Button type="submit" size="lg" loading={isLoading} className="w-full">
          {isLoading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
};
