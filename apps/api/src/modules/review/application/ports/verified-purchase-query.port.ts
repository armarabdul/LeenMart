import type { OrderItemId, SubOrderId } from '../../../order/index.js';
import type { ProductId, ProductVariantId } from '../../../catalogue/index.js';
import type { UserId } from '../../../identity/index.js';

/** One verified, review-eligible purchase — everything `CreateReviewUseCase` needs, and nothing the client supplied. */
export interface VerifiedPurchase {
  readonly orderItemId: OrderItemId;
  readonly subOrderId: SubOrderId;
  readonly productId: ProductId;
  readonly variantId: ProductVariantId;
}

/**
 * Verifies a purchase is eligible for a review (S8-REVIEWS, locked scope):
 * the order item belongs to the given customer, and its sub-order has
 * reached `DELIVERED` or `COMPLETED`.
 *
 * Reads across `orders`/`sub_orders`/`order_items` — a different module's
 * tables — so this is a query port, not a repository the `order` module's
 * own entities travel through, the same `PickupReminderCandidateQuery`
 * (S7-SCHED) precedent for reaching another module's data without an
 * entity/repository import crossing the boundary (SDD 5.1).
 */
export interface VerifiedPurchaseQuery {
  /**
   * `null` covers every disqualifying reason identically — no such order
   * item, a different customer's, or not yet `DELIVERED`/`COMPLETED` — on
   * purpose (SEC-06): the caller must not be able to distinguish them.
   */
  findEligiblePurchase(
    orderItemId: OrderItemId,
    customerId: UserId,
  ): Promise<VerifiedPurchase | null>;
}
