import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from '@leen-mart/domain-kit';
import type { DeliverNotificationUseCase } from '../../application/use-cases/deliver-notification.use-case.js';
import type { NotificationJob } from '../../application/ports/notification-queue.port.js';
import { NOTIFICATION_BACKOFF_MS, NOTIFICATION_QUEUE_NAME } from './notification-queue.js';

/**
 * How many notification jobs one worker handles at once.
 *
 * Higher than the media worker's 2 because the work is different in kind: a
 * job here is a short recipient lookup and one or two inserts, all I/O-bound on
 * PostgreSQL, where the media worker is CPU-bound in libvips. Still modest —
 * every job holds a connection from the checkout pool, and starving checkout to
 * deliver notifications faster would be the wrong trade (SC-11).
 */
export const NOTIFICATION_WORKER_CONCURRENCY = 5;

export interface NotificationWorkerDeps {
  /** The BullMQ-dedicated connection — never `container.redis`. */
  readonly connection: Redis;
  readonly deliverNotificationUseCase: DeliverNotificationUseCase;
  readonly logger: Logger;
  readonly concurrency?: number;
}

/** Narrows the untrusted job payload before the use case sees it. */
export const parseNotificationJob = (data: NotificationJob): NotificationJob => {
  if (typeof data.outboxEventId !== 'string' || typeof data.eventType !== 'string') {
    throw new Error('Malformed notification job: outboxEventId and eventType are required');
  }
  return {
    outboxEventId: data.outboxEventId,
    eventType: data.eventType,
    payload: typeof data.payload === 'object' && data.payload !== null ? data.payload : {},
  };
};

/**
 * The processor body, exported so a test can drive it with a hand-built job
 * rather than standing up Redis.
 */
export const processNotificationJob = async (
  job: Job<NotificationJob>,
  deps: Pick<NotificationWorkerDeps, 'deliverNotificationUseCase'>,
): Promise<void> => {
  const parsed = parseNotificationJob(job.data);
  await deps.deliverNotificationUseCase.execute(parsed);
};

/**
 * The `NotificationOrchestrator` runtime (S6-NOTIFY-INAPP, SDD 11.1).
 *
 * Unlike the media worker this establishes **no tenant context**: the
 * orchestrator resolves recipients across vendors and writes rows for users it
 * is not acting as, so it runs on `leenmart_checkout` — the credential that
 * already has cross-vendor reach — rather than impersonating anybody. Nothing
 * here widens `leenmart_app`'s vendor scope.
 *
 * The backoff strategy reproduces SDD 11.3's literal schedule (1 s / 10 s /
 * 60 s), which BullMQ's built-in exponential curve does not: it doubles from
 * the base, giving 1 s then 2 s. A named custom strategy is the supported way
 * to say what the document actually says.
 */
export const createNotificationWorker = (deps: NotificationWorkerDeps): Worker<NotificationJob> => {
  const worker = new Worker<NotificationJob>(
    NOTIFICATION_QUEUE_NAME,
    (job) => processNotificationJob(job, deps),
    {
      connection: deps.connection,
      concurrency: deps.concurrency ?? NOTIFICATION_WORKER_CONCURRENCY,
      settings: {
        backoffStrategy: (attemptsMade: number): number =>
          NOTIFICATION_BACKOFF_MS[Math.min(attemptsMade, NOTIFICATION_BACKOFF_MS.length) - 1] ??
          NOTIFICATION_BACKOFF_MS[0],
      },
    },
  );

  worker.on('failed', (job, error) => {
    deps.logger.warn(
      {
        jobId: job?.id,
        outboxEventId: job?.data.outboxEventId,
        attemptsMade: job?.attemptsMade,
        err: error,
      },
      'Notification job failed',
    );
  });

  return worker;
};
