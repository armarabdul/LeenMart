/**
 * A cluster-wide mutual-exclusion primitive (S7-SCHED, SDD §21.2's scheduler
 * platform component). Named locks, not per-table or per-row — the concern
 * this exists for is "only one worker process may run this named piece of
 * work right now", which is a different problem from RLS/tenant isolation
 * and from the outbox relay's own per-row claim.
 *
 * `runExclusive` is the entire contract: acquire the named lock, run `work`
 * while holding it, and guarantee release on every exit path (success,
 * thrown error, or process crash) — a caller never manages acquire/release
 * as two separate steps, which is exactly the shape that leaves a lock held
 * forever if the release step is skipped.
 */
export interface AdvisoryLock {
  /**
   * Attempts to acquire `lockName` and run `work` while holding it.
   *
   * Non-blocking: if another process already holds the same name, this
   * resolves to `null` immediately rather than queuing — the caller is a
   * periodic tick, and a tick that cannot run now will simply run on the
   * next interval instead of piling up behind a slow one.
   *
   * The lock is released before this resolves or rejects, whichever
   * happens — including when `work` throws, so a failed run never leaves
   * the name held.
   */
  runExclusive<T>(lockName: string, work: () => Promise<T>): Promise<T | null>;
}
