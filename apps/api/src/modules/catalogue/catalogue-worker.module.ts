import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { Env } from '../../shared/config/env.js';
import { ProcessProductMediaUseCase } from './application/use-cases/process-product-media.use-case.js';
import {
  createProductMediaWorker,
  type ProductMediaWorkerDeps,
} from './infrastructure/jobs/product-media-worker.js';
import { SharpImageProcessor } from './infrastructure/media-processing/sharp-image-processor.js';
import { PrismaProductMediaRepository } from './infrastructure/persistence/prisma-product-media.repository.js';
import { PrismaProductMediaVariantRepository } from './infrastructure/persistence/prisma-product-media-variant.repository.js';
import { buildProductMediaObjectStore } from './infrastructure/storage/product-media-object-store.js';

export interface CatalogueMediaWorkerDeps {
  /**
   * The **tenant-scoped** client (`withTenantBoundary`), exactly the one the
   * HTTP tier uses — never `adminPrisma` (S2-6b). `ProductMedia` and
   * `ProductMediaVariant` are both in `TENANT_SCOPED_MODELS`, so every query
   * the worker issues is refused outright unless
   * `product-media-worker.ts`'s `runWithTenant` scope is in force, and RLS
   * enforces the same boundary again beneath it. Handing this a background
   * job rather than a request changes nothing about either layer.
   */
  readonly prisma: PrismaClient;
  /** The BullMQ-dedicated connection — see `createBullMqRedisClient`. */
  readonly bullRedis: Redis;
  readonly env: Env;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Overridden only by tests that want deterministic, single-job processing. */
  readonly concurrency?: number;
}

/**
 * The worker process's composition root (S2-6b) — the counterpart to
 * `createCatalogueModule`, which composes the same module for HTTP.
 *
 * A second root rather than a branch inside the first: the two processes
 * genuinely need different things. The API tier needs routers, controllers
 * and a queue *producer*; the worker needs a queue *consumer*, Sharp, and no
 * Express at all. Building both in one function would mean every API task
 * constructing a BullMQ `Worker` it never runs — which would silently make
 * every API replica a competing consumer, exactly the accident this split
 * makes impossible.
 *
 * Deliberately composes no transaction runner. `ProcessProductMediaUseCase`
 * writes through a sequence of independently-committed conditional
 * operations rather than one long transaction spanning network reads, CPU
 * work and 8 uploads — see its own class comment for why.
 */
export const createCatalogueMediaWorker = (
  deps: CatalogueMediaWorkerDeps,
): ReturnType<typeof createProductMediaWorker> => {
  const { prisma, bullRedis, env, idGenerator, clock, logger, concurrency } = deps;
  const moduleLogger = logger.child({ module: 'catalogue', worker: 'product-media' });

  const workerDeps: ProductMediaWorkerDeps = {
    connection: bullRedis,
    processProductMediaUseCase: new ProcessProductMediaUseCase({
      productMediaRepository: new PrismaProductMediaRepository(prisma),
      productMediaVariantRepository: new PrismaProductMediaVariantRepository(prisma),
      objectStore: buildProductMediaObjectStore(env),
      imageProcessor: new SharpImageProcessor(),
      idGenerator,
      clock,
      logger: moduleLogger,
    }),
    logger: moduleLogger,
    ...(concurrency === undefined ? {} : { concurrency }),
  };

  return createProductMediaWorker(workerDeps);
};
