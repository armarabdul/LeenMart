import type { ProductId } from '../../../catalogue/index.js';
import type { ReviewId } from '../../domain/value-objects/review-id.value-object.js';

/** One row of the public, approved-only listing — a reviewer identity beyond what the product UI already shows nothing more (locked scope §4/§7). */
export interface PublicReviewItem {
  readonly id: ReviewId;
  readonly rating: number;
  readonly body: string;
  readonly createdAt: Date;
}

export interface PublicReviewPage {
  readonly items: readonly PublicReviewItem[];
  readonly nextCursor: string | null;
}

/** Simple average and count, `APPROVED` rows only (locked V1 scope — no Bayesian weighting, no recency decay, no trust weighting). `null` average when there are no approved reviews yet, never `0`, so the customer-pwa can distinguish "unrated" from "rated zero". */
export interface ProductReviewSummary {
  readonly averageRating: number | null;
  readonly approvedReviewCount: number;
}

/**
 * The public product page's read of reviews (`leenmart_public`, RLS-confined
 * to `status = 'APPROVED'` — `reviews_public_read`, 20260820180000). Every
 * row this returns is already public by construction — no extra status
 * check belongs here, the same "RLS is the actual enforcement"
 * `GetPublicProductDetailUseCase` (S3-3) precedent.
 */
export interface PublicReviewQuery {
  listApprovedByProduct(
    productId: ProductId,
    limit: number,
    cursor?: string,
  ): Promise<PublicReviewPage>;

  summarizeByProduct(productId: ProductId): Promise<ProductReviewSummary>;
}
