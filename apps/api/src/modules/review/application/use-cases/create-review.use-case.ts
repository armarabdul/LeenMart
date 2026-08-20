import {
  toUuid,
  type Clock,
  type IdGenerator,
  type Logger,
  type TransactionRunner,
} from '@leen-mart/domain-kit';
import type { OrderItemId } from '../../../order/index.js';
import type { Principal } from '../../../identity/index.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import { Review } from '../../domain/entities/review.entity.js';
import { REVIEW_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import { REVIEW_OUTBOX_EVENTS } from '../../domain/outbox-events.js';
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
  /** S9-NOTIFY-REVIEW: opens the one transaction the review insert and its outbox event share. */
  readonly transactionRunner: TransactionRunner;
  /** S9-NOTIFY-REVIEW: written inside the same transaction, so a rollback leaves no event announcing a review that was never actually persisted. */
  readonly outboxWriter: OutboxWriter;
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
 * `subOrderId`/`vendorId` come from `VerifiedPurchaseQuery`'s own answer, not
 * from anything the caller asserted about the purchase. A caller cannot
 * review a product they merely browsed, another customer's purchase, or a
 * purchase that has not reached `DELIVERED`/`COMPLETED` — `findEligiblePurchase`
 * returning `null` is the single, identical refusal for all three (SEC-06).
 *
 * **Idempotency is the database's job, not this use case's.**
 * `uq_reviews_order_item` is the actual "one review per verified purchase"
 * enforcement; `reviewRepository.create` surfaces its violation as
 * `ReviewAlreadyExistsError` rather than this use case checking-then-writing
 * racily, the same reasoning `ProductVariantSkuConflictError`'s own
 * repository-level translation already establishes. That rejection happens
 * *inside* the transaction below, so a duplicate submission writes neither a
 * second review row nor a `review.received` event (S9-NOTIFY-REVIEW).
 *
 * **The outbox write (S9-NOTIFY-REVIEW) shares the review insert's own
 * transaction**, the same atomicity `DecideProductUseCase` already gives its
 * own decision-plus-event write. The payload names the vendor explicitly —
 * not because `reviews` gains a `vendor_id` column (it deliberately does
 * not), but because the notification worker resolves recipients on
 * `leenmart_checkout`, which has no reach into `products`, the identical
 * reason `product.approved`/`product.rejected` already carry `vendorId`
 * rather than a product id alone.
 */
export class CreateReviewUseCase {
  constructor(private readonly deps: CreateReviewDeps) {}

  async execute(input: CreateReviewInput): Promise<Review> {
    const {
      verifiedPurchaseQuery,
      reviewRepository,
      transactionRunner,
      outboxWriter,
      idGenerator,
      clock,
      logger,
    } = this.deps;
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

    await transactionRunner.run(async (scope) => {
      await reviewRepository.withTransaction(scope).create(review);
      await outboxWriter.withTransaction(scope).write({
        aggregateType: REVIEW_AUDIT_ENTITY_TYPES.REVIEW,
        aggregateId: toUuid(review.id),
        eventType: REVIEW_OUTBOX_EVENTS.RECEIVED,
        payload: { productId: review.productId, vendorId: purchase.vendorId },
      });
    });

    logger.info({ reviewId: review.id, orderItemId: purchase.orderItemId }, 'Review submitted');
    return review;
  }
}
