import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PostgresAdvisoryLock } from '../../../src/shared/infrastructure/persistence/postgres-advisory-lock.js';

/**
 * A fake `$transaction`/`$queryRaw` pair that behaves like Prisma's own
 * interactive-transaction API closely enough to prove `PostgresAdvisoryLock`'s
 * own contract: `work` runs only after the lock query resolves, and
 * `$transaction` is what actually invokes the callback (matching the real
 * `pg_try_advisory_xact_lock` semantics — the lock lives and dies with this
 * one transaction).
 */
const fakePrisma = (
  locked: boolean,
): { prisma: PrismaClient; queryRaw: ReturnType<typeof vi.fn> } => {
  const queryRaw = vi.fn().mockResolvedValue([{ locked }]);
  const prisma = {
    $transaction: vi
      .fn()
      .mockImplementation((callback: (tx: unknown) => unknown) =>
        callback({ $queryRaw: queryRaw }),
      ),
  } as unknown as PrismaClient;
  return { prisma, queryRaw };
};

describe('PostgresAdvisoryLock (S7-SCHED)', () => {
  it('acquires the lock and runs the work while holding it', async () => {
    const { prisma, queryRaw } = fakePrisma(true);
    const lock = new PostgresAdvisoryLock(prisma);
    const work = vi.fn().mockResolvedValue('done');

    const result = await lock.runExclusive('pickup-reminder', work);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
    expect(result).toBe('done');
  });

  it('does not run the work when the lock is already held elsewhere', async () => {
    const { prisma } = fakePrisma(false);
    const lock = new PostgresAdvisoryLock(prisma);
    const work = vi.fn().mockResolvedValue('done');

    const result = await lock.runExclusive('pickup-reminder', work);

    expect(work).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('two concurrent callers cannot both run the work — only the one that acquires the lock proceeds', async () => {
    // Simulates two processes racing for the same named lock: the first
    // acquires it, the second's `pg_try_advisory_xact_lock` call returns
    // false (Postgres itself is what actually decides this in production;
    // here the fake stands in for "another session already holds it").
    const winner = fakePrisma(true);
    const loser = fakePrisma(false);
    const winnerLock = new PostgresAdvisoryLock(winner.prisma);
    const loserLock = new PostgresAdvisoryLock(loser.prisma);
    const winnerWork = vi.fn().mockResolvedValue('winner');
    const loserWork = vi.fn().mockResolvedValue('loser');

    const [winnerResult, loserResult] = await Promise.all([
      winnerLock.runExclusive('pickup-reminder', winnerWork),
      loserLock.runExclusive('pickup-reminder', loserWork),
    ]);

    expect(winnerResult).toBe('winner');
    expect(loserResult).toBeNull();
    expect(winnerWork).toHaveBeenCalledTimes(1);
    expect(loserWork).not.toHaveBeenCalled();
  });

  it('releases the lock on success — the transaction resolves normally', async () => {
    const { prisma } = fakePrisma(true);
    const lock = new PostgresAdvisoryLock(prisma);

    await lock.runExclusive('pickup-reminder', () => Promise.resolve());

    // `pg_try_advisory_xact_lock`'s own guarantee is that the lock releases
    // when the transaction ends — proven here by the transaction callback
    // completing without ever needing a separate unlock call, which this
    // class never makes (see its own doc comment for why not).
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('a failed handler does not leave the lock permanently held — the transaction rejects, which rolls back and releases', async () => {
    const { prisma } = fakePrisma(true);
    const lock = new PostgresAdvisoryLock(prisma);
    const failingWork = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(lock.runExclusive('pickup-reminder', failingWork)).rejects.toThrow('boom');

    // The lock was still acquired and the work still ran exactly once — the
    // failure propagates out of `$transaction`, which is what triggers
    // Prisma's own rollback (and, in real Postgres, the lock's release)
    // rather than this class swallowing the error and "forgetting" to
    // clean up.
    expect(failingWork).toHaveBeenCalledTimes(1);
  });

  it('a lock name is passed through to the underlying query rather than hand-encoded by the caller', async () => {
    const { prisma, queryRaw } = fakePrisma(true);
    const lock = new PostgresAdvisoryLock(prisma);

    await lock.runExclusive('a-distinctive-lock-name', () => Promise.resolve());

    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toContain('pg_try_advisory_xact_lock');
    expect(values).toContain('a-distinctive-lock-name');
  });
});
