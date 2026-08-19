import type { Logger } from '@leen-mart/domain-kit';
import type { OutboxHandlerRegistry } from '../ports/outbox-handler.port.js';
import type { ClaimedOutboxEvent, OutboxRelayStore } from '../ports/outbox-relay.port.js';

/**
 * How many events one tick claims.
 *
 * 20, inherited from `DEFAULT_LIMIT` in `search-products.use-case.ts` and
 * `paginationSchema`'s own default — this repository's standing answer to "a
 * bounded page of rows". The bound matters here for a specific reason: every
 * claimed event has already had `next_attempt_at` pushed forward, so a batch is
 * a promise to try that many events *now*. A large batch turns a slow handler
 * into a long stall before the next claim.
 */
export const OUTBOX_BATCH_SIZE = 20;

/**
 * The attempt budget before an event is dead-lettered.
 *
 * Five rather than the media queue's three: that queue re-encodes an image, and
 * a failure there is usually permanent (a corrupt file). This is the platform's
 * durability layer for domain events, where failures are more often transient —
 * a downstream service restarting — so it is worth a longer tail before giving
 * up. With the backoff below, five attempts span roughly six minutes.
 *
 * A second reason, specific to a claim-based relay: `claimDue` increments
 * `attempts` *before* dispatch, so a worker that restarts consumes an attempt
 * without ever calling a handler. A small budget punishes restarts.
 *
 * **This is deliberately not SDD 11.3's "3 attempts (1 s / 10 s / 60 s)".**
 * That policy is channel-level — it sits beside "consumers are idempotent on
 * `(event_id, channel, recipient)`" and §11.1's "each channel with its own
 * retry policy" — and governs SES/SMS/push dispatch, not the relay's own claim
 * loop. Reviewed and locked as such; a future notification milestone applies
 * §11.3's numbers at the channel, not here.
 */
export const OUTBOX_MAX_ATTEMPTS = 5;

/**
 * Exponential, from the same 5-second base `PRODUCT_MEDIA_PROCESSING_JOB_OPTIONS`
 * uses, and **capped** — unbounded doubling would push a late retry hours out and
 * make the backlog unreadable. 5s, 10s, 20s, 40s, then the cap.
 */
export const OUTBOX_BACKOFF_BASE_MS = 5_000;
export const OUTBOX_BACKOFF_CAP_MS = 5 * 60 * 1_000;

/** The delay before the attempt after this one. `attempt` is 1-based. */
export const outboxBackoffMs = (attempt: number): number =>
  Math.min(OUTBOX_BACKOFF_CAP_MS, OUTBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));

export interface OutboxRelayDeps {
  readonly store: OutboxRelayStore;
  readonly registry: OutboxHandlerRegistry;
  readonly logger: Logger;
  readonly batchSize?: number;
}

export interface OutboxRelayTickResult {
  readonly claimed: number;
  readonly dispatched: number;
  readonly failed: number;
  readonly deadLettered: number;
}

/**
 * The transactional outbox relay (S5-OUTBOX, SDD 11.1, IMP-04, SC-06).
 *
 * Producers write an `outbox_events` row inside the same transaction as the
 * business write, so either both happened or neither did. This is the half that
 * has been missing since S3-3A: something that reads those rows and tells the
 * rest of the system.
 *
 * **Delivery is at-least-once.** The sequence is claim → dispatch → mark, and a
 * crash between the second and third step replays the event. Making it
 * exactly-once would require a distributed transaction between PostgreSQL and
 * whatever each handler talks to; the standard trade is to keep the relay
 * simple and require handlers to be idempotent, which is what
 * `OutboxHandler`'s own contract states.
 *
 * **Ordering is per-aggregate, best-effort, and not a guarantee.** Events are
 * claimed oldest-first and dispatched *sequentially*, so within one tick two
 * events for the same aggregate reach handlers in the order they occurred.
 * Nothing enforces that across ticks or across relay instances — that would
 * need per-aggregate locking, which the milestone deliberately does not buy.
 * Sequential dispatch costs nothing beyond the batch's own latency and is the
 * only reason any ordering holds at all, so it is not an optimisation to
 * reverse later without saying so.
 *
 * **An event with no handler is processed, not failed.** Most event types have
 * no consumer yet; treating that as an error would dead-letter the entire
 * backlog on the first tick.
 */
export class OutboxRelay {
  private readonly batchSize: number;

  constructor(private readonly deps: OutboxRelayDeps) {
    this.batchSize = deps.batchSize ?? OUTBOX_BATCH_SIZE;
  }

  /**
   * One poll: claim a batch, dispatch each, record every outcome.
   *
   * Never throws for a handler's sake — a failed dispatch is recorded and
   * retried, because a relay that dies on a bad event stops delivering every
   * other event too.
   */
  async tick(): Promise<OutboxRelayTickResult> {
    const claimed = await this.deps.store.claimDue(this.batchSize);
    let dispatched = 0;
    let failed = 0;
    let deadLettered = 0;

    for (const event of claimed) {
      const error = await this.dispatch(event);
      await this.deps.store.recordOutcome({
        id: event.id,
        createdAt: event.createdAt,
        attempt: event.attempt,
        error,
      });

      if (error === null) {
        dispatched += 1;
        continue;
      }
      failed += 1;
      if (event.attempt >= OUTBOX_MAX_ATTEMPTS) {
        deadLettered += 1;
        this.deps.logger.error(
          { outboxEventId: event.id, eventType: event.eventType, attempts: event.attempt, error },
          'Outbox event dead-lettered after exhausting its attempts',
        );
      }
    }

    if (claimed.length > 0) {
      this.deps.logger.info(
        { claimed: claimed.length, dispatched, failed, deadLettered },
        'Outbox relay tick',
      );
    }
    return { claimed: claimed.length, dispatched, failed, deadLettered };
  }

  /**
   * Runs every matching handler. Returns `null` on success, or the collected
   * failure text.
   *
   * Every handler is attempted even after one fails: they are independent
   * consumers, and letting the first failure cancel the rest would make one
   * broken consumer silently starve the others. The dispatch as a whole still
   * fails, so the event is retried — which is precisely why handlers must
   * tolerate seeing an event they already handled.
   */
  private async dispatch(event: ClaimedOutboxEvent): Promise<string | null> {
    const handlers = this.deps.registry.handlersFor(event.eventType);
    if (handlers.length === 0) {
      return null;
    }

    const failures: string[] = [];
    for (const handler of handlers) {
      try {
        await handler.handle(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${handler.name}: ${message}`);
        this.deps.logger.warn(
          { outboxEventId: event.id, handler: handler.name, attempt: event.attempt, err: error },
          'Outbox handler failed',
        );
      }
    }
    return failures.length === 0 ? null : failures.join(' | ');
  }
}
