import { describe, expect, it, vi } from 'vitest';
import { NullLogger } from '@leen-mart/domain-kit';
import { createNotificationOutboxHandler } from '../../../../src/modules/notification/infrastructure/jobs/notification-outbox-handler.js';
import {
  NOTIFICATION_BACKOFF_MS,
  NOTIFICATION_JOB_ATTEMPTS,
  NOTIFICATION_JOB_NAME,
  NOTIFICATION_JOB_OPTIONS,
  NOTIFICATION_QUEUE_NAME,
} from '../../../../src/modules/notification/infrastructure/jobs/notification-queue.js';
import { parseNotificationJob } from '../../../../src/modules/notification/infrastructure/jobs/notification-worker.js';
import type {
  NotificationJob,
  NotificationQueue,
} from '../../../../src/modules/notification/application/ports/notification-queue.port.js';
import type { OutboxEventEnvelope } from '../../../../src/shared/application/ports/outbox-handler.port.js';

const OUTBOX_EVENT_ID = '01a01111-1111-7111-8111-111111111111';
const ORDER_ID = '01a02222-2222-7222-8222-222222222222';

interface QueueSpy extends NotificationQueue {
  readonly enqueue: ReturnType<typeof vi.fn>;
}

const queue = (): QueueSpy => ({ enqueue: vi.fn().mockResolvedValue(undefined) });

const event = (overrides: Partial<OutboxEventEnvelope> = {}): OutboxEventEnvelope => ({
  id: OUTBOX_EVENT_ID,
  aggregateType: 'Order',
  aggregateId: ORDER_ID,
  eventType: 'order.confirmed',
  payload: { orderId: ORDER_ID, customerId: 'c' },
  occurredAt: new Date('2026-08-19T06:00:00.000Z'),
  attempt: 1,
  ...overrides,
});

describe('notification queue configuration (S6-NOTIFY-INAPP)', () => {
  it('uses the queue name SDD 11.1 states', () => {
    expect(NOTIFICATION_QUEUE_NAME).toBe('notifications');
    expect(NOTIFICATION_JOB_NAME).toBe('deliver');
  });

  it('applies SDD 11.3’s channel retry budget of 3 attempts', () => {
    // Channel-level, not relay-level: the outbox relay keeps its own 5/5s/5min.
    expect(NOTIFICATION_JOB_ATTEMPTS).toBe(3);
    expect(NOTIFICATION_JOB_OPTIONS.attempts).toBe(3);
  });

  it('applies SDD 11.3’s literal 1s / 10s / 60s schedule', () => {
    // BullMQ's built-in exponential doubles from the base (1s, 2s), which is
    // not what the document says — hence the named custom strategy.
    expect([...NOTIFICATION_BACKOFF_MS]).toEqual([1_000, 10_000, 60_000]);
    expect(NOTIFICATION_JOB_OPTIONS.backoff).toEqual({ type: 'notification' });
  });

  it('keeps failed jobs far longer than completed ones, so a dead letter is triageable', () => {
    const completed = NOTIFICATION_JOB_OPTIONS.removeOnComplete as { age: number };
    const failed = NOTIFICATION_JOB_OPTIONS.removeOnFail as { age: number };

    expect(failed.age).toBeGreaterThan(completed.age);
  });
});

describe('NotificationOutboxHandler (S6-NOTIFY-INAPP)', () => {
  it('enqueues and returns — it holds nothing else it could do', async () => {
    const spy = queue();

    await createNotificationOutboxHandler(spy, new NullLogger()).handle(event());

    expect(spy.enqueue).toHaveBeenCalledTimes(1);
  });

  it('passes the outbox id, event type and payload through unchanged', async () => {
    const spy = queue();

    await createNotificationOutboxHandler(spy, new NullLogger()).handle(event());

    expect(spy.enqueue).toHaveBeenCalledWith({
      outboxEventId: OUTBOX_EVENT_ID,
      eventType: 'order.confirmed',
      payload: { orderId: ORDER_ID, customerId: 'c' },
    } satisfies NotificationJob);
  });

  it.each(['order.confirmed', 'order.placed', 'order.payment_failed', 'order.cancelled'])(
    'enqueues %s',
    async (eventType) => {
      const spy = queue();

      await createNotificationOutboxHandler(spy, new NullLogger()).handle(event({ eventType }));

      expect(spy.enqueue).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'order.payment_initiated',
    'sub_order.processing_started',
    'sub_order.shipped',
    'sub_order.delivered',
    'sub_order.ready_for_pickup',
    'sub_order.pickup_completed',
  ])('does not enqueue %s', async (eventType) => {
    const spy = queue();

    await createNotificationOutboxHandler(spy, new NullLogger()).handle(event({ eventType }));

    expect(spy.enqueue).not.toHaveBeenCalled();
  });

  it('propagates an enqueue failure so the relay retries the event', async () => {
    // Swallowing it would mark the outbox row processed with nothing queued.
    const failing: NotificationQueue = {
      enqueue: vi.fn().mockRejectedValue(new Error('redis unreachable')),
    };

    await expect(
      createNotificationOutboxHandler(failing, new NullLogger()).handle(event()),
    ).rejects.toThrow('redis unreachable');
  });
});

describe('notification job parsing (S6-NOTIFY-INAPP)', () => {
  it('accepts a well-formed job', () => {
    const parsed = parseNotificationJob({
      outboxEventId: OUTBOX_EVENT_ID,
      eventType: 'order.confirmed',
      payload: { orderId: ORDER_ID },
    });

    expect(parsed.outboxEventId).toBe(OUTBOX_EVENT_ID);
  });

  it('defaults a missing payload to an empty object rather than crashing the worker', () => {
    const parsed = parseNotificationJob({
      outboxEventId: OUTBOX_EVENT_ID,
      eventType: 'order.confirmed',
      payload: null as unknown as Record<string, unknown>,
    });

    expect(parsed.payload).toEqual({});
  });

  it('refuses a job with no outbox id', () => {
    expect(() =>
      parseNotificationJob({
        eventType: 'order.confirmed',
        payload: {},
      } as unknown as NotificationJob),
    ).toThrow(/outboxEventId/);
  });
});
