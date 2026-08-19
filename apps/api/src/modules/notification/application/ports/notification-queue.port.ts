/** The wire shape a notification job carries over Redis — plain values, never domain types. */
export interface NotificationJob {
  readonly outboxEventId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

/**
 * The seam between the outbox relay and the notification channel
 * (S6-NOTIFY-INAPP, SDD 11.1's `BullMQ queue: notifications`).
 *
 * The relay's handler depends on this port and nothing else, which is what
 * keeps `bullmq` out of the application layer — the same discipline
 * `ProductMediaProcessingQueue` already establishes.
 *
 * It is also what makes "enqueue and return" enforceable rather than merely
 * intended: the handler has no repository, no resolver and no clock, so there
 * is nothing it *could* do inline even if someone later wanted it to.
 */
export interface NotificationQueue {
  /**
   * Enqueues one event for the orchestrator.
   *
   * The implementation derives a deterministic job id from the outbox event, so
   * a redelivered event collapses onto the same job instead of queuing a second
   * one. That is a convenience, not the correctness guarantee — the
   * orchestrator's `createIfAbsent` is what actually makes redelivery safe.
   */
  enqueue(job: NotificationJob): Promise<void>;
}
