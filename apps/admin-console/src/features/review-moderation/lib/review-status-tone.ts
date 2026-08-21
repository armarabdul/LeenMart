import type { ReviewModerationStatusDto } from '@leen-mart/contracts';
import type { StatusBadgeProps } from '@leen-mart/ui';

export const REVIEW_STATUS_TONE: Record<ReviewModerationStatusDto, StatusBadgeProps['tone']> = {
  SUBMITTED: 'info',
  APPROVED: 'success',
  HIDDEN: 'danger',
};
