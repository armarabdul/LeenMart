import type { PrismaClient } from '@prisma/client';
import type { AdvisoryLock } from '../../application/ports/advisory-lock.port.js';

/**
 * `AdvisoryLock` on PostgreSQL's own session-scoped advisory lock primitive
 * (S7-SCHED, SDD §21.2). No schema, no table, no migration — advisory locks
 * are a built-in server-side counter keyed by an integer, entirely separate
 * from RLS and from any grant on application tables, which is why this
 * needs no new privilege on any credential it runs on.
 *
 * **`pg_try_advisory_xact_lock`, not the session-pair
 * `pg_advisory_lock`/`pg_advisory_unlock`.** The session pair ties the lock
 * to whichever physical connection issued the `LOCK` call, and Prisma's
 * pooled client offers no guarantee that the same connection services a
 * later `UNLOCK` call — a lock acquired on one pooled connection and
 * "released" on another simply never releases the one actually held. The
 * transaction-scoped variant sidesteps this entirely: it releases
 * automatically when the transaction ends, on the very connection that
 * acquired it, whether that end is a commit, a rollback, or the connection
 * dying outright. `work` runs *inside* that transaction (awaited before the
 * callback returns), so the lock is held for exactly `work`'s duration —
 * this is what makes "the lock is released correctly" and "a failed handler
 * does not leave the lock permanently held" true by construction rather
 * than by remembering to call something in a `finally`.
 *
 * `work` itself is free to use any other Prisma client or connection it
 * needs (S7-SCHED's own pickup-reminder job reads via `leenmart_checkout`
 * and writes via `leenmart_app`) — only the lock call itself has to run on
 * this instance's own transaction; nothing here requires the protected work
 * to share it.
 *
 * `hashtext(lockName)` turns a readable string into the integer key
 * `pg_try_advisory_xact_lock` needs, so a caller names locks the same way
 * everything else in this codebase names things — no hand-picked magic
 * number to keep unique by convention alone.
 */
export class PostgresAdvisoryLock implements AdvisoryLock {
  constructor(private readonly prisma: PrismaClient) {}

  async runExclusive<T>(lockName: string, work: () => Promise<T>): Promise<T | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext(${lockName})) AS locked
      `;
      if (rows[0]?.locked !== true) {
        return null;
      }
      return work();
    });
  }
}
