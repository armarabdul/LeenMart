import { describe, expect, it, vi } from 'vitest';
import { NullLogger } from '@leen-mart/domain-kit';
import {
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_CAP_MS,
  OUTBOX_BATCH_SIZE,
  OUTBOX_MAX_ATTEMPTS,
  OutboxRelay,
  outboxBackoffMs,
} from '../../../src/shared/application/services/outbox-relay.js';
import {
  OUTBOX_WILDCARD,
  createOutboxHandlerRegistry,
  type OutboxHandler,
} from '../../../src/shared/application/ports/outbox-handler.port.js';
import type {
  ClaimedOutboxEvent,
  OutboxDispatchOutcome,
  OutboxRelayStore,
} from '../../../src/shared/application/ports/outbox-relay.port.js';

const OCCURRED = new Date('2026-08-19T06:00:00.000Z');

const event = (overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent => ({
  id: 'event-1',
  createdAt: OCCURRED,
  aggregateType: 'Order',
  aggregateId: 'order-1',
  eventType: 'order.placed',
  payload: { orderId: 'order-1' },
  occurredAt: OCCURRED,
  attempt: 1,
  ...overrides,
});

interface StoreSpy extends OutboxRelayStore {
  readonly outcomes: OutboxDispatchOutcome[];
  readonly claimDue: ReturnType<typeof vi.fn>;
}

const store = (claimed: readonly ClaimedOutboxEvent[] = []): StoreSpy => {
  const outcomes: OutboxDispatchOutcome[] = [];
  const claimDue = vi.fn().mockResolvedValue(claimed);
  return {
    outcomes,
    claimDue,
    recordOutcome: (outcome: OutboxDispatchOutcome): Promise<void> => {
      outcomes.push(outcome);
      return Promise.resolve();
    },
  } as unknown as StoreSpy;
};

const handler = (
  overrides: Partial<OutboxHandler> & { readonly fails?: boolean } = {},
): OutboxHandler & { readonly seen: ClaimedOutboxEvent[] } => {
  const seen: ClaimedOutboxEvent[] = [];
  return {
    eventType: overrides.eventType ?? OUTBOX_WILDCARD,
    name: overrides.name ?? 'test',
    seen,
    handle: (received): Promise<void> => {
      seen.push(received as ClaimedOutboxEvent);
      return overrides.fails === true
        ? Promise.reject(new Error('handler exploded'))
        : Promise.resolve();
    },
  };
};

const relay = (
  claimed: readonly ClaimedOutboxEvent[],
  handlers: readonly OutboxHandler[] = [],
): { relay: OutboxRelay; store: StoreSpy } => {
  const spy = store(claimed);
  return {
    relay: new OutboxRelay({
      store: spy,
      registry: createOutboxHandlerRegistry(handlers),
      logger: new NullLogger(),
    }),
    store: spy,
  };
};

describe('outbox backoff (S5-OUTBOX)', () => {
  it('starts at the media queue’s own 5-second base', () => {
    expect(outboxBackoffMs(1)).toBe(OUTBOX_BACKOFF_BASE_MS);
  });

  it('doubles with each attempt', () => {
    expect(outboxBackoffMs(2)).toBe(10_000);
    expect(outboxBackoffMs(3)).toBe(20_000);
    expect(outboxBackoffMs(4)).toBe(40_000);
  });

  it('is bounded — an unbounded curve would push a late retry hours out', () => {
    expect(outboxBackoffMs(99)).toBe(OUTBOX_BACKOFF_CAP_MS);
  });

  it('never returns less than the base, even for a nonsensical attempt', () => {
    expect(outboxBackoffMs(0)).toBe(OUTBOX_BACKOFF_BASE_MS);
    expect(outboxBackoffMs(-5)).toBe(OUTBOX_BACKOFF_BASE_MS);
  });

  it('spends its whole budget inside a few minutes', () => {
    const total = Array.from({ length: OUTBOX_MAX_ATTEMPTS }, (_, i) =>
      outboxBackoffMs(i + 1),
    ).reduce((sum, ms) => sum + ms, 0);

    expect(total).toBeLessThan(10 * 60 * 1_000);
  });
});

describe('createOutboxHandlerRegistry (S5-OUTBOX)', () => {
  it('matches a handler registered for the exact event type', () => {
    const exact = handler({ eventType: 'order.placed', name: 'exact' });
    const registry = createOutboxHandlerRegistry([exact]);

    expect(registry.handlersFor('order.placed')).toEqual([exact]);
    expect(registry.handlersFor('order.cancelled')).toEqual([]);
  });

  it('matches a wildcard handler against anything', () => {
    const all = handler({ eventType: OUTBOX_WILDCARD, name: 'all' });

    expect(createOutboxHandlerRegistry([all]).handlersFor('anything.at.all')).toEqual([all]);
  });

  it('returns several matches in registration order', () => {
    const first = handler({ eventType: OUTBOX_WILDCARD, name: 'first' });
    const second = handler({ eventType: 'order.placed', name: 'second' });

    const matched = createOutboxHandlerRegistry([first, second]).handlersFor('order.placed');

    expect(matched.map((h) => h.name)).toEqual(['first', 'second']);
  });

  it('is empty by default, which is the S5-OUTBOX state', () => {
    expect(createOutboxHandlerRegistry([]).handlersFor('order.placed')).toEqual([]);
  });
});

describe('OutboxRelay (S5-OUTBOX)', () => {
  it('claims a bounded batch, not everything due', async () => {
    const { relay: subject, store: spy } = relay([]);

    await subject.tick();

    expect(spy.claimDue).toHaveBeenCalledWith(OUTBOX_BATCH_SIZE);
  });

  it('honours an explicitly configured batch size', async () => {
    const spy = store([]);
    await new OutboxRelay({
      store: spy,
      registry: createOutboxHandlerRegistry([]),
      logger: new NullLogger(),
      batchSize: 3,
    }).tick();

    expect(spy.claimDue).toHaveBeenCalledWith(3);
  });

  it('does nothing when nothing is due', async () => {
    const { relay: subject, store: spy } = relay([]);

    const result = await subject.tick();

    expect(result).toEqual({ claimed: 0, dispatched: 0, failed: 0, deadLettered: 0 });
    expect(spy.outcomes).toEqual([]);
  });

  it('dispatches a claimed event to its handler and marks it processed', async () => {
    const only = handler();
    const { relay: subject, store: spy } = relay([event()], [only]);

    const result = await subject.tick();

    expect(only.seen).toHaveLength(1);
    expect(result).toMatchObject({ claimed: 1, dispatched: 1, failed: 0 });
    expect(spy.outcomes).toEqual([{ id: 'event-1', createdAt: OCCURRED, attempt: 1, error: null }]);
  });

  it('marks an event with no handler processed rather than failing it', async () => {
    // Most event types have no consumer yet; treating that as a failure would
    // dead-letter the entire backlog on the first tick.
    const { relay: subject, store: spy } = relay([event()], []);

    const result = await subject.tick();

    expect(result).toMatchObject({ dispatched: 1, failed: 0 });
    expect(spy.outcomes[0]?.error).toBeNull();
  });

  it('records a handler failure instead of throwing', async () => {
    // A relay that dies on one bad event stops delivering every other event.
    const broken = handler({ fails: true, name: 'broken' });
    const { relay: subject, store: spy } = relay([event()], [broken]);

    const result = await subject.tick();

    expect(result).toMatchObject({ dispatched: 0, failed: 1, deadLettered: 0 });
    expect(spy.outcomes[0]?.error).toContain('broken: handler exploded');
  });

  it('runs every handler even after one fails', async () => {
    // Independent consumers: one broken handler must not starve the others.
    const broken = handler({ fails: true, name: 'broken' });
    const healthy = handler({ name: 'healthy' });
    const { relay: subject, store: spy } = relay([event()], [broken, healthy]);

    await subject.tick();

    expect(healthy.seen).toHaveLength(1);
    expect(spy.outcomes[0]?.error).toContain('broken');
  });

  it('reports the dispatch as failed when any handler failed, so the event retries', async () => {
    const broken = handler({ fails: true, name: 'broken' });
    const healthy = handler({ name: 'healthy' });
    const { relay: subject, store: spy } = relay([event()], [broken, healthy]);

    await subject.tick();

    expect(spy.outcomes[0]?.error).not.toBeNull();
  });

  it('counts a dead-letter once the attempt budget is spent', async () => {
    const broken = handler({ fails: true, name: 'broken' });
    const { relay: subject } = relay([event({ attempt: OUTBOX_MAX_ATTEMPTS })], [broken]);

    const result = await subject.tick();

    expect(result).toMatchObject({ failed: 1, deadLettered: 1 });
  });

  it('does not dead-letter one attempt short of the budget', async () => {
    const broken = handler({ fails: true, name: 'broken' });
    const { relay: subject } = relay([event({ attempt: OUTBOX_MAX_ATTEMPTS - 1 })], [broken]);

    const result = await subject.tick();

    expect(result).toMatchObject({ failed: 1, deadLettered: 0 });
  });

  it('dispatches sequentially, in claimed order', async () => {
    // The only reason per-aggregate ordering holds at all: parallel dispatch
    // would deliver two events for one aggregate in an arbitrary order.
    const order: string[] = [];
    const recorder: OutboxHandler = {
      eventType: OUTBOX_WILDCARD,
      name: 'recorder',
      handle: async (received) => {
        order.push(`${received.id}:start`);
        await Promise.resolve();
        order.push(`${received.id}:end`);
      },
    };
    const { relay: subject } = relay([event({ id: 'first' }), event({ id: 'second' })], [recorder]);

    await subject.tick();

    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('records an outcome for every claimed event, including failures', async () => {
    const broken = handler({ fails: true, name: 'broken' });
    const { relay: subject, store: spy } = relay(
      [event({ id: 'a' }), event({ id: 'b' })],
      [broken],
    );

    await subject.tick();

    expect(spy.outcomes.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('passes the attempt number through to the handler', async () => {
    const only = handler();
    const { relay: subject } = relay([event({ attempt: 3 })], [only]);

    await subject.tick();

    expect(only.seen[0]?.attempt).toBe(3);
  });
});
