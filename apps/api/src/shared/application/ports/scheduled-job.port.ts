/**
 * One periodic tick of background work (S7-SCHED, SDD §21.2's scheduler
 * platform component). Mirrors `OutboxHandler`'s own shape deliberately —
 * a name the platform matches on, a `run` the platform calls, and an
 * idempotence obligation on the implementation rather than the platform:
 * `OutboxHandler`'s doc comment states "handlers must be idempotent"
 * because delivery is at-least-once; a `ScheduledJob` states the same thing
 * because a missed tick's catch-up window (see the pickup-reminder job's
 * own doc comment) and a process restart both mean "this tick's work" can
 * legitimately run more than once.
 */
export interface ScheduledJob {
  /** The BullMQ job/scheduler name, and the advisory-lock name this job runs under — one identifier for both, so there is only one place a new job is registered. */
  readonly name: string;
  /** How often the platform schedules this job. */
  readonly intervalMs: number;
  /** One tick's work. Never called concurrently with itself by the platform (`AdvisoryLock` guarantees that across every worker process) — but still must be safe to run twice in a row, since a missed tick's catch-up window means it sometimes will be. */
  run(): Promise<void>;
}

/**
 * Every scheduled job the platform knows about, resolved once at composition
 * time — the same "registry of named things, built once" shape
 * `OutboxHandlerRegistry` already establishes for outbox handlers.
 */
export interface ScheduledJobRegistry {
  /** All registered jobs, in registration order — for registering each one's repeatable schedule at startup. */
  readonly all: readonly ScheduledJob[];
  /** The job matching this BullMQ job name, or `undefined` if none is registered (a job removed from the registry after its schedule was already created in Redis, for instance). */
  jobFor(name: string): ScheduledJob | undefined;
}

export const createScheduledJobRegistry = (
  jobs: readonly ScheduledJob[],
): ScheduledJobRegistry => ({
  all: jobs,
  jobFor: (name) => jobs.find((job) => job.name === name),
});
