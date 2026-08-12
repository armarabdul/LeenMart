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
import { withTenantBoundary } from './shared/infrastructure/persistence/tenant-prisma.js';
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
  /**
   * The vendor-facing runtime client (`leenmart_app`).
   *
   * Named `prisma` because it is what almost everything should use, and
   * because renaming it would have touched every repository construction site
   * in a chunk about roles. Falls back to the owner connection until the
   * runtime roles are provisioned; production refuses that fallback.
   */
  readonly prisma: PrismaClient;
  /**
   * The admin/reviewer runtime client (`leenmart_admin`), on a separate
   * credential. Nothing is wired to it yet — the elevated read paths that will
   * use it arrive with KYC-2B-3's policies, and until those exist this client
   * differs from `prisma` only in which role it authenticates as. It is
   * constructed now so the connection is proven, not assumed.
   */
  readonly adminPrisma: PrismaClient;
  readonly redis: Redis;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  dispose(): Promise<void>;
}

export const createContainer = (): Container => {
  const env = loadEnv();
  const rootLogger = createRootLogger(env);
  const logger = new PinoLoggerAdapter(rootLogger);
  // The tenant boundary wraps the vendor-facing client only. `adminPrisma`
  // stays unwrapped and on its own credential (KYC-2B-1): elevated access is a
  // different role, never the same client pretending.
  const prisma = withTenantBoundary(createPrismaClient(env, rootLogger, 'app'));
  const adminPrisma = createPrismaClient(env, rootLogger, 'admin');
  const redis = createRedisClient(env, rootLogger);
  const clock = new SystemClock();
  const idGenerator = new UuidV7Generator();

  const dispose = async (): Promise<void> => {
    // Ordered deliberately: stop accepting work, then release connections.
    await Promise.all([prisma.$disconnect(), adminPrisma.$disconnect()]);
    redis.disconnect();
  };

  return { env, rootLogger, logger, prisma, adminPrisma, redis, clock, idGenerator, dispose };
};
