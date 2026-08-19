import type { Logger } from '@leen-mart/domain-kit';
import {
  OUTBOX_WILDCARD,
  type OutboxEventEnvelope,
  type OutboxHandler,
} from '../../application/ports/outbox-handler.port.js';

/**
 * The only handler S5-OUTBOX ships (locked decision: "registry initially empty
 * or logging-only").
 *
 * It exists to make the relay observable rather than to do work: without it the
 * milestone's whole effect would be rows quietly changing state, and an
 * operator watching a deploy would have no way to tell a working relay from a
 * stopped one.
 *
 * Trivially idempotent — logging the same event twice is exactly as true as
 * logging it once — which is the property every later handler must also have.
 * It logs the envelope's identifiers and **not the payload**: an order event's
 * payload carries customer ids, and application logs are not the place to
 * accumulate them (SDD 18, NFR/DPDP).
 */
export const createLoggingOutboxHandler = (logger: Logger): OutboxHandler => ({
  eventType: OUTBOX_WILDCARD,
  name: 'logging',
  handle: (event: OutboxEventEnvelope): Promise<void> => {
    logger.info(
      {
        outboxEventId: event.id,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        occurredAt: event.occurredAt.toISOString(),
        attempt: event.attempt,
      },
      'Outbox event dispatched',
    );
    return Promise.resolve();
  },
});
