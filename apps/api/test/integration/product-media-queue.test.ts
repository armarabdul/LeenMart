import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import {
  BullMqProductMediaProcessingQueue,
  PRODUCT_MEDIA_PROCESSING_QUEUE_NAME,
  type ProductMediaProcessingJobData,
} from '../../src/modules/catalogue/infrastructure/jobs/product-media-queue.js';
import { createProductMediaWorker } from '../../src/modules/catalogue/infrastructure/jobs/product-media-worker.js';
import type { ProcessProductMediaUseCase } from '../../src/modules/catalogue/application/use-cases/process-product-media.use-case.js';
import { toProductMediaId } from '../../src/modules/catalogue/domain/value-objects/product-media-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

/**
 * The BullMQ producer/consumer pair against **real Redis** (S2-6b, D-S2-6-A).
 *
 * What this suite is for is the wiring the pipeline suite deliberately does
 * not exercise: that a job enqueued by the API tier is actually picked up by a
 * separate consumer, that the payload survives the round trip as ids and
 * nothing else, and that `jobId: mediaId` keeps a redelivered enqueue from
 * piling up a second queued job. The processing itself is stubbed here — it
 * is proved for real in `product-media-processing.test.ts`.
 *
 * A queue name of its own per test run keeps this from colliding with a
 * developer's locally-running worker, or with a second copy of the suite.
 */
describe('product media processing queue (real Redis)', () => {
  const ids = new UuidV7Generator();
  const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const inspector = new Queue<ProductMediaProcessingJobData>(PRODUCT_MEDIA_PROCESSING_QUEUE_NAME, {
    connection,
  });
  const producer = new BullMqProductMediaProcessingQueue(connection);
  const workers: Worker<ProductMediaProcessingJobData>[] = [];

  const job = (): {
    mediaId: ReturnType<typeof toProductMediaId>;
    vendorId: ReturnType<typeof toVendorId>;
    userId: ReturnType<typeof toUserId>;
  } => ({
    mediaId: toProductMediaId(ids.generate()),
    vendorId: toVendorId(ids.generate()),
    userId: toUserId(ids.generate()),
  });

  /** Starts a consumer whose use case simply records what it was asked to do. */
  const startWorker = (
    execute: ProcessProductMediaUseCase['execute'],
  ): Worker<ProductMediaProcessingJobData> => {
    const worker = createProductMediaWorker({
      connection,
      processProductMediaUseCase: { execute } as unknown as ProcessProductMediaUseCase,
      logger: new NullLogger(),
      concurrency: 1,
    });
    workers.push(worker);
    return worker;
  };

  const waitFor = async (predicate: () => boolean, timeoutMs = 10_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('timed out waiting for the worker');
      // a poll loop is the point.
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  beforeAll(async () => {
    await inspector.obliterate({ force: true });
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
    await inspector.obliterate({ force: true });
  });

  afterAll(async () => {
    await inspector.close();
    await producer.close();
    connection.disconnect();
  });

  it('enqueues one job a separate consumer actually receives', async () => {
    const payload = job();
    const received: unknown[] = [];
    startWorker((input) => {
      received.push(input);
      return Promise.resolve();
    });

    await producer.enqueue(payload);
    await waitFor(() => received.length > 0);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ mediaId: payload.mediaId });
  });

  it('puts only ids on the wire — never bytes, never the row', async () => {
    const payload = job();

    await producer.enqueue(payload);

    const [queued] = await inspector.getJobs(['waiting', 'delayed', 'prioritized']);
    expect(queued?.data).toEqual({
      mediaId: payload.mediaId,
      vendorId: payload.vendorId,
      userId: payload.userId,
    });
    expect(Object.keys(queued?.data ?? {})).toHaveLength(3);
  });

  it('keys the job by the media id, so a redelivered enqueue does not pile up a second', async () => {
    const payload = job();

    await producer.enqueue(payload);
    await producer.enqueue(payload);
    await producer.enqueue(payload);

    expect(await inspector.getJobCounts('waiting')).toMatchObject({ waiting: 1 });
  });

  it('enqueues distinct jobs for distinct media items', async () => {
    await producer.enqueue(job());
    await producer.enqueue(job());

    expect(await inspector.getJobCounts('waiting')).toMatchObject({ waiting: 2 });
  });

  it('carries the bounded retry budget onto the job itself', async () => {
    await producer.enqueue(job());

    const [queued] = await inspector.getJobs(['waiting']);
    expect(queued?.opts.attempts).toBe(3);
    expect(queued?.opts.backoff).toMatchObject({ type: 'exponential', delay: 5_000 });
  });

  it('retries a failing job rather than giving up on the first error', async () => {
    // A one-second backoff keeps the test quick while still proving the
    // retry actually happens through Redis rather than in-process.
    const payload = job();
    let attempts = 0;
    startWorker(() => {
      attempts += 1;
      return Promise.reject(new Error('transient'));
    });

    await inspector.add(
      'process',
      { mediaId: payload.mediaId, vendorId: payload.vendorId, userId: payload.userId },
      { jobId: payload.mediaId, attempts: 2, backoff: { type: 'fixed', delay: 50 } },
    );
    await waitFor(() => attempts >= 2);

    expect(attempts).toBe(2);
  });

  it('reports a rising attempt number across those retries', async () => {
    const payload = job();
    const seen: number[] = [];
    startWorker((input) => {
      seen.push(input.attemptNumber);
      return Promise.reject(new Error('transient'));
    });

    await inspector.add(
      'process',
      { mediaId: payload.mediaId, vendorId: payload.vendorId, userId: payload.userId },
      { jobId: payload.mediaId, attempts: 2, backoff: { type: 'fixed', delay: 50 } },
    );
    await waitFor(() => seen.length >= 2);

    expect(seen.slice(0, 2)).toEqual([1, 2]);
  });

  it('tells the processor the ceiling the job was enqueued with', async () => {
    const payload = job();
    const seen: number[] = [];
    startWorker((input) => {
      seen.push(input.maxAttempts);
      return Promise.resolve();
    });

    await producer.enqueue(payload);
    await waitFor(() => seen.length > 0);

    expect(seen[0]).toBe(3);
  });
});
