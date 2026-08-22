import { useState, type FormEvent } from 'react';
import { Alert, Button, Textarea } from '@leen-mart/ui';
import { apiErrorMessage, isForbiddenError } from '@/shared/api/base-api';
import { useReinstateVendorMutation, useSuspendVendorMutation } from '../vendor-management.api';

interface VendorStatusActionPanelProps {
  readonly vendorId: string;
  /** Only ever rendered for these two — every other status has no suspend/reinstate action to offer. */
  readonly status: 'ACTIVE' | 'SUSPENDED';
}

interface StatusActionCopy {
  readonly triggerLabel: string;
  readonly confirmLabel: string;
  readonly reasonLabel: string;
  readonly reasonHint: string | undefined;
  readonly errorFallback: string;
  readonly buttonVariant: 'danger' | 'primary';
}

/** One place for the two actions' near-identical copy, so the component below branches on data, not on repeated inline ternaries. */
const COPY: Record<'ACTIVE' | 'SUSPENDED', StatusActionCopy> = {
  ACTIVE: {
    triggerLabel: 'Suspend vendor',
    confirmLabel: 'Confirm suspension',
    reasonLabel: 'Reason (required)',
    reasonHint: 'Recorded on the audit log — every suspension requires one.',
    errorFallback: 'This vendor could not be suspended.',
    buttonVariant: 'danger',
  },
  SUSPENDED: {
    triggerLabel: 'Reinstate vendor',
    confirmLabel: 'Confirm reinstatement',
    reasonLabel: 'Reason (optional)',
    reasonHint: undefined,
    errorFallback: 'This vendor could not be reinstated.',
    buttonVariant: 'primary',
  },
};

const SubmitError = ({
  error,
  fallback,
}: {
  readonly error: unknown;
  readonly fallback: string;
}): JSX.Element => (
  <Alert tone="danger">
    {isForbiddenError(error)
      ? 'You do not have permission to perform this action.'
      : apiErrorMessage(error, fallback)}
  </Alert>
);

/**
 * Suspend (ACTIVE vendors) / reinstate (SUSPENDED vendors) — Phase L.4.
 * Split out the same way `KycDecisionForm` is: a reason-gated decision form,
 * not a plain button, mirroring that component's "reveal the form, then
 * confirm" shape as this action's confirmation UI.
 *
 * The backend permission (`SUSPEND_VENDOR_OR_USER`) remains the only
 * authority over who may act here — this component never hides the action
 * based on the caller's own role; an unauthorized attempt simply surfaces the
 * backend's 403 the same way every other admin action in this app does.
 */
export const VendorStatusActionPanel = ({
  vendorId,
  status,
}: VendorStatusActionPanelProps): JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [suspendVendor, suspendState] = useSuspendVendorMutation();
  const [reinstateVendor, reinstateState] = useReinstateVendorMutation();

  const copy = COPY[status];
  const isSuspend = status === 'ACTIVE';
  const { isLoading: isSubmitting, error: submitError } = isSuspend ? suspendState : reinstateState;
  const trimmedReason = reason.trim();
  const reasonMissing = isSuspend && trimmedReason.length === 0;

  const reset = (): void => {
    setIsOpen(false);
    setReason('');
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (reasonMissing) return;

    // `reasonMissing` above already guarantees `trimmedReason` is non-empty
    // whenever `isSuspend` is true, so the required half of the discriminated
    // request body is never actually optional here.
    const action = isSuspend
      ? suspendVendor({ vendorId, body: { reason: trimmedReason } })
      : reinstateVendor({ vendorId, body: trimmedReason ? { reason: trimmedReason } : {} });

    void action.unwrap().then(() => reset());
  };

  if (!isOpen) {
    return (
      <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
        <Button
          type="button"
          variant={copy.buttonVariant}
          onClick={() => setIsOpen(true)}
          className="self-start"
        >
          {copy.triggerLabel}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      noValidate
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
        {copy.confirmLabel}
      </h2>

      <Textarea
        label={copy.reasonLabel}
        maxLength={1000}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={reasonMissing && reason.length > 0 ? 'A reason is required.' : undefined}
        hint={copy.reasonHint}
      />

      {submitError !== undefined && (
        <SubmitError error={submitError} fallback={copy.errorFallback} />
      )}

      <div className="flex gap-2">
        <Button
          type="submit"
          variant={copy.buttonVariant}
          loading={isSubmitting}
          disabled={reasonMissing}
        >
          {copy.confirmLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={reset} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
};
