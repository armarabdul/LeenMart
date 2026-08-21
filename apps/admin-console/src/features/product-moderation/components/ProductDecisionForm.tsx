import { useState, type FormEvent } from 'react';
import type { DecideProductRequest, ProductRejectionReasonDto } from '@leen-mart/contracts';
import { Alert, Button, Select, Textarea } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import {
  PRODUCT_REJECTION_REASON_LABEL,
  PRODUCT_REJECTION_REASONS,
} from '../lib/product-rejection-reason-label';

interface ProductDecisionFormProps {
  readonly isSubmitting: boolean;
  readonly submitError: unknown;
  readonly onDecide: (body: DecideProductRequest) => void;
}

/**
 * Approve/reject a pending product (Phase L, L5). No claim step exists on
 * this queue — `admin-product.routes.ts` grants no `READ_ONLY` level on
 * `APPROVE_OR_REJECT_PRODUCT`, so any role that may see this form may also
 * decide from it directly. The exact closed rejection vocabulary from
 * `productRejectionReasonSchema` — distinct from, and never reused for,
 * the KYC rejection vocabulary.
 */
export const ProductDecisionForm = ({
  isSubmitting,
  submitError,
  onDecide,
}: ProductDecisionFormProps): JSX.Element => {
  const [reason, setReason] = useState<ProductRejectionReasonDto>('INCOMPLETE_MANDATORY_FIELDS');
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
          onChange={(event) => setReason(event.target.value as ProductRejectionReasonDto)}
          options={PRODUCT_REJECTION_REASONS.map((value) => ({
            value,
            label: PRODUCT_REJECTION_REASON_LABEL[value],
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
