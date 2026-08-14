import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { getTenantContext } from '../../../../../src/shared/infrastructure/persistence/tenant-context.js';
import { processProductMediaJob } from '../../../../../src/modules/catalogue/infrastructure/jobs/product-media-worker.js';
import {
  PRODUCT_MEDIA_PROCESSING_JOB_OPTIONS,
  parseProductMediaProcessingJobData,
  type ProductMediaProcessingJobData,
} from '../../../../../src/modules/catalogue/infrastructure/jobs/product-media-queue.js';
import type { ProcessProductMediaUseCase } from '../../../../../src/modules/catalogue/application/use-cases/process-product-media.use-case.js';

const ids = new UuidV7Generator();
const mediaId = ids.generate();
const vendorId = ids.generate();
const userId = ids.generate();

const job = (
  overrides: {
    data?: Partial<ProductMediaProcessingJobData>;
    attemptsStarted?: number;
    attempts?: number;
  } = {},
): Job<ProductMediaProcessingJobData> =>
  ({
    data: { mediaId, vendorId, userId, ...overrides.data },
    attemptsStarted: overrides.attemptsStarted ?? 1,
    opts: { attempts: overrides.attempts },
  }) as unknown as Job<ProductMediaProcessingJobData>;

const useCase = (
  execute: ProcessProductMediaUseCase['execute'] = vi.fn().mockResolvedValue(undefined),
): ProcessProductMediaUseCase => ({ execute }) as unknown as ProcessProductMediaUseCase;

describe('processProductMediaJob', () => {
  it('runs the use case inside a tenant context built from the payload', async () => {
    let seen: ReturnType<typeof getTenantContext>;
    const processProductMediaUseCase = useCase(
      vi.fn().mockImplementation(() => {
        seen = getTenantContext();
        return Promise.resolve();
      }),
    );

    await processProductMediaJob(job(), { processProductMediaUseCase });

    expect(seen).toMatchObject({ kind: 'authenticated', userId, vendorId });
  });

  it('leaves no tenant context behind once the job finishes', async () => {
    await processProductMediaJob(job(), { processProductMediaUseCase: useCase() });

    expect(getTenantContext()).toBeUndefined();
  });

  it('never establishes a system context — a worker acting for a vendor is not the platform', async () => {
    let seen: ReturnType<typeof getTenantContext>;
    const processProductMediaUseCase = useCase(
      vi.fn().mockImplementation(() => {
        seen = getTenantContext();
        return Promise.resolve();
      }),
    );

    await processProductMediaJob(job(), { processProductMediaUseCase });

    expect(seen?.kind).not.toBe('system');
  });

  it('passes the media id, never the whole payload', async () => {
    const processProductMediaUseCase = useCase();

    await processProductMediaJob(job(), { processProductMediaUseCase });

    expect(processProductMediaUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ mediaId }),
    );
    const passed = vi.mocked(processProductMediaUseCase.execute).mock.calls[0]?.[0];
    expect(passed).not.toHaveProperty('vendorId');
    expect(passed).not.toHaveProperty('userId');
  });

  it('reports the attempt as 1-based, from attemptsStarted', async () => {
    const processProductMediaUseCase = useCase();

    await processProductMediaJob(job({ attemptsStarted: 3 }), { processProductMediaUseCase });

    expect(processProductMediaUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ attemptNumber: 3 }),
    );
  });

  it('takes the ceiling from the job’s own options when it has one', async () => {
    const processProductMediaUseCase = useCase();

    await processProductMediaJob(job({ attempts: 7 }), { processProductMediaUseCase });

    expect(processProductMediaUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttempts: 7 }),
    );
  });

  it('falls back to the queue’s configured ceiling for a job enqueued without one', async () => {
    const processProductMediaUseCase = useCase();

    // `job()` builds `opts` with no `attempts` at all — a job enqueued
    // outside `BullMqProductMediaProcessingQueue`, or by an older producer.
    await processProductMediaJob(job(), { processProductMediaUseCase });

    expect(processProductMediaUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttempts: PRODUCT_MEDIA_PROCESSING_JOB_OPTIONS.attempts }),
    );
  });

  it('rethrows so BullMQ applies its retry policy', async () => {
    const processProductMediaUseCase = useCase(vi.fn().mockRejectedValue(new Error('transient')));

    await expect(processProductMediaJob(job(), { processProductMediaUseCase })).rejects.toThrow(
      /transient/,
    );
  });

  it('refuses a payload whose ids are not uuids, before any query is issued', async () => {
    const processProductMediaUseCase = useCase();

    await expect(
      processProductMediaJob(job({ data: { mediaId: 'not-a-uuid' } }), {
        processProductMediaUseCase,
      }),
    ).rejects.toThrow();
    expect(processProductMediaUseCase.execute).not.toHaveBeenCalled();
  });
});

describe('the queue’s job options', () => {
  it('bounds retries rather than retrying forever', () => {
    expect(PRODUCT_MEDIA_PROCESSING_JOB_OPTIONS.attempts).toBe(3);
  });

  it('backs off exponentially rather than hammering a struggling dependency', () => {
    expect(PRODUCT_MEDIA_PROCESSING_JOB_OPTIONS.backoff).toEqual({
      type: 'exponential',
      delay: 5_000,
    });
  });

  it('keeps failed jobs longer than completed ones — those are the ones worth triaging', () => {
    const completed = PRODUCT_MEDIA_PROCESSING_JOB_OPTIONS.removeOnComplete as { age: number };
    const failed = PRODUCT_MEDIA_PROCESSING_JOB_OPTIONS.removeOnFail as { age: number };

    expect(failed.age).toBeGreaterThan(completed.age);
  });
});

describe('parseProductMediaProcessingJobData', () => {
  it('brands each id', () => {
    expect(parseProductMediaProcessingJobData({ mediaId, vendorId, userId })).toEqual({
      mediaId,
      vendorId,
      userId,
    });
  });

  it.each(['mediaId', 'vendorId', 'userId'] as const)('refuses a malformed %s', (field) => {
    expect(() =>
      parseProductMediaProcessingJobData({ mediaId, vendorId, userId, [field]: 'nope' }),
    ).toThrow();
  });
});
