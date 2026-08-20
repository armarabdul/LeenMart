import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import { REVIEW_AUDIT_ACTIONS, REVIEW_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import type { Review } from '../../domain/entities/review.entity.js';
import {
  ReviewAlreadyModeratedError,
  ReviewNotFoundError,
} from '../../domain/errors/review-errors.js';
import type { ReviewId } from '../../domain/value-objects/review-id.value-object.js';
import type { ReviewModerationRepository } from '../ports/review-moderation.repository.js';

/**
 * The two locked V1 actions. Not `RESTORE` as a third variant — restoring
 * visibility on a `HIDDEN` review is the *same* `APPROVE` action reapplied
 * (locked transitions: `SUBMITTED`→`APPROVED`, `HIDDEN`→`APPROVED` are one
 * domain method, `Review.approve()`), so a separate wire verb would name two
 * things that are one decision.
 */
export type ReviewModerationDecision = 'APPROVE' | 'HIDE';

export interface DecideReviewModerationInput {
  readonly principal: Principal;
  readonly reviewId: ReviewId;
  readonly decision: ReviewModerationDecision;
}

export interface DecideReviewModerationResult {
  readonly review: Review;
}

export interface DecideReviewModerationDeps {
  readonly reviewModerationRepository: ReviewModerationRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * A moderator's decision on a review (`MODERATE_REVIEWS`, SDD 8.2:
 * `CATALOGUE_MODERATOR`/`SUPER_ADMIN` → `FULL`). Mirrors
 * `DecideProductUseCase`'s own shape closely: load, let the domain refuse an
 * illegal transition, then the conditional write is the race the domain
 * cannot see (two moderators loading the same row before either writes).
 *
 * Unlike `DecideProductUseCase`, this writes no outbox event — locked scope:
 * no notifications for reviews in this milestone.
 */
export class DecideReviewModerationUseCase {
  constructor(private readonly deps: DecideReviewModerationDeps) {}

  async execute(input: DecideReviewModerationInput): Promise<DecideReviewModerationResult> {
    const { reviewModerationRepository, transactionRunner, auditWriter, clock, logger } = this.deps;

    return transactionRunner.run(async (scope) => {
      const repository = reviewModerationRepository.withTransaction(scope);

      const existing = await repository.findById(input.reviewId);
      if (!existing) {
        throw new ReviewNotFoundError();
      }

      const now = clock.now();
      const decided = input.decision === 'APPROVE' ? existing.approve(now) : existing.hide(now);

      if (!(await repository.updateIfStatus(decided, existing.status))) {
        throw new ReviewAlreadyModeratedError();
      }

      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action:
          input.decision === 'APPROVE'
            ? REVIEW_AUDIT_ACTIONS.REVIEW_APPROVED
            : REVIEW_AUDIT_ACTIONS.REVIEW_HIDDEN,
        entityType: REVIEW_AUDIT_ENTITY_TYPES.REVIEW,
        entityId: toUuid(decided.id),
        before: { status: existing.status },
        after: { status: decided.status },
      });

      logger.info(
        { reviewId: decided.id, decision: input.decision },
        'Admin recorded a review moderation decision',
      );

      return { review: decided };
    });
  }
}
