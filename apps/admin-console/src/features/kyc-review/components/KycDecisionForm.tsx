import { useState, type FormEvent } from 'react';
import type { DecideVendorKycRequest, KycRejectionReasonDto } from '@leen-mart/contracts';
import { Alert, Button, Select, Textarea } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import {
  KYC_REJECTION_REASON_LABEL,
  KYC_REJECTION_REASONS,
} from '../lib/kyc-rejection-reason-label';

interface KycDecisionFormProps {
  readonly isSubmitting: boolean;
  readonly submitError: unknown;
  readonly onDecide: (body: DecideVendorKycRequest) => void;
}

/**
 * Approve/reject, claimed submissions only (Phase L, L4). The exact closed
 * rejection vocabulary from `kycRejectionReasonSchema` — no reasons
 * invented — and `note` is optional exactly as the contract allows.
 */
export const KycDecisionForm = ({
  isSubmitting,
  submitError,
  onDecide,
}: KycDecisionFormProps): JSX.Element => {
  const [reason, setReason] = useState<KycRejectionReasonDto>('DOCUMENT_UNCLEAR');
  const [note, setNote] = useState('');

  const handleApprove = (): void => onDecide({ decision: 'APPROVE' });

  const handleReject = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmedNote = note.trim();
    onDecide({
      decision: 'REJECT',
      reason,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Decision</h2>

      <Button type="button" loading={isSubmitting} onClick={handleApprove} className="self-start">
        Approve
      </Button>

      <form onSubmit={handleReject} className="flex flex-col gap-3" noValidate>
        <Select
          label="Rejection reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as KycRejectionReasonDto)}
          options={KYC_REJECTION_REASONS.map((value) => ({
            value,
            label: KYC_REJECTION_REASON_LABEL[value],
          }))}
        />
        <Textarea
          label="Note (optional)"
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {submitError !== undefined && (
          <Alert tone="danger">
            {apiErrorMessage(submitError, 'The decision could not be saved.')}
          </Alert>
        )}
        <Button type="submit" variant="danger" loading={isSubmitting} className="self-start">
          Reject
        </Button>
      </form>
    </div>
  );
};
