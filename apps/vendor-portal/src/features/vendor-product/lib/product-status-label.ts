import type { ProductStatusDto } from '@leen-mart/contracts';

/** S2-5's moderation lifecycle, in the vendor's own words. */
export const PRODUCT_STATUS_LABEL: Record<ProductStatusDto, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
