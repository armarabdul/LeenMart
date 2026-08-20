import { describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import { NullLogger } from '@leen-mart/domain-kit';
import { processSchedulerJob } from '../../../src/shared/infrastructure/jobs/scheduler-worker.js';
import { createScheduledJobRegistry } from '../../../src/shared/application/ports/scheduled-job.port.js';
import type { AdvisoryLock } from '../../../src/shared/application/ports/advisory-lock.port.js';
import type { ScheduledJob } from '../../../src/shared/application/ports/scheduled-job.port.js';

const jobNamed = (name: string): Job => ({ name }) as Job;

const fakeJob = (name: string, run = vi.fn().mockResolvedValue(undefined)): ScheduledJob => ({
  name,
  intervalMs: 5 * 60 * 1000,
  run,
});

describe('processSchedulerJob (S7-SCHED)', () => {
  it('looks up the job by BullMQ job name and runs it under the advisory lock, keyed by that same name', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const registry = createScheduledJobRegistry([fakeJob('pickup-reminder', run)]);
    const runExclusive = vi
      .fn()
      .mockImplementation(async (_name: string, work: () => Promise<unknown>) => work());
    const lock: AdvisoryLock = { runExclusive };

    await processSchedulerJob(jobNamed('pickup-reminder'), {
      registry,
      lock,
      logger: new NullLogger(),
    });

    expect(runExclusive).toHaveBeenCalledTimes(1);
    expect(runExclusive.mock.calls[0]?.[0]).toBe('pickup-reminder');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a tick with no matching registered job is a no-op, not an error', async () => {
    const registry = createScheduledJobRegistry([]);
    const runExclusive = vi.fn();
    const lock: AdvisoryLock = { runExclusive };

    await expect(
      processSchedulerJob(jobNamed('some-removed-job'), {
        registry,
        lock,
        logger: new NullLogger(),
      }),
    ).resolves.toBeUndefined();

    expect(runExclusive).not.toHaveBeenCalled();
  });

  it('losing the lock race (runExclusive resolves null) is not treated as a failure', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const registry = createScheduledJobRegistry([fakeJob('pickup-reminder', run)]);
    const lock: AdvisoryLock = { runExclusive: vi.fn().mockResolvedValue(null) };

    await expect(
      processSchedulerJob(jobNamed('pickup-reminder'), {
        registry,
        lock,
        logger: new NullLogger(),
      }),
    ).resolves.toBeUndefined();

    // The lock's own callback is what would have called `run` — since
    // `runExclusive` here is a bare mock returning `null`, `run` never gets
    // invoked, matching production where a lost lock race means the other
    // process's callback runs instead of this one's.
    expect(run).not.toHaveBeenCalled();
  });

  it('a job whose own run() rejects propagates the rejection rather than being swallowed', async () => {
    const run = vi.fn().mockRejectedValue(new Error('sweep failed'));
    const registry = createScheduledJobRegistry([fakeJob('pickup-reminder', run)]);
    const runExclusive = vi
      .fn()
      .mockImplementation(async (_name: string, work: () => Promise<unknown>) => work());
    const lock: AdvisoryLock = { runExclusive };

    await expect(
      processSchedulerJob(jobNamed('pickup-reminder'), {
        registry,
        lock,
        logger: new NullLogger(),
      }),
    ).rejects.toThrow('sweep failed');
  });

  it('two different registered jobs are each run under their own lock name', async () => {
    const pickupRun = vi.fn().mockResolvedValue(undefined);
    const otherRun = vi.fn().mockResolvedValue(undefined);
    const registry = createScheduledJobRegistry([
      fakeJob('pickup-reminder', pickupRun),
      fakeJob('other-job', otherRun),
    ]);
    const runExclusive = vi
      .fn()
      .mockImplementation(async (_name: string, work: () => Promise<unknown>) => work());
    const lock: AdvisoryLock = { runExclusive };

    await processSchedulerJob(jobNamed('other-job'), { registry, lock, logger: new NullLogger() });

    expect(runExclusive.mock.calls[0]?.[0]).toBe('other-job');
    expect(otherRun).toHaveBeenCalledTimes(1);
    expect(pickupRun).not.toHaveBeenCalled();
  });
});
