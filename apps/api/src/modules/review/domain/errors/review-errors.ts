import { ConflictError, DomainRuleError, NotFoundError } from '@leen-mart/domain-kit';

/**
 * No review exists with the requested id, as far as this caller is
 * concerned. Covers "never existed" and "belongs to another customer"
 * identically — the repository returns `null` for both because RLS makes
 * them indistinguishable, the same reasoning `ProductNotFoundError`'s own
 * comment records.
 */
export class ReviewNotFoundError extends NotFoundError {
  constructor() {
    super('This review does not exist.', { code: 'REVIEW_NOT_FOUND' });
  }
}

/**
 * Rating is required to be an integer 1–5 (locked V1 scope). The wire schema
 * already refuses anything else before a request reaches here — this is the
 * domain's own defence-in-depth check, the same reasoning `Address`'s format
 * validation and `Product`'s length assertions both apply.
 */
export class InvalidReviewRatingError extends DomainRuleError {
  constructor() {
    super('INVALID_REVIEW_RATING', 'A review rating must be a whole number from 1 to 5.', {
      details: [{ field: 'rating', issue: 'Must be an integer between 1 and 5 inclusive.' }],
    });
  }
}

/** A review body outside the length bound (locked V1 scope: non-blank, bounded). */
export class InvalidReviewBodyError extends DomainRuleError {
  constructor(issue: string) {
    super('INVALID_REVIEW_BODY', 'A review must include valid body text.', {
      details: [{ field: 'body', issue }],
    });
  }
}

/**
 * The purchase this review would attach to does not qualify — covers every
 * reason identically, on purpose (SEC-06 shape, mirroring
 * `ProductNotFoundError`): the order item does not exist, belongs to a
 * different customer, or its sub-order has not reached `DELIVERED`/
 * `COMPLETED`. A caller who does not own the purchase must not be able to
 * distinguish "not yours" from "not delivered yet" from "no such item" —
 * every one of those answers would leak information about an order that is
 * not theirs.
 */
export class PurchaseNotEligibleForReviewError extends DomainRuleError {
  constructor() {
    super(
      'PURCHASE_NOT_ELIGIBLE_FOR_REVIEW',
      'This purchase is not eligible for a review — it must be your own, delivered or completed order.',
    );
  }
}

/**
 * The `uq_reviews_order_item` unique index already has a row — the same
 * order item was reviewed already. Locked V1 scope: one review per verified
 * purchase, enforced at the database, this error only names what the
 * constraint already refused.
 */
export class ReviewAlreadyExistsError extends ConflictError {
  constructor() {
    super('This purchase has already been reviewed.', { code: 'REVIEW_ALREADY_EXISTS' });
  }
}

/**
 * `approve()`/`hide()` refuse a status their current one cannot legally
 * reach (locked V1 transitions: `SUBMITTED`→`APPROVED`, `SUBMITTED`→`HIDDEN`,
 * `APPROVED`→`HIDDEN`, `HIDDEN`→`APPROVED`). Mirrors
 * `InvalidProductOperationError`'s shape.
 */
export class InvalidReviewModerationTransitionError extends DomainRuleError {
  constructor(from: string, action: 'approve' | 'hide') {
    const pastTense = action === 'approve' ? 'approved' : 'hidden';
    super('INVALID_REVIEW_MODERATION_TRANSITION', 'This action is not permitted for this review.', {
      details: [{ field: action, issue: `A review in ${from} cannot be ${pastTense}.` }],
    });
  }
}

/**
 * Two moderators raced on the same review — mirrors
 * `ProductAlreadyDecidedError` exactly: the conditional `UPDATE ... WHERE
 * status = :expected` affected zero rows, so someone else's decision already
 * landed.
 */
export class ReviewAlreadyModeratedError extends ConflictError {
  constructor() {
    super('This review was already moderated by someone else.', {
      code: 'REVIEW_ALREADY_MODERATED',
    });
  }
}
