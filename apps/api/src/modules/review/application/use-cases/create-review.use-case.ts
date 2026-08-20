import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { OrderItemId } from '../../../order/index.js';
import type { Principal } from '../../../identity/index.js';
import { Review } from '../../domain/entities/review.entity.js';
import { PurchaseNotEligibleForReviewError } from '../../domain/errors/review-errors.js';
import { toReviewId } from '../../domain/value-objects/review-id.value-object.js';
import type { ReviewRepository } from '../ports/review.repository.js';
import type { VerifiedPurchaseQuery } from '../ports/verified-purchase-query.port.js';

export interface CreateReviewInput {
  readonly principal: Principal;
  /** The purchase this review is about — the only reference the client supplies; everything else (`productId`, `variantId`, `subOrderId`, `vendorId`) is derived server-side from the verified purchase this id resolves to. */
  readonly orderItemId: OrderItemId;
  readonly rating: number;
  readonly body: string;
}

export interface CreateReviewDeps {
  readonly verifiedPurchaseQuery: VerifiedPurchaseQuery;
  readonly reviewRepository: ReviewRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * A customer's own review of a verified purchase (S8-REVIEWS, `WRITE_REVIEW`
 * — SDD 8.2: `CUSTOMER` → `OWN`).
 *
 * **Every field that names who or what this review is about is
 * server-resolved, not client-supplied.** The wire request carries only
 * `orderItemId`, `rating` and `body` — `customerId` comes from
 * `principal.userId` (never a request field), and `productId`/`variantId`/
 * `subOrderId` come from `VerifiedPurchaseQuery`'s own answer, not from
 * anything the caller asserted about the purchase. A caller cannot review a
 * product they merely browsed, another customer's purchase, or a purchase
 * that has not reached `DELIVERED`/`COMPLETED` — `findEligiblePurchase`
 * returning `null` is the single, identical refusal for all three (SEC-06).
 *
 * **Idempotency is the database's job, not this use case's.**
 * `uq_reviews_order_item` is the actual "one review per verified purchase"
 * enforcement; `reviewRepository.create` surfaces its violation as
 * `ReviewAlreadyExistsError` rather than this use case checking-then-writing
 * racily, the same reasoning `ProductVariantSkuConflictError`'s own
 * repository-level translation already establishes.
 */
export class CreateReviewUseCase {
  constructor(private readonly deps: CreateReviewDeps) {}

  async execute(input: CreateReviewInput): Promise<Review> {
    const { verifiedPurchaseQuery, reviewRepository, idGenerator, clock, logger } = this.deps;
    const { principal, orderItemId, rating, body } = input;

    const purchase = await verifiedPurchaseQuery.findEligiblePurchase(
      orderItemId,
      principal.userId,
    );
    if (!purchase) {
      throw new PurchaseNotEligibleForReviewError();
    }

    const now = clock.now();
    const review = Review.submit({
      id: toReviewId(idGenerator.generate()),
      customerId: principal.userId,
      productId: purchase.productId,
      variantId: purchase.variantId,
      subOrderId: purchase.subOrderId,
      orderItemId: purchase.orderItemId,
      rating,
      body,
      now,
    });

    await reviewRepository.create(review);

    logger.info({ reviewId: review.id, orderItemId: purchase.orderItemId }, 'Review submitted');
    return review;
  }
}
