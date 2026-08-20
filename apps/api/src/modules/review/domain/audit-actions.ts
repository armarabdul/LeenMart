/**
 * The review module's audit vocabulary (SDD 18.4), following the same
 * dotted, bounded-context-scoped convention `catalogue/domain/audit-actions.ts`
 * established.
 *
 * Review *submission* is a customer self-service action, not an admin one —
 * matching `CancelOrderUseCase`'s own reasoning for writing no audit entry —
 * so only the two moderator decisions are listed here.
 */
export const REVIEW_AUDIT_ACTIONS = {
  /** A moderator approved a submitted or previously-hidden review (S8-REVIEWS). */
  REVIEW_APPROVED: 'review.approved',
  /** A moderator hid a submitted or previously-approved review (S8-REVIEWS). */
  REVIEW_HIDDEN: 'review.hidden',
} as const;

export type ReviewAuditAction = (typeof REVIEW_AUDIT_ACTIONS)[keyof typeof REVIEW_AUDIT_ACTIONS];

export const REVIEW_AUDIT_ENTITY_TYPES = {
  REVIEW: 'Review',
} as const;

export type ReviewAuditEntityType =
  (typeof REVIEW_AUDIT_ENTITY_TYPES)[keyof typeof REVIEW_AUDIT_ENTITY_TYPES];
