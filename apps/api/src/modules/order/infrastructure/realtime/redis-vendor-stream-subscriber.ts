import type { Redis } from 'ioredis';
import type { Logger } from '@leen-mart/domain-kit';
import { decodeVendorStreamMessage, VENDOR_STREAM_CHANNEL } from './vendor-stream-channel.js';
import type { VendorStreamRegistry } from './vendor-stream-registry.js';

export interface VendorStreamSubscriber {
  /** Unsubscribes. Does not disconnect the underlying client — `container.dispose()` owns that. */
  close(): Promise<void>;
}

/**
 * Subscribes once, on the dedicated pub/sub connection, and fans every
 * message out to this API process's own `VendorStreamRegistry` (S4-SSE).
 *
 * **This is the bridge across the process boundary.** `OutboxRelay` runs
 * only in `worker.ts`; the SSE connections this registry holds only exist in
 * the API process. Redis pub/sub is the transport between them — see
 * `createPubSubRedisClient`'s own comment for why the connection has to be
 * dedicated, and `VendorStreamOutboxHandler` for the publishing half.
 *
 * One `SUBSCRIBE` for the whole process, not one per connection: every
 * message this process receives is filtered *locally* against the registry,
 * which is what keeps a churn of vendor connections opening and closing from
 * ever touching the Redis subscription itself.
 */
export const subscribeVendorStream = (
  pubSubRedis: Redis,
  registry: VendorStreamRegistry,
  logger: Logger,
): VendorStreamSubscriber => {
  const onMessage = (channel: string, raw: string): void => {
    if (channel !== VENDOR_STREAM_CHANNEL) return;

    const message = decodeVendorStreamMessage(raw);
    if (!message) {
      logger.warn({ channel, raw }, 'Discarding malformed vendor-stream pub/sub message');
      return;
    }

    registry.publishLocal(message.vendorId, {
      type: 'order.placed',
      data: { orderId: message.orderId, occurredAt: message.occurredAt },
    });
  };

  pubSubRedis.on('message', onMessage);
  // Fire-and-forget from this function's own perspective: `subscribeVendorStream`
  // returns synchronously, matching every other composition-root wiring call in
  // this codebase. A subscribe failure surfaces through the connection's own
  // `error` listener (already registered by `createPubSubRedisClient`) and
  // ioredis's automatic reconnect/resubscribe, not through this promise.
  void pubSubRedis.subscribe(VENDOR_STREAM_CHANNEL).catch((error: unknown) => {
    logger.error(
      { err: error, channel: VENDOR_STREAM_CHANNEL },
      'Failed to subscribe to vendor-stream channel',
    );
  });

  return {
    close: async (): Promise<void> => {
      pubSubRedis.off('message', onMessage);
      await pubSubRedis.unsubscribe(VENDOR_STREAM_CHANNEL).catch(() => undefined);
    },
  };
};
