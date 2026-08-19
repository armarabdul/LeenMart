import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaClient } from '@prisma/client';
import { PrismaOutboxRelayStore } from '../../src/shared/infrastructure/persistence/prisma-outbox-relay-store.js';
import { PrismaOutboxWriter } from '../../src/shared/infrastructure/persistence/prisma-outbox-writer.js';
import {
  OUTBOX_MAX_ATTEMPTS,
  OutboxRelay,
  outboxBackoffMs,
} from '../../src/shared/application/services/outbox-relay.js';
import {
  OUTBOX_WILDCARD,
  createOutboxHandlerRegistry,
  type OutboxHandler,
} from '../../src/shared/application/ports/outbox-handler.port.js';

/** Every row this suite creates carries this aggregate type, so cleanup is exact. */
const AGGREGATE_TYPE = `OutboxRelayTest-${randomUUID()}`;

/**
 * The suite runs entirely inside a window far in the past.
 *
 * `outbox_events` is a real table with real history — this database holds
 * thousands of events written since S3-3A that no relay ever consumed — and the
 * relay claims oldest-first across all of them. Rather than mutate that
 * backlog, every event this file writes is dated into 2020 and made due there,
 * and every relay runs on a clock inside the same window. The backlog's own
 * `next_attempt_at` is "now", so it is simply not due yet from 2020's point of
 * view, and the suite sees only its own rows.
 */
const TEST_EPOCH = new Date('2020-01-01T00:00:00.000Z');
const DUE_AT = new Date('2020-01-01T00:00:00.000Z');
const NOW = new Date('2020-01-01T00:05:00.000Z');

/**
 * The transactional outbox relay against real PostgreSQL (S5-OUTBOX).
 *
 * The claim is an atomic conditional UPDATE, and the row is in a
 * range-partitioned table with a composite primary key — neither of which a
 * mock can be wrong about in the way that matters. So the claim race, the
 * backoff schedule, the dead-letter terminal state and its CHECK constraint are
 * all asserted against the database.
 */
describe('Outbox relay (S5-OUTBOX)', () => {
  let db: PrismaClient;
  const ids = new UuidV7Generator();

  const clockAt = (instant: Date): FixedClock => new FixedClock(instant);

  const storeAt = (instant: Date): PrismaOutboxRelayStore =>
    new PrismaOutboxRelayStore(db, clockAt(instant));

  const relayAt = (
    instant: Date,
    handlers: readonly OutboxHandler[],
    batchSize?: number,
  ): OutboxRelay =>
    new OutboxRelay({
      store: storeAt(instant),
      registry: createOutboxHandlerRegistry(handlers),
      logger: new NullLogger(),
      ...(batchSize === undefined ? {} : { batchSize }),
    });

  /** Writes one event through the real producer-side writer. */
  const writeEvent = async (
    overrides: { eventType?: string; occurredAt?: Date; aggregateId?: string } = {},
  ): Promise<string> => {
    const writer = new PrismaOutboxWriter(db, ids, clockAt(overrides.occurredAt ?? TEST_EPOCH));
    const aggregateId = overrides.aggregateId ?? randomUUID();
    await writer.write({
      aggregateType: AGGREGATE_TYPE,
      aggregateId,
      eventType: overrides.eventType ?? 'test.event',
      payload: { hello: 'world' },
    });
    const row = await db.outboxEvent.findFirstOrThrow({
      where: { aggregateType: AGGREGATE_TYPE, aggregateId },
      orderBy: { createdAt: 'desc' },
    });
    // Due inside the test window. The producer defaults this to its own "now",
    // which would put the row behind the live backlog rather than ahead of it.
    await db.outboxEvent.updateMany({
      where: { id: row.id, createdAt: row.createdAt },
      data: { nextAttemptAt: DUE_AT },
    });
    return row.id;
  };

  type OutboxRow = Awaited<ReturnType<PrismaClient['outboxEvent']['findFirstOrThrow']>>;

  const rowFor = async (id: string): Promise<OutboxRow> =>
    db.outboxEvent.findFirstOrThrow({ where: { id, aggregateType: AGGREGATE_TYPE } });

  const okHandler = (): OutboxHandler & { seen: string[] } => {
    const seen: string[] = [];
    return {
      eventType: OUTBOX_WILDCARD,
      name: 'ok',
      seen,
      handle: (event): Promise<void> => {
        seen.push(event.id);
        return Promise.resolve();
      },
    };
  };

  const failingHandler = (): OutboxHandler => ({
    eventType: OUTBOX_WILDCARD,
    name: 'broken',
    handle: (): Promise<void> => Promise.reject(new Error('downstream unavailable')),
  });

  beforeAll(() => {
    db = new PrismaClient();
  });

  afterEach(async () => {
    await db.outboxEvent.deleteMany({ where: { aggregateType: AGGREGATE_TYPE } });
  });

  afterAll(async () => {
    await db.outboxEvent.deleteMany({ where: { aggregateType: AGGREGATE_TYPE } });
    await db.$disconnect();
  });

  describe('the producer side is unchanged', () => {
    it('writes an event that is immediately claimable', async () => {
      const id = await writeEvent();

      const row = await rowFor(id);

      expect(row.processedAt).toBeNull();
      expect(row.deadLetteredAt).toBeNull();
      expect(row.attempts).toBe(0);
      // The producer wrote no relay state of its own — `next_attempt_at`
      // defaulted, and `writeEvent` then moved it into the test window. No
      // producer change was needed to make the relay work.
      expect(row.nextAttemptAt.getTime()).toBe(DUE_AT.getTime());
    });
  });

  describe('claim and dispatch', () => {
    it('delivers an event to its handler and marks it processed', async () => {
      const id = await writeEvent();
      const handler = okHandler();

      const result = await relayAt(NOW, [handler]).tick();

      expect(handler.seen).toContain(id);
      expect(result.dispatched).toBeGreaterThanOrEqual(1);
      const row = await rowFor(id);
      expect(row.processedAt).not.toBeNull();
      expect(row.attempts).toBe(1);
      expect(row.lastError).toBeNull();
    });

    it('does not redeliver an event it already processed', async () => {
      const id = await writeEvent();
      await relayAt(NOW, [okHandler()]).tick();

      const second = okHandler();
      await relayAt(NOW, [second]).tick();

      expect(second.seen).not.toContain(id);
    });

    it('marks an event with no registered handler processed', async () => {
      const id = await writeEvent();

      await relayAt(NOW, []).tick();

      expect((await rowFor(id)).processedAt).not.toBeNull();
    });

    it('claims no more than the batch size', async () => {
      await writeEvent();
      await writeEvent();
      await writeEvent();

      const result = await relayAt(NOW, [okHandler()], 2).tick();

      expect(result.claimed).toBe(2);
    });

    it('claims oldest-first, so a sequential dispatch preserves order', async () => {
      const aggregateId = randomUUID();
      const older = await writeEvent({
        aggregateId,
        occurredAt: new Date('2020-01-01T00:00:00.000Z'),
      });
      const newer = await writeEvent({
        aggregateId,
        occurredAt: new Date('2020-01-01T00:01:00.000Z'),
      });
      const handler = okHandler();

      await relayAt(NOW, [handler], 50).tick();

      const seenOlder = handler.seen.indexOf(older);
      const seenNewer = handler.seen.indexOf(newer);
      expect(seenOlder).toBeGreaterThanOrEqual(0);
      expect(seenNewer).toBeGreaterThan(seenOlder);
    });
  });

  describe('the claim is atomic', () => {
    it('hands one event to exactly one of two concurrent relays', async () => {
      // The property a mock cannot prove. Two relays tick simultaneously
      // against one row; the conditional UPDATE decides the winner.
      const id = await writeEvent();
      const first = okHandler();
      const second = okHandler();

      const [a, b] = await Promise.all([
        relayAt(NOW, [first]).tick(),
        relayAt(NOW, [second]).tick(),
      ]);

      const deliveries =
        first.seen.filter((s) => s === id).length + second.seen.filter((s) => s === id).length;
      expect(deliveries).toBe(1);
      expect(a.claimed + b.claimed).toBe(1);
      expect((await rowFor(id)).attempts).toBe(1);
    });

    it('never lets two relays both claim the same batch', async () => {
      for (let i = 0; i < 5; i += 1) await writeEvent();
      const first = okHandler();
      const second = okHandler();

      await Promise.all([relayAt(NOW, [first], 10).tick(), relayAt(NOW, [second], 10).tick()]);

      const all = [...first.seen, ...second.seen];
      expect(new Set(all).size).toBe(all.length);
    });
  });

  describe('retry and backoff', () => {
    it('records the failure and schedules the next attempt', async () => {
      const id = await writeEvent();
      const at = NOW;

      await relayAt(at, [failingHandler()]).tick();

      const row = await rowFor(id);
      expect(row.processedAt).toBeNull();
      expect(row.deadLetteredAt).toBeNull();
      expect(row.attempts).toBe(1);
      expect(row.lastError).toContain('downstream unavailable');
      // The claim moved the schedule forward, so the backoff runs from the
      // moment the attempt began.
      expect(row.nextAttemptAt.getTime()).toBe(at.getTime() + outboxBackoffMs(1));
    });

    it('does not re-claim an event whose backoff has not elapsed', async () => {
      const at = NOW;
      await writeEvent();
      await relayAt(at, [failingHandler()]).tick();

      const tooSoon = await relayAt(new Date(at.getTime() + 1_000), [okHandler()]).tick();

      expect(tooSoon.claimed).toBe(0);
    });

    it('re-claims once the backoff has elapsed', async () => {
      const at = NOW;
      const id = await writeEvent();
      await relayAt(at, [failingHandler()]).tick();

      const later = new Date(at.getTime() + outboxBackoffMs(1) + 1_000);
      const handler = okHandler();
      await relayAt(later, [handler]).tick();

      expect(handler.seen).toContain(id);
      const row = await rowFor(id);
      expect(row.attempts).toBe(2);
      expect(row.processedAt).not.toBeNull();
      // A row that failed and later succeeded must not read as still broken.
      expect(row.lastError).toBeNull();
    });

    it('backs off further with each successive failure', async () => {
      const id = await writeEvent();
      let at = NOW;

      await relayAt(at, [failingHandler()]).tick();
      const first = (await rowFor(id)).nextAttemptAt;

      at = new Date(first.getTime() + 1_000);
      await relayAt(at, [failingHandler()]).tick();
      const second = (await rowFor(id)).nextAttemptAt;

      expect(second.getTime() - at.getTime()).toBeGreaterThan(
        first.getTime() - (at.getTime() - outboxBackoffMs(1) - 1_000),
      );
      expect((await rowFor(id)).attempts).toBe(2);
    });
  });

  describe('dead letter', () => {
    it('stops trying once the attempt budget is spent', async () => {
      const id = await writeEvent();
      let at = NOW;

      for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
        await relayAt(at, [failingHandler()]).tick();
        at = new Date((await rowFor(id)).nextAttemptAt.getTime() + 1_000);
      }

      const row = await rowFor(id);
      expect(row.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
      expect(row.deadLetteredAt).not.toBeNull();
      expect(row.processedAt).toBeNull();
    });

    it('never claims a dead-lettered event again', async () => {
      const id = await writeEvent();
      let at = NOW;
      for (let attempt = 1; attempt <= OUTBOX_MAX_ATTEMPTS; attempt += 1) {
        await relayAt(at, [failingHandler()]).tick();
        at = new Date((await rowFor(id)).nextAttemptAt.getTime() + 1_000);
      }

      const handler = okHandler();
      const result = await relayAt(new Date(at.getTime() + 60 * 60 * 1_000), [handler]).tick();

      expect(handler.seen).not.toContain(id);
      expect(result.claimed).toBe(0);
    });

    it('refuses a row that is both processed and dead-lettered', async () => {
      // The CHECK constraint, asserted on its own: the guarantee must not
      // depend on the relay never writing the contradiction.
      const id = await writeEvent();
      const row = await rowFor(id);

      await expect(
        db.outboxEvent.update({
          where: { id_createdAt: { id, createdAt: row.createdAt } },
          data: { processedAt: NOW, deadLetteredAt: NOW },
        }),
      ).rejects.toThrow();
    });
  });

  describe('at-least-once', () => {
    it('redelivers an event whose dispatch never recorded an outcome', async () => {
      // A relay that dies between dispatch and mark: the claim already moved
      // the schedule, so the event returns on its own once the backoff elapses.
      const at = NOW;
      const id = await writeEvent();
      const claimed = await storeAt(at).claimDue(10);
      expect(claimed.map((c) => c.id)).toContain(id);

      const later = new Date(at.getTime() + outboxBackoffMs(1) + 1_000);
      const handler = okHandler();
      await relayAt(later, [handler]).tick();

      expect(handler.seen).toContain(id);
    });
  });
});
