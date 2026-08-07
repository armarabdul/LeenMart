import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Logger as PinoLogger } from 'pino';
import {
  type Clock,
  type IdGenerator,
  type Logger,
  SystemClock,
  UuidV7Generator,
} from '@leen-mart/domain-kit';
import { type Env, loadEnv } from './shared/config/env.js';
import {
  createRootLogger,
  PinoLoggerAdapter,
} from './shared/infrastructure/observability/logger.js';
import { createPrismaClient } from './shared/infrastructure/persistence/prisma.js';
import { createRedisClient } from './shared/infrastructure/cache/redis.js';

/**
 * Composition root (SDD 2.3).
 *
 * This is the only place in the codebase that knows which concrete adapter
 * satisfies which port. Everything else receives its dependencies through a
 * constructor, which is what makes the inner layers testable without any I/O.
 *
 * Hand-rolled rather than a DI framework: at this size, explicit wiring is
 * easier to follow than decorator metadata, and it keeps the domain free of
 * framework annotations.
 */
export interface Container {
  readonly env: Env;
  readonly rootLogger: PinoLogger;
  readonly logger: Logger;
  readonly prisma: PrismaClient;
  readonly redis: Redis;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  dispose(): Promise<void>;
}

export const createContainer = (): Container => {
  const env = loadEnv();
  const rootLogger = createRootLogger(env);
  const logger = new PinoLoggerAdapter(rootLogger);
  const prisma = createPrismaClient(env, rootLogger);
  const redis = createRedisClient(env, rootLogger);
  const clock = new SystemClock();
  const idGenerator = new UuidV7Generator();

  const dispose = async (): Promise<void> => {
    // Ordered deliberately: stop accepting work, then release connections.
    await prisma.$disconnect();
    redis.disconnect();
  };

  return { env, rootLogger, logger, prisma, redis, clock, idGenerator, dispose };
};
