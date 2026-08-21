import type { VendorStatusDto } from '@leen-mart/contracts';

/** The vendor lifecycle (SDD 15.1), in the reviewer's own words — mirrors `vendor-portal`'s own `vendor-status-label.ts`. */
export const VENDOR_STATUS_LABEL: Record<VendorStatusDto, string> = {
  REGISTERED: 'Awaiting KYC',
  KYC_SUBMITTED: 'KYC submitted',
  KYC_UNDER_REVIEW: 'Under review',
  KYC_REJECTED: 'KYC rejected',
  KYC_APPROVED: 'KYC approved',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  TERMINATED: 'Terminated',
};
