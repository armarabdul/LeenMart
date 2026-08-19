import type { Logger } from '@leen-mart/domain-kit';
import type {
  OutboxEventEnvelope,
  OutboxHandler,
} from '../../../../shared/application/ports/outbox-handler.port.js';
import type { NotificationQueue } from '../../application/ports/notification-queue.port.js';
import { isNotifiedEventType } from '../../domain/services/notification-policy.js';

/**
 * The first real outbox handler (S6-NOTIFY-INAPP).
 *
 * **It enqueues and returns. That is the whole of it, and it is a constraint
 * rather than a simplification.** The relay dispatches its batch sequentially
 * and every claimed event has already had its `next_attempt_at` pushed forward,
 * so work done here is latency the entire relay pays and attempts the event
 * spends. Writing a notification row inline would also put a second, slower
 * store inside the relay's failure budget — a database blip would burn the
 * relay's five attempts rather than the channel's three.
 *
 * The handler therefore holds a queue port and nothing else: no repository, no
 * recipient resolver, no clock. There is nothing it *could* do inline.
 *
 * The event-type filter is an optimisation, not the policy. `DeliverNotification`
 * re-checks it, because the queue is also reachable by a replayed job; skipping
 * here simply avoids queuing six event types that would be discarded on the
 * other side.
 */
export const createNotificationOutboxHandler = (
  queue: NotificationQueue,
  logger: Logger,
): OutboxHandler => ({
  // Registered per event type rather than as a wildcard, so the registry itself
  // records which events reach notifications.
  eventType: '*',
  name: 'notifications',
  handle: async (event: OutboxEventEnvelope): Promise<void> => {
    if (!isNotifiedEventType(event.eventType)) {
      return;
    }
    await queue.enqueue({
      outboxEventId: event.id,
      eventType: event.eventType,
      payload: event.payload,
    });
    logger.debug(
      { outboxEventId: event.id, eventType: event.eventType },
      'Notification job enqueued',
    );
  },
});
