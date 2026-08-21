import type { AdminProductQueueStatus } from '@leen-mart/contracts';
import type { StatusBadgeProps } from '@leen-mart/ui';

export const PRODUCT_STATUS_TONE: Record<AdminProductQueueStatus, StatusBadgeProps['tone']> = {
  PENDING_REVIEW: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
};
