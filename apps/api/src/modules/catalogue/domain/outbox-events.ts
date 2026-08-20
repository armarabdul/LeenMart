/**
 * The domain events this module publishes to the transactional outbox
 * (S6-NOTIFY-LIFECYCLE, SDD 11.2's "Product approved/rejected" row).
 *
 * **Deliberately separate constants from `CATALOGUE_AUDIT_ACTIONS`, which the
 * `order` module does not need because its two names coincide.** They do not
 * coincide here: the audit actions have read
 * `catalogue.product.approved`/`.rejected` since S2-5 and are already written
 * across the audit history, while the published event names are
 * `product.approved`/`product.rejected`. Renaming either to match the other
 * would rewrite the meaning of rows that already exist, so the two names stay
 * distinct and stay declared side by side.
 *
 * An audit action records *who did what*; an outbox event announces *what
 * happened* to anyone who subscribes. Only the second is a published contract.
 */
export const CATALOGUE_OUTBOX_EVENTS = {
  PRODUCT_APPROVED: 'product.approved',
  PRODUCT_REJECTED: 'product.rejected',
} as const;

export type CatalogueOutboxEvent =
  (typeof CATALOGUE_OUTBOX_EVENTS)[keyof typeof CATALOGUE_OUTBOX_EVENTS];
