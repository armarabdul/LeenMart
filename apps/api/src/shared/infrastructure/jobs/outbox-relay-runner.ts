import type { Logger } from '@leen-mart/domain-kit';
import type { OutboxRelay } from '../../application/services/outbox-relay.js';

/** SDD 11.1: "Outbox relay (worker, polls every 1s)". */
export const OUTBOX_POLL_INTERVAL_MS = 1_000;

export interface OutboxRelayRunner {
  /** Resolves once the loop has stopped and any in-flight tick has finished. */
  close(): Promise<void>;
  /** For diagnostics and tests — the loop is otherwise silent when idle. */
  readonly running: boolean;
}

/**
 * Runs the relay on a timer inside the worker process (S5-OUTBOX).
 *
 * **A plain loop, not a BullMQ queue.** SDD 11.1 draws the relay pushing into a
 * `notifications` queue, and that remains the shape once there is something to
 * consume it — but this milestone has no channel adapters, so a queue here
 * would be a second store of retry state with nothing on the other end. The
 * retry, backoff and dead-letter state the locked decisions describe all live in
 * `outbox_events` itself, which is the only place that survives a Redis flush.
 * `OutboxHandlerRegistry` is the seam: a future notification handler enqueues,
 * and this loop does not change.
 *
 * **Self-scheduling rather than `setInterval`.** The next tick is booked only
 * after the previous one finishes, so a slow batch can never overlap itself into
 * a pile of concurrent relays competing for the same rows. `unref()` keeps the
 * timer from holding the process open on its own.
 *
 * A tick never rejects — `OutboxRelay.tick` records handler failures rather than
 * throwing — but the loop still guards, because a store-level failure (the
 * database briefly unreachable) must pause the relay rather than kill the
 * worker.
 */
export const startOutboxRelay = (
  relay: OutboxRelay,
  logger: Logger,
  intervalMs: number = OUTBOX_POLL_INTERVAL_MS,
): OutboxRelayRunner => {
  let stopped = false;
  let inFlight: Promise<unknown> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = run();
      void inFlight;
    }, intervalMs);
    timer.unref();
  };

  const run = async (): Promise<void> => {
    try {
      await relay.tick();
    } catch (error) {
      // The database is unreachable, or the claim itself failed. Log once and
      // let the next tick retry — the events are durable, so nothing is lost by
      // waiting.
      logger.error({ err: error }, 'Outbox relay tick failed');
    } finally {
      schedule();
    }
  };

  schedule();

  return {
    get running(): boolean {
      return !stopped;
    },
    close: async (): Promise<void> => {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Let a tick already in progress finish: it has claimed events, and
      // abandoning it would leave them to wait out their backoff for nothing.
      await inFlight;
    },
  };
};
