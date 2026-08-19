/** One event as the relay hands it to a handler — the stored row, nothing added. */
export interface OutboxEventEnvelope {
  readonly id: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
  /** 1 on the first dispatch. A handler that cares whether it is a retry reads this. */
  readonly attempt: number;
}

/**
 * The read half of the transactional outbox (S5-OUTBOX, SDD 11.1, IMP-04).
 *
 * **Handlers must be idempotent.** Delivery is at-least-once by construction:
 * the relay claims an event, dispatches it, then marks it processed, and a
 * crash between the second and third step replays it. That is the correct
 * trade — the alternative is a distributed transaction between PostgreSQL and
 * whatever the handler talks to — but it makes idempotence the handler's
 * obligation, not the relay's. `ProcessProductMediaUseCase` is the existing
 * example of the shape: conditional writes that a second delivery re-runs
 * harmlessly.
 *
 * A handler that throws is a failed dispatch: the relay records the error and
 * schedules a retry, and after the attempt budget the event is dead-lettered.
 * A handler that returns has been believed.
 *
 * Handlers are matched on `eventType` — the exact string the producer wrote —
 * or on the `'*'` wildcard. Several handlers may match one event; each runs,
 * and one failing does not prevent the others from being tried, but any
 * failure fails the dispatch as a whole so the event is retried. A handler
 * therefore has to tolerate seeing an event it already handled, which is the
 * same idempotence requirement stated once more.
 */
export interface OutboxHandler {
  /** The exact `eventType` this handles, or `'*'` for every event. */
  readonly eventType: string;
  /** A short name, used in logs and in the "no handler" diagnostic. */
  readonly name: string;
  handle(event: OutboxEventEnvelope): Promise<void>;
}

/**
 * Every handler the relay will consider, resolved once at composition time.
 *
 * **Deliberately near-empty in S5-OUTBOX.** The milestone's scope is the relay
 * and this contract; the consumers it will eventually feed — notifications,
 * search indexing, invoicing — are separate milestones with their own
 * unresolved decisions. An event with no matching handler is *not* an error:
 * it is marked processed, because "nobody is listening yet" is the expected
 * state for most event types today and a relay that failed on it would
 * dead-letter the entire backlog.
 */
export interface OutboxHandlerRegistry {
  /** The handlers that match this event type, in registration order. Empty is normal. */
  handlersFor(eventType: string): readonly OutboxHandler[];
}

/** Matches every event, whatever its type. */
export const OUTBOX_WILDCARD = '*';

export const createOutboxHandlerRegistry = (
  handlers: readonly OutboxHandler[],
): OutboxHandlerRegistry => ({
  handlersFor: (eventType) =>
    handlers.filter(
      (handler) => handler.eventType === eventType || handler.eventType === OUTBOX_WILDCARD,
    ),
});
