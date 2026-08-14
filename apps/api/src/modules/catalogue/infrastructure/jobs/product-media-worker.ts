import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from '@leen-mart/domain-kit';
import { runWithTenant } from '../../../../shared/infrastructure/persistence/tenant-context.js';
import type { ProcessProductMediaUseCase } from '../../application/use-cases/process-product-media.use-case.js';
import {
  PRODUCT_MEDIA_PROCESSING_JOB_OPTIONS,
  PRODUCT_MEDIA_PROCESSING_QUEUE_NAME,
  parseProductMediaProcessingJobData,
  type ProductMediaProcessingJobData,
} from './product-media-queue.js';

/**
 * How many media items one worker process handles at once. Small on purpose:
 * each job decodes an image and re-encodes it eight times through libvips,
 * which is CPU-bound and already multi-threaded internally, so a high number
 * here buys contention rather than throughput. Horizontal scaling is more
 * worker processes, not a bigger number.
 */
export const PRODUCT_MEDIA_WORKER_CONCURRENCY = 2;

/**
 * The ceiling to assume for a job that carries none of its own — one enqueued
 * outside `BullMqProductMediaProcessingQueue`, or by an older producer. Not a
 * second policy: it reads the queue's own configured value, and exists only
 * because `JobsOptions.attempts` is optional in BullMQ's type.
 */
const DEFAULT_MAX_ATTEMPTS = PRODUCT_MEDIA_PROCESSING_JOB_OPTIONS.attempts ?? 1;

export interface ProductMediaWorkerDeps {
  /** The BullMQ-dedicated connection — never `container.redis`; see `createBullMqRedisClient`. */
  readonly connection: Redis;
  readonly processProductMediaUseCase: ProcessProductMediaUseCase;
  readonly logger: Logger;
  readonly concurrency?: number;
}

/**
 * The processor body, exported so a test can drive it with a hand-built job
 * rather than standing up Redis to assert on the tenant-context wiring.
 *
 * **This is the whole of S2-6b's answer to "how does a background job get a
 * tenant context".** `runWithTenant` is the same sanctioned mechanism the
 * `tenantContext` HTTP middleware uses — an `AsyncLocalStorage` scope that
 * `withTenantBoundary` reads to set `app.user_id`/`app.vendor_id` on the
 * connection every query runs on. The worker has no request, so it
 * establishes the scope itself, from the job payload; it does **not** reach
 * for `adminPrisma`, and nothing here weakens RLS.
 *
 * The payload's `vendorId` is therefore a *claim*, not an authorisation, and
 * it is deliberately incapable of crossing tenants: it becomes
 * `app.vendor_id`, and `product_media`'s own SELECT policy compares that
 * against the row's stored `vendor_id`. A job naming vendor B for a media
 * item owned by vendor A makes the row invisible — `findById` returns
 * `null`, `ProcessProductMediaUseCase` logs "no such row" and stops. The
 * *only* ownership fact the pipeline ever acts on is the one PostgreSQL
 * agreed to hand back, never the one the payload asserted. (`userId` is
 * carried for the same reason `app.user_id` exists at all — the audit and
 * user-rooted policies read it — not as an authority: no policy on
 * `product_media` or `product_media_variants` consults it.)
 */
export const processProductMediaJob = async (
  job: Job<ProductMediaProcessingJobData>,
  deps: Pick<ProductMediaWorkerDeps, 'processProductMediaUseCase'>,
): Promise<void> => {
  const { mediaId, vendorId, userId } = parseProductMediaProcessingJobData(job.data);

  await runWithTenant({ userId, vendorId }, () =>
    deps.processProductMediaUseCase.execute({
      mediaId,
      // `attemptsStarted`, not `attemptsMade` — see `ProcessProductMediaInput`.
      attemptNumber: job.attemptsStarted,
      maxAttempts: job.opts.attempts ?? DEFAULT_MAX_ATTEMPTS,
    }),
  );
};

/**
 * The BullMQ consumer for `product-media-processing` (S2-6b, D-S2-6-A).
 *
 * Runs in its own process (`src/worker.ts`), never inside the API: SDD 12.2's
 * pipeline is seconds of CPU-bound work per upload, and doing it on the
 * request thread would be exactly the synchronous processing this milestone
 * exists to avoid. This function only constructs the worker — starting,
 * draining and shutting down are the entry point's job.
 *
 * Errors are rethrown by `ProcessProductMediaUseCase` for anything transient,
 * which is what lets BullMQ apply its own bounded retry/backoff policy; a
 * classified permanent failure is written as `FAILED` and *not* rethrown, so
 * it never spends that budget.
 */
export const createProductMediaWorker = (
  deps: ProductMediaWorkerDeps,
): Worker<ProductMediaProcessingJobData> => {
  const { connection, logger, concurrency = PRODUCT_MEDIA_WORKER_CONCURRENCY } = deps;

  const worker = new Worker<ProductMediaProcessingJobData>(
    PRODUCT_MEDIA_PROCESSING_QUEUE_NAME,
    (job) => processProductMediaJob(job, deps),
    { connection, concurrency },
  );

  worker.on('failed', (job, error) => {
    logger.error(
      { jobId: job?.id, attemptsStarted: job?.attemptsStarted, err: error },
      'Product media processing job failed',
    );
  });

  worker.on('error', (error) => {
    // A worker-level (not job-level) fault: a lost Redis connection, a
    // malformed job in the queue. Logged, never fatal — BullMQ reconnects.
    logger.error({ err: error }, 'Product media processing worker error');
  });

  return worker;
};
