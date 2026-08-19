import { describe, expect, it, vi } from 'vitest';
import { NullLogger } from '@leen-mart/domain-kit';
import type { OutboxRelay } from '../../../src/shared/application/services/outbox-relay.js';
import {
  OUTBOX_POLL_INTERVAL_MS,
  startOutboxRelay,
} from '../../../src/shared/infrastructure/jobs/outbox-relay-runner.js';

const IDLE = { claimed: 0, dispatched: 0, failed: 0, deadLettered: 0 };

/** A relay whose tick resolves on demand, so a test can hold one in flight. */
const controllableRelay = (): {
  relay: OutboxRelay;
  tick: ReturnType<typeof vi.fn>;
  release: () => void;
} => {
  let resolve: (() => void) | undefined;
  const tick = vi.fn().mockImplementation(
    () =>
      new Promise((done) => {
        resolve = () => done(IDLE);
      }),
  );
  return {
    relay: { tick } as unknown as OutboxRelay,
    tick,
    release: () => resolve?.(),
  };
};

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('startOutboxRelay (S5-OUTBOX)', () => {
  it('polls at SDD 11.1’s one-second interval by default', () => {
    expect(OUTBOX_POLL_INTERVAL_MS).toBe(1_000);
  });

  it('does not tick before the first interval elapses', () => {
    vi.useFakeTimers();
    try {
      const tick = vi.fn().mockResolvedValue(IDLE);
      startOutboxRelay({ tick } as unknown as OutboxRelay, new NullLogger(), 50);

      expect(tick).not.toHaveBeenCalled();
      vi.advanceTimersByTime(49);
      expect(tick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ticks once the interval elapses', () => {
    vi.useFakeTimers();
    try {
      const tick = vi.fn().mockResolvedValue(IDLE);
      startOutboxRelay({ tick } as unknown as OutboxRelay, new NullLogger(), 50);

      vi.advanceTimersByTime(50);

      expect(tick).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never overlaps a slow tick with the next one', async () => {
    // Self-scheduling rather than `setInterval`: a batch slower than the poll
    // interval would otherwise pile relays up against the same rows.
    vi.useFakeTimers();
    try {
      const { relay, tick, release } = controllableRelay();
      startOutboxRelay(relay, new NullLogger(), 50);

      vi.advanceTimersByTime(50);
      expect(tick).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(500);
      expect(tick).toHaveBeenCalledTimes(1);

      release();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(50);
      expect(tick).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps polling after a tick rejects', async () => {
    // A store-level failure — the database briefly unreachable — must pause
    // the relay, not kill the worker.
    vi.useFakeTimers();
    try {
      const tick = vi
        .fn()
        .mockRejectedValueOnce(new Error('database unreachable'))
        .mockResolvedValue(IDLE);
      startOutboxRelay({ tick } as unknown as OutboxRelay, new NullLogger(), 50);

      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);

      expect(tick).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports itself running until closed', async () => {
    const runner = startOutboxRelay(
      { tick: vi.fn().mockResolvedValue(IDLE) } as unknown as OutboxRelay,
      new NullLogger(),
      10_000,
    );

    expect(runner.running).toBe(true);
    await runner.close();
    expect(runner.running).toBe(false);
  });

  it('stops scheduling once closed', async () => {
    const tick = vi.fn().mockResolvedValue(IDLE);
    const runner = startOutboxRelay({ tick } as unknown as OutboxRelay, new NullLogger(), 5);

    await runner.close();
    await new Promise((r) => setTimeout(r, 40));

    expect(tick).not.toHaveBeenCalled();
  });

  it('waits for an in-flight tick before resolving close', async () => {
    // The tick has already claimed events; abandoning it would leave them to
    // wait out their backoff for nothing.
    const { relay, tick, release } = controllableRelay();
    const runner = startOutboxRelay(relay, new NullLogger(), 1);

    await new Promise((r) => setTimeout(r, 20));
    expect(tick).toHaveBeenCalled();

    let closed = false;
    const closing = runner.close().then(() => {
      closed = true;
    });
    await settle();
    expect(closed).toBe(false);

    release();
    await closing;
    expect(closed).toBe(true);
  });
});
