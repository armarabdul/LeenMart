/**
 * The idempotency guard for the pickup reminder (S7-SCHED, locked scope:
 * "same pickup sub-order + same reminder event -> at most one effective
 * notification").
 *
 * Deliberately the smallest possible addition to the existing outbox
 * mechanism rather than a parallel one: `outbox_events` already carries
 * `aggregate_type`/`aggregate_id`/`event_type` and an index on the first two
 * (`idx_outbox_aggregate`), so "has this sub-order already produced a
 * pickup-reminder event" is answerable with one read against data that
 * already exists. `OutboxWriter` itself stays untouched and is still what
 * performs the actual write once this says none exists yet.
 */
export interface PickupReminderOutboxLookup {
  /** Whether a `sub_order.pickup_reminder` outbox event already exists for this sub-order. */
  exists(subOrderId: string): Promise<boolean>;
}
