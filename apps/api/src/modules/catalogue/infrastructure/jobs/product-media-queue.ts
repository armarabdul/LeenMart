import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { toUserId, toVendorId } from '../../../identity/index.js';
import type {
  ProductMediaProcessingJob,
  ProductMediaProcessingQueue,
} from '../../application/ports/product-media-processing-queue.port.js';
import { toProductMediaId } from '../../domain/value-objects/product-media-id.value-object.js';

/** One queue for the whole processing pipeline (S2-6b, D-S2-6-A) — no per-vendor or per-product queues; BullMQ's own concurrency setting on the worker is the throughput knob. */
export const PRODUCT_MEDIA_PROCESSING_QUEUE_NAME = 'product-media-processing';
export const PRODUCT_MEDIA_PROCESSING_JOB_NAME = 'process';

/** The wire shape a job payload actually carries over Redis — plain strings, never the branded domain types or image bytes. */
export interface ProductMediaProcessingJobData {
  readonly mediaId: string;
  readonly vendorId: string;
  readonly userId: string;
}

/**
 * Conservative and bounded (S2-6b): no existing project convention for
 * job retry settings to inherit, so this picks a small, fixed ceiling rather
 * than retrying forever. Three attempts total, exponential backoff starting
 * at 5s (5s, 10s, 20s between attempts) — enough to ride out a brief object-
 * store or database blip without leaving a vendor's upload stuck for long,
 * while `ProcessProductMediaUseCase` still marks permanent failures (a
 * spoofed content type, an undecodable image) FAILED immediately, on the
 * first attempt, without spending any of this budget.
 */
export const PRODUCT_MEDIA_PROCESSING_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  // Completed jobs are kept briefly for operator visibility, then GC'd —
  // BullMQ, not this table, is the place to look at "did this run and when."
  removeOnComplete: { age: 24 * 60 * 60 },
  // Failed jobs (all attempts exhausted) are kept longer: they are the ones
  // worth triaging.
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/**
 * BullMQ-backed `ProductMediaProcessingQueue` (S2-6b, D-S2-6-A). The only
 * file besides `product-media-worker.ts` that imports `bullmq` — every use
 * case depends on the port, never this class.
 *
 * `jobId: mediaId`: at most one queued/active job per media item at a time
 * is the intent, so a redelivered `enqueue` call for the same id lands on
 * the same job rather than piling up a second one. This is a queue-level
 * convenience, not the correctness guarantee — `ProcessProductMediaUseCase`'s
 * conditional database writes are what actually make double delivery safe
 * even if BullMQ's own dedup did nothing.
 */
export class BullMqProductMediaProcessingQueue implements ProductMediaProcessingQueue {
  private readonly queue: Queue<ProductMediaProcessingJobData>;

  constructor(connection: Redis) {
    this.queue = new Queue<ProductMediaProcessingJobData>(PRODUCT_MEDIA_PROCESSING_QUEUE_NAME, {
      connection,
    });
  }

  async enqueue(job: ProductMediaProcessingJob): Promise<void> {
    await this.queue.add(
      PRODUCT_MEDIA_PROCESSING_JOB_NAME,
      { mediaId: job.mediaId, vendorId: job.vendorId, userId: job.userId },
      { jobId: job.mediaId, ...PRODUCT_MEDIA_PROCESSING_JOB_OPTIONS },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

/**
 * Parses a job's wire-shape data back into the branded domain ids the worker
 * expects — and, because each `to…Id` refuses anything that is not a UUID,
 * rejects a malformed payload here rather than passing it into a query.
 *
 * This is a **shape** check only, never an authorisation one: a well-formed
 * but wrong `vendorId` is caught one layer down, where the tenant context it
 * establishes simply makes the media row invisible to RLS and the job
 * becomes a no-op. See `product-media-worker.ts`.
 */
export const parseProductMediaProcessingJobData = (
  data: ProductMediaProcessingJobData,
): ProductMediaProcessingJob => ({
  mediaId: toProductMediaId(data.mediaId),
  vendorId: toVendorId(data.vendorId),
  userId: toUserId(data.userId),
});
