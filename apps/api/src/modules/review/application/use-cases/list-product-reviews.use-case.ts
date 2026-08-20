import type { ProductId } from '../../../catalogue/index.js';
import type {
  ProductReviewSummary,
  PublicReviewItem,
  PublicReviewQuery,
} from '../ports/public-review-query.port.js';

export interface ListProductReviewsInput {
  readonly productId: ProductId;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface ListProductReviewsResult {
  readonly summary: ProductReviewSummary;
  readonly items: readonly PublicReviewItem[];
  readonly nextCursor: string | null;
}

export interface ListProductReviewsDeps {
  readonly publicReviewQuery: PublicReviewQuery;
}

/**
 * The public product page's reviews (S8-REVIEWS): the approved-only list
 * plus the simple average/count summary, in one call — the natural existing
 * shape a product's own reviews belong under
 * (`GET /api/v1/catalogue/products/:id/reviews`), rather than bolting a
 * second field onto `GetPublicProductDetailUseCase`'s response and coupling
 * `catalogue`'s tested detail endpoint to a module it otherwise never
 * touches.
 *
 * No product-existence check here: an unknown or unapproved product id
 * simply has zero approved reviews and a `null` average, which is exactly
 * the honest answer — the same "RLS decides what is visible, this use case
 * adds no status check of its own" reasoning `GetPublicProductDetailUseCase`
 * already applies to reviews' own table.
 */
export class ListProductReviewsUseCase {
  constructor(private readonly deps: ListProductReviewsDeps) {}

  async execute(input: ListProductReviewsInput): Promise<ListProductReviewsResult> {
    const { publicReviewQuery } = this.deps;
    const [summary, page] = await Promise.all([
      publicReviewQuery.summarizeByProduct(input.productId),
      publicReviewQuery.listApprovedByProduct(input.productId, input.limit, input.cursor),
    ]);

    return { summary, items: page.items, nextCursor: page.nextCursor };
  }
}
