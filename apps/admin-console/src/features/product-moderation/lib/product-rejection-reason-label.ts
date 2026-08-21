import type { ProductRejectionReasonDto } from '@leen-mart/contracts';

/**
 * The exact closed vocabulary `productRejectionReasonSchema` declares
 * (`packages/contracts/src/catalogue/product.contract.ts`) — distinct from
 * the KYC rejection vocabulary and never reused for it (L5).
 */
export const PRODUCT_REJECTION_REASON_LABEL: Record<ProductRejectionReasonDto, string> = {
  INCOMPLETE_MANDATORY_FIELDS: 'Incomplete mandatory fields',
  POLICY_VIOLATION: 'Policy violation',
  MISLEADING_LISTING: 'Misleading listing',
  DUPLICATE_LISTING: 'Duplicate listing',
  PRICING_ISSUE: 'Pricing issue',
  OTHER: 'Other',
};

export const PRODUCT_REJECTION_REASONS: readonly ProductRejectionReasonDto[] = [
  'INCOMPLETE_MANDATORY_FIELDS',
  'POLICY_VIOLATION',
  'MISLEADING_LISTING',
  'DUPLICATE_LISTING',
  'PRICING_ISSUE',
  'OTHER',
];
