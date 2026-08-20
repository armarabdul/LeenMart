import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from '@leen-mart/domain-kit';
import type { AdvisoryLock } from '../../application/ports/advisory-lock.port.js';
import type { ScheduledJobRegistry } from '../../application/ports/scheduled-job.port.js';
import { SCHEDULER_QUEUE_NAME } from './scheduler-queue.js';

export interface SchedulerWorkerDeps {
  /** The BullMQ-dedicated connection — never `container.redis`, matching every other worker in this process. */
  readonly connection: Redis;
  readonly registry: ScheduledJobRegistry;
  readonly lock: AdvisoryLock;
  readonly logger: Logger;
  readonly concurrency?: number;
}

/** BullMQ's own tick still fires on every worker replica; only one may ever run a given job's body at a time, so more than one in flight here would just mean more processes losing the lock race, never useful parallelism. */
export const SCHEDULER_WORKER_CONCURRENCY = 1;

/**
 * Processes one BullMQ tick by finding the matching `ScheduledJob` and
 * running it under the advisory lock (S7-SCHED). Exported so a test can
 * drive it with a hand-built job rather than standing up Redis — the same
 * shape `processNotificationJob` already uses.
 *
 * **Losing the lock race is success, not failure.** `runExclusive` returning
 * `null` means another worker process is already running this tick's job;
 * this process has nothing to do and says so, rather than treating "someone
 * else is already handling it" as an error BullMQ should retry.
 */
export const processSchedulerJob = async (
  job: Job,
  deps: Pick<SchedulerWorkerDeps, 'registry' | 'lock' | 'logger'>,
): Promise<void> => {
  const scheduledJob = deps.registry.jobFor(job.name);
  if (!scheduledJob) {
    // A job whose schedule was created by a since-removed registry entry —
    // not an error, just nothing left to do (mirrors the outbox relay's own
    // "no handler = processed, not failed").
    deps.logger.warn({ job: job.name }, 'Scheduler tick has no matching registered job');
    return;
  }

  const ran = await deps.lock.runExclusive(scheduledJob.name, () => scheduledJob.run());
  if (ran === null) {
    deps.logger.info({ job: scheduledJob.name }, 'Scheduler tick skipped — lock held elsewhere');
  }
};

/** The scheduler platform's own worker runtime (S7-SCHED, SDD §21.2). */
export const createSchedulerWorker = (deps: SchedulerWorkerDeps): Worker => {
  const worker = new Worker(SCHEDULER_QUEUE_NAME, (job) => processSchedulerJob(job, deps), {
    connection: deps.connection,
    concurrency: deps.concurrency ?? SCHEDULER_WORKER_CONCURRENCY,
  });

  worker.on('failed', (job, error) => {
    deps.logger.warn(
      { job: job?.name, attemptsMade: job?.attemptsMade, err: error },
      'Scheduled job failed',
    );
  });

  return worker;
};
