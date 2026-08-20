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
import {
  createBullMqRedisClient,
  createPubSubRedisClient,
  createRedisClient,
} from './shared/infrastructure/cache/redis.js';

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
  /**
   * The unauthenticated public search/read client (`leenmart_public`, S2-7),
   * on its own credential. Unwrapped by `withTenantBoundary`, the same as
   * `adminPrisma` — `Product`/`ProductMedia` are tenant-scoped models, but
   * this client never carries a tenant context at all; RLS restricts what it
   * can see to `APPROVED`/`READY`, non-deleted rows structurally, regardless
   * of the query, which is what makes wrapping it in the app-level
   * tenant-context check unnecessary rather than merely skipped.
   */
  readonly publicPrisma: PrismaClient;
  /**
   * The checkout client (`leenmart_checkout`, S3-3A), on its own credential.
   * Unwrapped by `withTenantBoundary`, same reasoning as `adminPrisma`/
   * `publicPrisma`: this role's RLS policies (`vendors_checkout_read`,
   * `inventory_checkout_decrement`) are both `USING (true)` — static, no
   * session GUC to set — because a checkout transaction must reach rows
   * belonging to more than one vendor, which is exactly what the
   * tenant-context mechanism exists to prevent for `leenmart_app`.
   */
  readonly checkoutPrisma: PrismaClient;
  readonly redis: Redis;
  /**
   * A second connection, dedicated to BullMQ (S2-6b) — see
   * `createBullMqRedisClient`'s own comment for why this cannot be `redis`
   * above. Both `app.ts` (enqueueing) and `worker.ts` (processing) need one;
   * built once here so neither reimplements the connection settings.
   */
  readonly bullRedis: Redis;
  /**
   * A third connection, dedicated to the vendor-stream pub/sub subscriber
   * (S4-SSE) — see `createPubSubRedisClient`'s own comment for why this
   * cannot be `redis` or `bullRedis`. Only the API process subscribes on it;
   * the worker process constructs it but never calls `.subscribe()`.
   */
  readonly pubSubRedis: Redis;
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
  // Same reasoning as adminPrisma: leenmart_public's RLS policies are static
  // (no session GUCs), so there is no tenant context to wrap.
  const publicPrisma = createPrismaClient(env, rootLogger, 'public');
  // Same reasoning as adminPrisma/publicPrisma: leenmart_checkout's RLS
  // policies are static (no session GUCs), so there is no tenant context to
  // wrap it with.
  const checkoutPrisma = createPrismaClient(env, rootLogger, 'checkout');
  const redis = createRedisClient(env, rootLogger);
  const bullRedis = createBullMqRedisClient(env, rootLogger);
  const pubSubRedis = createPubSubRedisClient(env, rootLogger);
  const clock = new SystemClock();
  const idGenerator = new UuidV7Generator();

  const dispose = async (): Promise<void> => {
    // Ordered deliberately: stop accepting work, then release connections.
    await Promise.all([
      prisma.$disconnect(),
      adminPrisma.$disconnect(),
      publicPrisma.$disconnect(),
      checkoutPrisma.$disconnect(),
    ]);
    redis.disconnect();
    bullRedis.disconnect();
    pubSubRedis.disconnect();
  };

  return {
    env,
    rootLogger,
    logger,
    prisma,
    adminPrisma,
    publicPrisma,
    checkoutPrisma,
    redis,
    bullRedis,
    pubSubRedis,
    clock,
    idGenerator,
    dispose,
  };
};
