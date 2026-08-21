import type { VendorStatusDto } from '@leen-mart/contracts';

/** SDD 15.1's onboarding lifecycle, in the vendor's own words — mirrors `order-status-label.ts`'s own split of label from tone. */
export const VENDOR_STATUS_LABEL: Record<VendorStatusDto, string> = {
  REGISTERED: 'Awaiting KYC',
  KYC_SUBMITTED: 'KYC submitted',
  KYC_UNDER_REVIEW: 'KYC under review',
  KYC_REJECTED: 'KYC rejected',
  KYC_APPROVED: 'KYC approved',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  TERMINATED: 'Terminated',
};
