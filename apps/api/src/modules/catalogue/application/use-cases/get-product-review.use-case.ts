import type { Logger } from '@leen-mart/domain-kit';
import { ProductNotFoundError } from '../../domain/errors/catalogue-errors.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';
import type {
  ProductReviewDetail,
  ProductReviewQueryPort,
} from '../ports/product-review-query.port.js';

export interface GetProductReviewInput {
  readonly productId: ProductId;
}

export interface GetProductReviewDeps {
  readonly productReviewQuery: ProductReviewQueryPort;
  readonly logger: Logger;
}

/**
 * One product, as the reviewing administrator sees it (SDD 15.2).
 *
 * Read-only, and not scoped to a vendor — the cross-tenant admin path, whose
 * authority is the `leenmart_admin` credential's `SELECT` policy plus
 * `requirePermission` at the edge, mirroring `GetKycReviewSubmissionUseCase`
 * exactly. Answers for a product in *any* status, not only `PENDING_REVIEW` —
 * an administrator confirming a decision they just made still needs to read
 * it back.
 */
export class GetProductReviewUseCase {
  constructor(private readonly deps: GetProductReviewDeps) {}

  async execute(input: GetProductReviewInput): Promise<ProductReviewDetail> {
    const { productReviewQuery, logger } = this.deps;

    const detail = await productReviewQuery.findDetailById(input.productId);
    if (!detail) {
      throw new ProductNotFoundError();
    }

    // The product id only, the same restraint `GetKycReviewSubmissionUseCase`
    // applies — recording which vendor's product an admin opened, on every
    // read, would build a browsing history of tenants in the application log.
    logger.info({ productId: input.productId }, 'Admin product review read');

    return detail;
  }
}
