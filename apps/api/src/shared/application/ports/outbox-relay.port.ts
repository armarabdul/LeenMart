import type { OutboxEventEnvelope } from './outbox-handler.port.js';

/** The outcome the relay records against one claimed event. */
export interface OutboxDispatchOutcome {
  readonly id: string;
  readonly createdAt: Date;
  readonly attempt: number;
  /** The error to record, or `null` when the dispatch succeeded. */
  readonly error: string | null;
}

/** One claimed event, plus the composite key the relay needs to write its outcome back. */
export interface ClaimedOutboxEvent extends OutboxEventEnvelope {
  /** Part of the primary key: `outbox_events` is range-partitioned by month, so `id` alone does not identify a row. */
  readonly createdAt: Date;
}

/**
 * The relay's own store (S5-OUTBOX).
 *
 * Split from `OutboxWriter` deliberately: the writer is called from inside a
 * business transaction on the checkout credential and holds INSERT only, while
 * this is called from the worker on its own credential and never participates
 * in a business transaction. Two ports, two lifetimes — the same split
 * `serviceable_pincodes` and `business_hours` already make between a
 * management path and a read path.
 */
export interface OutboxRelayStore {
  /**
   * **Claims** up to `batchSize` due events and returns them.
   *
   * Claiming is the correctness-bearing operation. Each candidate is taken with
   * a single atomic conditional `UPDATE` — the house pattern that `inventory`,
   * `slot_capacity` and the pickup-token CAS all use — which increments
   * `attempts` and pushes `next_attempt_at` forward by the backoff. Two relay
   * instances racing for the same event therefore produce exactly one winner,
   * with no row locks and no `SKIP LOCKED`.
   *
   * Pushing `next_attempt_at` forward *at claim time* is what makes a crash
   * survivable: an event whose dispatcher died is not stuck, it simply becomes
   * claimable again once the backoff elapses.
   *
   * Returned oldest-`occurred_at`-first, so a caller that dispatches
   * sequentially observes per-aggregate order within the batch.
   */
  claimDue(batchSize: number): Promise<readonly ClaimedOutboxEvent[]>;

  /** Marks a dispatched event processed, or records the failure and dead-letters it once the budget is spent. */
  recordOutcome(outcome: OutboxDispatchOutcome): Promise<void>;
}
