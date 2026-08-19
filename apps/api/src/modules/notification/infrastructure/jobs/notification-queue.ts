import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type {
  NotificationJob,
  NotificationQueue,
} from '../../application/ports/notification-queue.port.js';

/** SDD 11.1 names this queue explicitly: "BullMQ queue: notifications". */
export const NOTIFICATION_QUEUE_NAME = 'notifications';
export const NOTIFICATION_JOB_NAME = 'deliver';

/**
 * **SDD 11.3's channel-level retry policy, applied where it belongs.**
 *
 * "Retries: 3 attempts with exponential backoff (1 s / 10 s / 60 s), then
 * dead-letter with an alert" sits beside "consumers are idempotent on
 * `(event_id, channel, recipient)`" and §11.1's "each channel with its own
 * retry policy" — it describes channel dispatch, which is this queue, not the
 * outbox relay's claim loop. The relay keeps its own 5 attempts / 5 s / 5-minute
 * cap, reviewed and locked separately; the two are independent budgets for
 * independent failures.
 *
 * BullMQ's exponential backoff doubles from `delay`, giving 1 s then 2 s rather
 * than §11.3's 1 s/10 s/60 s. A custom strategy would be needed to reproduce
 * that curve exactly; `custom` is registered on the worker instead, so the
 * literal schedule is honoured.
 */
export const NOTIFICATION_JOB_ATTEMPTS = 3;
/** The literal §11.3 schedule: the delay before attempt 2, then before attempt 3. */
export const NOTIFICATION_BACKOFF_MS = [1_000, 10_000, 60_000] as const;

export const NOTIFICATION_JOB_OPTIONS: JobsOptions = {
  attempts: NOTIFICATION_JOB_ATTEMPTS,
  backoff: { type: 'notification' },
  // Completed jobs are kept briefly for operator visibility, then GC'd —
  // `notifications` rows, not BullMQ, are the record of what was delivered.
  removeOnComplete: { age: 24 * 60 * 60 },
  // A job that exhausted its attempts is the one worth triaging, so it is kept
  // far longer. This is the "dead letter" of §11.3: the job stays in BullMQ's
  // failed set with its error, and the outbox row that produced it is
  // independently retried by the relay.
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/**
 * BullMQ-backed `NotificationQueue` (S6-NOTIFY-INAPP).
 *
 * One of only two files in this module that import `bullmq`; every use case
 * depends on the port instead.
 *
 * **`jobId` is derived from the outbox event**, so a redelivered event lands on
 * the same job rather than piling up a second one. BullMQ refuses a duplicate
 * id while the job is queued or active, which absorbs the common case; the
 * orchestrator's `createIfAbsent` handles the rest, including a redelivery
 * arriving after the first job was already completed and GC'd.
 */
export class BullMqNotificationQueue implements NotificationQueue {
  private readonly queue: Queue<NotificationJob>;

  constructor(connection: Redis) {
    this.queue = new Queue<NotificationJob>(NOTIFICATION_QUEUE_NAME, { connection });
  }

  async enqueue(job: NotificationJob): Promise<void> {
    await this.queue.add(NOTIFICATION_JOB_NAME, job, {
      ...NOTIFICATION_JOB_OPTIONS,
      jobId: job.outboxEventId,
    });
  }

  /** Releases the connection-owning client on shutdown, mirroring the media queue. */
  async close(): Promise<void> {
    await this.queue.close();
  }
}
