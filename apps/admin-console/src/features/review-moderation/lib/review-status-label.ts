import type { ReviewModerationStatusDto } from '@leen-mart/contracts';

export const REVIEW_STATUS_LABEL: Record<ReviewModerationStatusDto, string> = {
  SUBMITTED: 'Awaiting review',
  APPROVED: 'Approved',
  HIDDEN: 'Hidden',
};
