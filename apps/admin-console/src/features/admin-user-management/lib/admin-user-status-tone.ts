import type { AdminUserStatusDto } from '@leen-mart/contracts';
import type { StatusBadgeProps } from '@leen-mart/ui';

/** Mirrors `VENDOR_STATUS_TONE`'s own pattern (`kyc-review/lib/kyc-status-tone.ts`). */
export const ADMIN_USER_STATUS_TONE: Record<AdminUserStatusDto, StatusBadgeProps['tone']> = {
  PENDING: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  LOCKED: 'danger',
};
