import type { KycDocumentTypeDto } from '@leen-mart/contracts';

export interface KycDocumentSpec {
  readonly type: KycDocumentTypeDto;
  readonly label: string;
}

/** The exact three documents `createKycUploadIntentRequestSchema` requires — one per type, no more, no fewer. */
export const KYC_DOCUMENTS: readonly KycDocumentSpec[] = [
  { type: 'PAN', label: 'PAN card' },
  { type: 'GSTIN', label: 'GSTIN certificate' },
  { type: 'BANK_ACCOUNT_PROOF', label: 'Bank account proof (cancelled cheque or passbook)' },
];
