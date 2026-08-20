import type { TransactionScope } from '@leen-mart/domain-kit';
import type { Review, ReviewModerationStatusName } from '../../domain/entities/review.entity.js';
import type { ReviewId } from '../../domain/value-objects/review-id.value-object.js';

/** One page of the moderation queue — cursor-paginated, the platform's standard shape (SDD 9.2). */
export interface ReviewModerationPage {
  readonly items: readonly Review[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * The moderator's view (`leenmart_admin`, full table reach —
 * `reviews_admin_select`/`reviews_admin_update`, 20260820180000). Read/write
 * split by permission-level (`MODERATE_REVIEWS`: `CATALOGUE_MODERATOR`/
 * `SUPER_ADMIN` full, `SUPPORT_AGENT`/`RISK_ANALYST` read-only) is enforced
 * by `requirePermission`/`requireFullAccess` in the interface layer (SDD 7.4
 * step 2), the same `admin-product`/`admin-kyc` precedent — not by a second,
 * narrower database role.
 */
export interface ReviewModerationRepository {
  /** Re-binds this repository to an open transaction. Same shape every other repository in this codebase publishes. */
  withTransaction(scope: TransactionScope): ReviewModerationRepository;

  /** Defaults to the queue awaiting a decision (`SUBMITTED`) when `statuses` is omitted — mirrors `adminProductQueueQuerySchema`'s own default. */
  listQueue(
    statuses: readonly ReviewModerationStatusName[],
    limit: number,
    cursor?: string,
  ): Promise<ReviewModerationPage>;

  findById(id: ReviewId): Promise<Review | null>;

  /**
   * Conditional write: `UPDATE ... WHERE id = :id AND status = :expectedStatus`.
   * Returns `false` if the row's status had already moved — two moderators
   * raced on the same review — mirroring `ProductRepository.decideIfPendingReview`
   * exactly. The caller is responsible for throwing `ReviewAlreadyModeratedError`.
   */
  updateIfStatus(review: Review, expectedStatus: ReviewModerationStatusName): Promise<boolean>;
}
