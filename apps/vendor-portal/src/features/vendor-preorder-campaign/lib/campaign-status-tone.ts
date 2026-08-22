import type { PreorderCampaignStatusDto } from '@leen-mart/contracts';
import type { StatusBadgeProps } from '@leen-mart/ui';

export const CAMPAIGN_STATUS_TONE: Record<PreorderCampaignStatusDto, StatusBadgeProps['tone']> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  OPEN: 'success',
  SOLD_OUT: 'warning',
  CLOSED: 'neutral',
  CANCELLED: 'danger',
  FULFILLING: 'info',
  COMPLETED: 'success',
  PARTIALLY_FULFILLED: 'warning',
};
