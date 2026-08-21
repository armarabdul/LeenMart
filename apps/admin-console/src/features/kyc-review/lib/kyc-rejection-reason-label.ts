import type { KycRejectionReasonDto } from '@leen-mart/contracts';

/**
 * The exact closed vocabulary `kycRejectionReasonSchema` declares
 * (`packages/contracts/src/vendor/kyc-review.contract.ts`) — no additional
 * reasons invented (L4).
 */
export const KYC_REJECTION_REASON_LABEL: Record<KycRejectionReasonDto, string> = {
  DOCUMENT_UNCLEAR: 'Document unclear',
  DOCUMENT_INVALID: 'Document invalid',
  DETAILS_MISMATCH: 'Details mismatch',
  BANK_DETAILS_MISMATCH: 'Bank details mismatch',
  DUPLICATE_IDENTITY: 'Duplicate identity',
  OTHER: 'Other',
};

export const KYC_REJECTION_REASONS: readonly KycRejectionReasonDto[] = [
  'DOCUMENT_UNCLEAR',
  'DOCUMENT_INVALID',
  'DETAILS_MISMATCH',
  'BANK_DETAILS_MISMATCH',
  'DUPLICATE_IDENTITY',
  'OTHER',
];
