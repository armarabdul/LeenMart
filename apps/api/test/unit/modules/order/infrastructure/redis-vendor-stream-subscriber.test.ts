import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { Redis } from 'ioredis';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import { subscribeVendorStream } from '../../../../../src/modules/order/infrastructure/realtime/redis-vendor-stream-subscriber.js';
import {
  encodeVendorStreamMessage,
  VENDOR_STREAM_CHANNEL,
} from '../../../../../src/modules/order/infrastructure/realtime/vendor-stream-channel.js';
import { VendorStreamRegistry } from '../../../../../src/modules/order/infrastructure/realtime/vendor-stream-registry.js';

const ids = new UuidV7Generator();

/** ioredis's pub/sub surface is plain `EventEmitter` events (`'message'`) plus `subscribe`/`unsubscribe` — enough to drive `subscribeVendorStream` without a real connection. */
type FakePubSubRedis = Redis & {
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
};

const fakePubSubRedis = (): FakePubSubRedis => {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    subscribe: vi.fn().mockResolvedValue(1),
    unsubscribe: vi.fn().mockResolvedValue(1),
  }) as unknown as FakePubSubRedis;
};

describe('subscribeVendorStream', () => {
  it('subscribes to the fixed vendor-stream channel exactly once', () => {
    const pubSubRedis = fakePubSubRedis();
    subscribeVendorStream(pubSubRedis, new VendorStreamRegistry(), new NullLogger());

    expect(pubSubRedis.subscribe).toHaveBeenCalledWith(VENDOR_STREAM_CHANNEL);
    expect(pubSubRedis.subscribe).toHaveBeenCalledTimes(1);
  });

  it('publishes a decoded message to the local registry for the named vendor', () => {
    const pubSubRedis = fakePubSubRedis();
    const registry = new VendorStreamRegistry();
    const publishLocal = vi.spyOn(registry, 'publishLocal');
    subscribeVendorStream(pubSubRedis, registry, new NullLogger());

    const vendorId = toVendorId(ids.generate());
    const orderId = ids.generate();
    const raw = encodeVendorStreamMessage({
      vendorId,
      orderId,
      occurredAt: '2026-08-20T00:00:00.000Z',
    });
    (pubSubRedis as unknown as EventEmitter).emit('message', VENDOR_STREAM_CHANNEL, raw);

    expect(publishLocal).toHaveBeenCalledWith(vendorId, {
      type: 'order.placed',
      data: { orderId, occurredAt: '2026-08-20T00:00:00.000Z' },
    });
  });

  it('ignores a message on a different channel', () => {
    const pubSubRedis = fakePubSubRedis();
    const registry = new VendorStreamRegistry();
    const publishLocal = vi.spyOn(registry, 'publishLocal');
    subscribeVendorStream(pubSubRedis, registry, new NullLogger());

    const raw = encodeVendorStreamMessage({
      vendorId: toVendorId(ids.generate()),
      orderId: ids.generate(),
      occurredAt: '2026-08-20T00:00:00.000Z',
    });
    (pubSubRedis as unknown as EventEmitter).emit('message', 'some-other-channel', raw);

    expect(publishLocal).not.toHaveBeenCalled();
  });

  it('discards a malformed message rather than throwing', () => {
    const pubSubRedis = fakePubSubRedis();
    const registry = new VendorStreamRegistry();
    const publishLocal = vi.spyOn(registry, 'publishLocal');
    subscribeVendorStream(pubSubRedis, registry, new NullLogger());

    expect(() =>
      (pubSubRedis as unknown as EventEmitter).emit('message', VENDOR_STREAM_CHANNEL, 'not json'),
    ).not.toThrow();
    expect(publishLocal).not.toHaveBeenCalled();
  });

  it('close() unsubscribes and stops reacting to further messages', async () => {
    const pubSubRedis = fakePubSubRedis();
    const registry = new VendorStreamRegistry();
    const publishLocal = vi.spyOn(registry, 'publishLocal');
    const subscriber = subscribeVendorStream(pubSubRedis, registry, new NullLogger());

    await subscriber.close();

    expect(pubSubRedis.unsubscribe).toHaveBeenCalledWith(VENDOR_STREAM_CHANNEL);
    const raw = encodeVendorStreamMessage({
      vendorId: toVendorId(ids.generate()),
      orderId: ids.generate(),
      occurredAt: '2026-08-20T00:00:00.000Z',
    });
    (pubSubRedis as unknown as EventEmitter).emit('message', VENDOR_STREAM_CHANNEL, raw);
    expect(publishLocal).not.toHaveBeenCalled();
  });
});
