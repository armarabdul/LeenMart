import type { AdminProductQueueStatus } from '@leen-mart/contracts';

export const PRODUCT_STATUS_LABEL: Record<AdminProductQueueStatus, string> = {
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
