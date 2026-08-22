import { useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  PASSWORD_MIN_LENGTH,
  createAdminUserRequestSchema,
  type SubordinateAdminRoleDto,
} from '@leen-mart/contracts';
import { Alert, Button, Input, Select } from '@leen-mart/ui';
import {
  apiErrorMessage,
  apiFieldErrors,
  isApiError,
  isForbiddenError,
} from '@/shared/api/base-api';
import { validateWithSchema } from '@/shared/lib/validate-with-schema';
import { useCreateAdminUserMutation } from '../admin-user-management.api';

/**
 * Exactly the four subordinate roles `subordinateAdminRoleSchema` allows —
 * SUPER_ADMIN is never an option here, the same restriction the backend
 * contract itself enforces (`identity.contract.ts`'s own doc comment: "a
 * locked decision — creation here stays confined to the four subordinate
 * roles until a business decision explicitly says otherwise").
 */
const ROLE_OPTIONS: readonly SubordinateAdminRoleDto[] = [
  'CATALOGUE_MODERATOR',
  'FINANCE_ADMIN',
  'RISK_ANALYST',
  'SUPPORT_AGENT',
];

type FieldName = 'email' | 'password' | 'role';
const FIELD_ORDER: readonly FieldName[] = ['email', 'password', 'role'];

interface CreateAdminUserFormProps {
  readonly onCreated?: () => void;
}

interface FormFeedbackProps {
  readonly successEmail: string | null;
  readonly error: unknown;
  readonly hasMappedServerError: boolean;
}

/** Split out purely to keep the component below under this repository's function-length budget — same reason `VendorStatusActionPanel`'s own `SubmitError` was extracted. */
const FormFeedback = ({
  successEmail,
  error,
  hasMappedServerError,
}: FormFeedbackProps): JSX.Element | null => {
  if (successEmail) {
    return (
      <Alert tone="success">
        {successEmail} was created. They can enroll MFA and sign in on their own first login.
      </Alert>
    );
  }
  if (error !== undefined && !hasMappedServerError) {
    return (
      <Alert tone="danger">
        {isForbiddenError(error)
          ? 'You do not have permission to perform this action.'
          : apiErrorMessage(error, 'This admin account could not be created.')}
      </Alert>
    );
  }
  return null;
};

/**
 * `POST /admin/users` (Phase L.2 backend, Phase L.5 frontend). Client-side
 * validation runs against the exact same `createAdminUserRequestSchema` the
 * API's own `validate()` middleware parses the request with (mirrors
 * `vendor-portal`'s `RegisterPage` idiom) — never a hand-copied rule that
 * could drift from it. The backend's own response is still the authority:
 * a `VALIDATION_FAILED`/`EMAIL_ALREADY_REGISTERED` reply always overrides
 * whatever this component guessed locally.
 *
 * Does not enroll MFA for the new account — the backend creates it with none
 * on purpose (`CreateAdminUserUseCase`'s own doc comment), and the new
 * administrator enrolls on their own first sign-in through the existing
 * `/mfa/enroll` surface.
 */
export const CreateAdminUserForm = ({ onCreated }: CreateAdminUserFormProps): JSX.Element => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<SubordinateAdminRoleDto | ''>('');
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [successEmail, setSuccessEmail] = useState<string | null>(null);
  const [createAdminUser, { isLoading, error: createError }] = useCreateAdminUserMutation();

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLSelectElement>(null);
  const fieldRefs: Record<FieldName, RefObject<HTMLInputElement | HTMLSelectElement>> = {
    email: emailRef,
    password: passwordRef,
    role: roleRef,
  };

  const localErrors = validateWithSchema(createAdminUserRequestSchema, { email, password, role });
  const serverFieldErrors = apiFieldErrors(createError);
  // `EMAIL_ALREADY_REGISTERED` is a conflict, not a schema failure — it
  // carries no `details` for `apiFieldErrors` to find, but the code alone
  // says unambiguously which field it's about (mirrors `RegisterPage`).
  const emailConflict =
    isApiError(createError) && createError.data.error.code === 'EMAIL_ALREADY_REGISTERED'
      ? apiErrorMessage(createError)
      : undefined;
  const fieldError = (field: FieldName): string | undefined => {
    if (field === 'email' && emailConflict) return emailConflict;
    return (touched[field] ? localErrors[field] : undefined) ?? serverFieldErrors[field];
  };
  const hasMappedServerError = Object.keys(serverFieldErrors).length > 0 || Boolean(emailConflict);

  const reset = (): void => {
    setEmail('');
    setPassword('');
    setRole('');
    setTouched({});
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isLoading) return;
    setSuccessEmail(null);

    setTouched({ email: true, password: true, role: true });
    if (Object.keys(localErrors).length > 0) {
      const firstInvalid = FIELD_ORDER.find((field) => localErrors[field]);
      if (firstInvalid) fieldRefs[firstInvalid].current?.focus();
      return;
    }

    const body = { email, password, role: role as SubordinateAdminRoleDto };
    try {
      const created = await createAdminUser(body).unwrap();
      reset();
      setSuccessEmail(created.email);
      onCreated?.();
    } catch {
      // Surfaced below via `createError` from the mutation hook.
    }
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      noValidate
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
        Create admin account
      </h2>

      <Input
        ref={emailRef}
        label="Email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          setSuccessEmail(null);
        }}
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
        onChange={(event) => {
          setPassword(event.target.value);
          setSuccessEmail(null);
        }}
        onBlur={() => setTouched((current) => ({ ...current, password: true }))}
        error={fieldError('password')}
      />

      <Select
        ref={roleRef}
        label="Role"
        required
        placeholder="Select a role"
        value={role}
        onChange={(event) => {
          setRole(event.target.value as SubordinateAdminRoleDto);
          setSuccessEmail(null);
        }}
        onBlur={() => setTouched((current) => ({ ...current, role: true }))}
        error={fieldError('role')}
        options={ROLE_OPTIONS.map((value) => ({ value, label: value }))}
      />

      <FormFeedback
        successEmail={successEmail}
        error={createError}
        hasMappedServerError={hasMappedServerError}
      />

      <Button type="submit" loading={isLoading} className="self-start">
        Create
      </Button>
    </form>
  );
};
