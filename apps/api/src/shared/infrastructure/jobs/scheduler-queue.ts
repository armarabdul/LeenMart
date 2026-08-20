import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from '@leen-mart/domain-kit';
import type { ScheduledJobRegistry } from '../../application/ports/scheduled-job.port.js';

/**
 * One queue for every scheduled job (S7-SCHED, SDD §21.2), the same "one
 * queue for the whole concern, BullMQ's own concurrency setting is the
 * throughput knob" shape `product-media-processing`'s own comment states —
 * a future scheduled job registers here rather than getting a queue of its
 * own.
 */
export const SCHEDULER_QUEUE_NAME = 'scheduler';

/**
 * BullMQ's own repeatable-job mechanism (locked scope: "BullMQ
 * repeatable/scheduled job mechanism", not a `setInterval` loop or a
 * standalone script — SDD §21.2 names this explicitly as the platform's
 * scheduler component). `upsertJobScheduler` rather than the older `repeat`
 * option: it is idempotent by scheduler id, so calling this again on every
 * worker restart converges on "one repeatable schedule per job name" rather
 * than accumulating a duplicate each time the process comes up.
 */
export const registerScheduledJobs = async (
  queue: Queue,
  registry: ScheduledJobRegistry,
  logger: Logger,
): Promise<void> => {
  for (const job of registry.all) {
    await queue.upsertJobScheduler(job.name, { every: job.intervalMs }, { name: job.name });
    logger.info({ job: job.name, intervalMs: job.intervalMs }, 'Scheduled job registered');
  }
};

export const createSchedulerQueue = (connection: Redis): Queue =>
  new Queue(SCHEDULER_QUEUE_NAME, { connection });
