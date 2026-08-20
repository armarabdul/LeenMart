import { describe, expect, it, vi } from 'vitest';
import { NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { Redis } from 'ioredis';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import type { OutboxEventEnvelope } from '../../../../../src/shared/application/ports/outbox-handler.port.js';
import type { OrderVendorResolver } from '../../../../../src/modules/order/application/ports/order-vendor-resolver.port.js';
import { createVendorStreamOutboxHandler } from '../../../../../src/modules/order/infrastructure/jobs/vendor-stream-outbox-handler.js';
import {
  decodeVendorStreamMessage,
  VENDOR_STREAM_CHANNEL,
} from '../../../../../src/modules/order/infrastructure/realtime/vendor-stream-channel.js';

const ids = new UuidV7Generator();

const buildEvent = (orderId: string): OutboxEventEnvelope => ({
  id: ids.generate(),
  aggregateType: 'Order',
  aggregateId: orderId,
  eventType: 'order.placed',
  payload: { orderId },
  occurredAt: new Date('2026-08-20T00:00:00.000Z'),
  attempt: 1,
});

const fakeResolver = (
  vendorIds: readonly ReturnType<typeof toVendorId>[],
): OrderVendorResolver => ({
  vendorIdsForOrder: vi.fn().mockResolvedValue(vendorIds),
});

const fakePublisher = (): Redis & { publish: ReturnType<typeof vi.fn> } =>
  ({ publish: vi.fn().mockResolvedValue(1) }) as unknown as Redis & {
    publish: ReturnType<typeof vi.fn>;
  };

describe('VendorStreamOutboxHandler', () => {
  it('is registered for the exact event type "order.placed", not the wildcard', () => {
    const handler = createVendorStreamOutboxHandler(
      fakePublisher(),
      fakeResolver([]),
      new NullLogger(),
    );
    expect(handler.eventType).toBe('order.placed');
  });

  it('publishes one message per distinct vendor on the order', async () => {
    const vendorA = toVendorId(ids.generate());
    const vendorB = toVendorId(ids.generate());
    const publisher = fakePublisher();
    const orderId = ids.generate();
    const handler = createVendorStreamOutboxHandler(
      publisher,
      fakeResolver([vendorA, vendorB]),
      new NullLogger(),
    );

    await handler.handle(buildEvent(orderId));

    expect(publisher.publish).toHaveBeenCalledTimes(2);
    const publishedVendorIds = (publisher.publish.mock.calls as [string, string][]).map(
      ([, raw]) => decodeVendorStreamMessage(raw)?.vendorId,
    );
    expect(publishedVendorIds.sort()).toEqual([vendorA, vendorB].sort());
  });

  it('publishes on the fixed vendor-stream channel', async () => {
    const vendorId = toVendorId(ids.generate());
    const publisher = fakePublisher();
    const handler = createVendorStreamOutboxHandler(
      publisher,
      fakeResolver([vendorId]),
      new NullLogger(),
    );

    await handler.handle(buildEvent(ids.generate()));

    expect(publisher.publish).toHaveBeenCalledWith(VENDOR_STREAM_CHANNEL, expect.any(String));
  });

  it('deduplicates a resolver that returns a vendor id more than once', async () => {
    const vendorId = toVendorId(ids.generate());
    const publisher = fakePublisher();
    const handler = createVendorStreamOutboxHandler(
      publisher,
      fakeResolver([vendorId, vendorId, vendorId]),
      new NullLogger(),
    );

    await handler.handle(buildEvent(ids.generate()));

    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it('carries the order id and the event’s own occurredAt in the message', async () => {
    const vendorId = toVendorId(ids.generate());
    const publisher = fakePublisher();
    const orderId = ids.generate();
    const event = buildEvent(orderId);
    const handler = createVendorStreamOutboxHandler(
      publisher,
      fakeResolver([vendorId]),
      new NullLogger(),
    );

    await handler.handle(event);

    const [, raw] = publisher.publish.mock.calls[0] as [string, string];
    const message = decodeVendorStreamMessage(raw);
    expect(message?.orderId).toBe(orderId);
    expect(message?.occurredAt).toBe(event.occurredAt.toISOString());
  });

  it('publishes nothing for an order with no resolvable vendor', async () => {
    const publisher = fakePublisher();
    const handler = createVendorStreamOutboxHandler(publisher, fakeResolver([]), new NullLogger());

    await handler.handle(buildEvent(ids.generate()));

    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('never writes to the database or performs browser/network work — only resolves and publishes', async () => {
    const vendorId = toVendorId(ids.generate());
    const resolver = fakeResolver([vendorId]);
    const publisher = fakePublisher();
    const handler = createVendorStreamOutboxHandler(publisher, resolver, new NullLogger());

    await handler.handle(buildEvent(ids.generate()));

    expect(resolver.vendorIdsForOrder).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });

  it('propagates a resolver failure so the relay retries — no silent swallow', async () => {
    const publisher = fakePublisher();
    const resolver: OrderVendorResolver = {
      vendorIdsForOrder: vi.fn().mockRejectedValue(new Error('checkout db unreachable')),
    };
    const handler = createVendorStreamOutboxHandler(publisher, resolver, new NullLogger());

    await expect(handler.handle(buildEvent(ids.generate()))).rejects.toThrow(
      'checkout db unreachable',
    );
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
