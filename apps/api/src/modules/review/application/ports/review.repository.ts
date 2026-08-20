import type { TransactionScope } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type { Review } from '../../domain/entities/review.entity.js';

/**
 * The customer's own view of their reviews (`leenmart_app`, RLS-confined to
 * `customer_id = app.user_id` — `reviews_customer_select`/
 * `reviews_customer_insert`, 20260820180000). No update/delete method: edit
 * and delete are explicitly out of this milestone's locked scope, and there
 * is no RLS policy that would let either succeed even if one were added
 * here by mistake.
 */
export interface ReviewRepository {
  /** Re-binds this repository to an open transaction (S9-NOTIFY-REVIEW: the review insert and its `review.received` outbox event commit together). Same shape every other repository in this codebase publishes. */
  withTransaction(scope: TransactionScope): ReviewRepository;

  /** Inserts a new review. Rejects with `ReviewAlreadyExistsError` if `uq_reviews_order_item` already has a row for this purchase. */
  create(review: Review): Promise<void>;

  /** This customer's own reviews, newest first — every status, not approved-only (SDD 5 module #14: the customer sees their own submission regardless of moderation state). */
  findAllByCustomerId(customerId: UserId): Promise<readonly Review[]>;
}
