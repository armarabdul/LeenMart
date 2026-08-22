import type { PreorderCampaignStatusDto } from '@leen-mart/contracts';

export const CAMPAIGN_STATUS_LABEL: Record<PreorderCampaignStatusDto, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  OPEN: 'Open',
  SOLD_OUT: 'Sold out',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  FULFILLING: 'Fulfilling',
  COMPLETED: 'Completed',
  PARTIALLY_FULFILLED: 'Partially fulfilled',
};
