import type { PreorderCampaignStatusDto } from '@leen-mart/contracts';

/** Shared between `PreorderCampaignsPage` and `PreorderCampaignDetailPage` — extracted rather than duplicated. */
export const PREORDER_CAMPAIGN_STATUS_LABEL: Record<PreorderCampaignStatusDto, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Opens soon',
  OPEN: 'Open for reservations',
  SOLD_OUT: 'Sold out',
  CLOSED: 'Reservations closed',
  CANCELLED: 'Cancelled',
  FULFILLING: 'Being fulfilled',
  COMPLETED: 'Completed',
  PARTIALLY_FULFILLED: 'Partially fulfilled',
};
