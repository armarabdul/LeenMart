import type { PreorderCampaignStatusDto } from '@leen-mart/contracts';
import type { StatusBadgeProps } from '@leen-mart/ui';

/** Mirrors `order-status-tone.ts`'s own reasoning: `warning` is "act now" (open, reserve soon), `info` is "in motion, nothing required", `success` is a good outcome, `danger` the one that isn't. */
export const PREORDER_CAMPAIGN_STATUS_TONE: Record<
  PreorderCampaignStatusDto,
  StatusBadgeProps['tone']
> = {
  DRAFT: 'neutral',
  SCHEDULED: 'info',
  OPEN: 'warning',
  SOLD_OUT: 'neutral',
  CLOSED: 'neutral',
  CANCELLED: 'danger',
  FULFILLING: 'info',
  COMPLETED: 'success',
  PARTIALLY_FULFILLED: 'warning',
};
