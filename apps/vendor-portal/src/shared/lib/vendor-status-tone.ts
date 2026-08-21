import type { VendorStatusDto } from '@leen-mart/contracts';
import type { StatusBadgeProps } from '@leen-mart/ui';

/** Mirrors `order-status-tone.ts`'s own split of tone from label. */
export const VENDOR_STATUS_TONE: Record<VendorStatusDto, StatusBadgeProps['tone']> = {
  REGISTERED: 'neutral',
  KYC_SUBMITTED: 'warning',
  KYC_UNDER_REVIEW: 'warning',
  KYC_REJECTED: 'danger',
  KYC_APPROVED: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  TERMINATED: 'danger',
};
