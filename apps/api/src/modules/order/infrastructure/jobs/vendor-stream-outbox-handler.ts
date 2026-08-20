import type { Redis } from 'ioredis';
import type { Logger } from '@leen-mart/domain-kit';
import type {
  OutboxEventEnvelope,
  OutboxHandler,
} from '../../../../shared/application/ports/outbox-handler.port.js';
import type { OrderVendorResolver } from '../../application/ports/order-vendor-resolver.port.js';
import {
  encodeVendorStreamMessage,
  VENDOR_STREAM_CHANNEL,
} from '../realtime/vendor-stream-channel.js';

/**
 * Publishes a live-alert signal for `order.placed` (S4-SSE).
 *
 * **Registered for the exact event type, not the wildcard** — unlike
 * `NotificationOutboxHandler`, which matches every event and filters
 * internally, this handler only ever cares about one, so the registry
 * itself is the record of that (mirrors this file's own reasoning being
 * stated once, not copied).
 *
 * **Coexists with `NotificationOutboxHandler` on the same event, and neither
 * knows the other exists.** `OutboxRelay.dispatch()` runs every matching
 * handler independently per event (see its own doc comment); this handler
 * changes nothing about how the notification handler is registered, matched,
 * or dispatched.
 *
 * **It publishes and returns — that is the whole of it, deliberately.** The
 * relay dispatches its batch sequentially, so work done here is latency the
 * entire relay pays. This handler holds a vendor resolver (one cross-vendor
 * read, the same shape `PrismaNotificationRecipientResolver` already
 * establishes) and a Redis connection for `PUBLISH` — no HTTP, no browser,
 * no waiting on a subscriber to exist. If nobody is connected, the message
 * is simply dropped, which is correct for a live-alert feature (the durable
 * record of the same event already exists independently via the in-app
 * `Notification` row).
 *
 * **Safe under the relay's at-least-once redelivery.** A retry just
 * re-publishes the same message — no persisted side effect here to
 * duplicate, so there is nothing to make idempotent beyond "safe to run
 * twice", which a fire-and-forget `PUBLISH` trivially is.
 */
export const createVendorStreamOutboxHandler = (
  publisherRedis: Redis,
  vendorResolver: OrderVendorResolver,
  logger: Logger,
): OutboxHandler => ({
  eventType: 'order.placed',
  name: 'vendor-stream',
  handle: async (event: OutboxEventEnvelope): Promise<void> => {
    const resolved = await vendorResolver.vendorIdsForOrder(event.aggregateId);
    // `OrderVendorResolver`'s own contract already promises distinct ids;
    // deduped again here so this handler's own correctness never depends on
    // every implementation of that port upholding it.
    const vendorIds = [...new Set(resolved)];
    if (vendorIds.length === 0) {
      return;
    }

    // The event's own `occurredAt` — when the order was actually placed —
    // not the moment this handler happens to run, which a retry would
    // otherwise change on every redelivery.
    const occurredAt = event.occurredAt.toISOString();
    await Promise.all(
      vendorIds.map((vendorId) =>
        publisherRedis.publish(
          VENDOR_STREAM_CHANNEL,
          encodeVendorStreamMessage({ vendorId, orderId: event.aggregateId, occurredAt }),
        ),
      ),
    );

    logger.debug(
      { outboxEventId: event.id, orderId: event.aggregateId, vendorCount: vendorIds.length },
      'Vendor-stream alert published',
    );
  },
});
