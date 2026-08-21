import type { ProductStatusDto } from '@leen-mart/contracts';
import type { StatusBadgeProps } from '@leen-mart/ui';

export const PRODUCT_STATUS_TONE: Record<ProductStatusDto, StatusBadgeProps['tone']> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};
