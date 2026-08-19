import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@leen-mart/domain-kit';
import type {
  ClaimedOutboxEvent,
  OutboxDispatchOutcome,
  OutboxRelayStore,
} from '../../application/ports/outbox-relay.port.js';
import { OUTBOX_MAX_ATTEMPTS, outboxBackoffMs } from '../../application/services/outbox-relay.js';

/** The stored `payload` is `Json`; producers only ever write an object. */
const toPayload = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * The relay's PostgreSQL store (S5-OUTBOX).
 *
 * Bound to the worker's ordinary client. `outbox_events` carries no tenant
 * column and no RLS — it is platform infrastructure, deliberately absent from
 * `TENANT_SCOPED_MODELS` — so there is no tenant context to establish and no
 * policy to satisfy. `leenmart_app` already holds SELECT/UPDATE here, which is
 * why this milestone adds no grant.
 */
export class PrismaOutboxRelayStore implements OutboxRelayStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock,
  ) {}

  /**
   * Reads candidates, then **claims each with an atomic conditional UPDATE**.
   *
   * The read is a hint, not a decision: between it and the update another relay
   * may have taken the row. The `updateMany` re-states every predicate the read
   * filtered on — still unprocessed, still not dead-lettered, still due — so
   * only one claimant can match, and `count === 0` simply means someone else
   * won. That is the same shape `decrementIfAvailable` and `slot_capacity`'s
   * consume already use, and it is why no row lock or `SKIP LOCKED` is needed.
   *
   * The claim also moves `next_attempt_at` forward. A relay that dies after
   * claiming leaves an event that becomes claimable again on its own, without a
   * sweeper to notice.
   */
  async claimDue(batchSize: number): Promise<readonly ClaimedOutboxEvent[]> {
    const now = this.clock.now();
    const candidates = await this.prisma.outboxEvent.findMany({
      where: { processedAt: null, deadLetteredAt: null, nextAttemptAt: { lte: now } },
      orderBy: [{ occurredAt: 'asc' }],
      take: batchSize,
      select: {
        id: true,
        createdAt: true,
        aggregateType: true,
        aggregateId: true,
        eventType: true,
        payload: true,
        occurredAt: true,
        attempts: true,
      },
    });

    const claimed: ClaimedOutboxEvent[] = [];
    for (const candidate of candidates) {
      const attempt = candidate.attempts + 1;
      const result = await this.prisma.outboxEvent.updateMany({
        where: {
          id: candidate.id,
          createdAt: candidate.createdAt,
          processedAt: null,
          deadLetteredAt: null,
          nextAttemptAt: { lte: now },
        },
        data: {
          attempts: { increment: 1 },
          nextAttemptAt: new Date(now.getTime() + outboxBackoffMs(attempt)),
        },
      });
      if (result.count !== 1) continue;

      claimed.push({
        id: candidate.id,
        createdAt: candidate.createdAt,
        aggregateType: candidate.aggregateType,
        aggregateId: candidate.aggregateId,
        eventType: candidate.eventType,
        payload: toPayload(candidate.payload),
        occurredAt: candidate.occurredAt,
        attempt,
      });
    }
    return claimed;
  }

  /**
   * Records what happened to a claimed event.
   *
   * Success sets `processed_at` and clears `last_error`, so a row that once
   * failed and later succeeded does not read as still broken. Failure records
   * the error and, once the attempt budget is spent, sets `dead_lettered_at` —
   * the explicit terminal state, which a CHECK constraint keeps mutually
   * exclusive with `processed_at`.
   *
   * A failure short of the budget writes no schedule: `next_attempt_at` was
   * already moved by the claim, so the backoff is in effect from the moment the
   * attempt began rather than from the moment it gave up.
   */
  async recordOutcome(outcome: OutboxDispatchOutcome): Promise<void> {
    const now = this.clock.now();
    const key = { id: outcome.id, createdAt: outcome.createdAt };

    if (outcome.error === null) {
      await this.prisma.outboxEvent.updateMany({
        where: key,
        data: { processedAt: now, lastError: null },
      });
      return;
    }

    await this.prisma.outboxEvent.updateMany({
      where: key,
      data: {
        lastError: outcome.error.slice(0, 2_000),
        ...(outcome.attempt >= OUTBOX_MAX_ATTEMPTS ? { deadLetteredAt: now } : {}),
      },
    });
  }
}
