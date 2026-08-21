import type { VendorStatusDto } from '@leen-mart/contracts';
import type { StatusBadgeProps } from '@leen-mart/ui';

/** Mirrors `vendor-portal`'s own `vendor-status-tone.ts`. */
export const VENDOR_STATUS_TONE: Record<VendorStatusDto, StatusBadgeProps['tone']> = {
  REGISTERED: 'neutral',
  KYC_SUBMITTED: 'info',
  KYC_UNDER_REVIEW: 'info',
  KYC_REJECTED: 'danger',
  KYC_APPROVED: 'success',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  TERMINATED: 'danger',
};
