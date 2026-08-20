/**
 * The domain events this module publishes to the transactional outbox
 * (S9-NOTIFY-REVIEW, mirrors `catalogue/domain/outbox-events.ts`'s own
 * separation from its audit-action constants).
 *
 * One event: a review reaching the database at all, not any later
 * moderation outcome (S9's locked decision — the vendor is notified on
 * submission, not on approval). `REVIEW_AUDIT_ACTIONS` names the two
 * moderator decisions; this names the one thing a *customer's* action
 * publishes.
 */
export const REVIEW_OUTBOX_EVENTS = {
  RECEIVED: 'review.received',
} as const;

export type ReviewOutboxEvent = (typeof REVIEW_OUTBOX_EVENTS)[keyof typeof REVIEW_OUTBOX_EVENTS];
