import { PrismaClient } from '@prisma/client';
import type { Logger as PinoLogger } from 'pino';
import type { Env } from '../../config/env.js';

/**
 * Prisma client factory.
 *
 * The client is confined to the infrastructure layer: repositories map Prisma
 * rows to domain entities, and Prisma types never escape past a repository
 * boundary (SDD 3.4).
 */
/**
 * Which database role a client connects as (KYC-2B-1).
 *
 * `app` is the vendor-facing runtime role and is what almost everything should
 * use. `admin` is a *separate credential* for reviewer and administrative
 * paths — that separation is the elevated-access trust boundary, in place of a
 * flag the application sets for itself. `owner` is the migration role and is
 * only correct for schema work; it is SUPERUSER with BYPASSRLS, so a request
 * served on it skips every policy KYC-2B-3 will add.
 *
 * Both runtime roles fall back to the owner URL when unset, which keeps
 * development working before the roles are provisioned. `env.ts` refuses that
 * fallback in production, where it would silently disable RLS.
 */
export type DatabaseRole = 'owner' | 'app' | 'admin';

export const databaseUrlFor = (env: Env, role: DatabaseRole): string => {
  if (role === 'app') {
    return env.APP_DATABASE_URL ?? env.DATABASE_URL;
  }
  if (role === 'admin') {
    return env.ADMIN_DATABASE_URL ?? env.DATABASE_URL;
  }
  return env.DATABASE_URL;
};

export const createPrismaClient = (
  env: Env,
  logger: PinoLogger,
  role: DatabaseRole = 'owner',
): PrismaClient => {
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrlFor(env, role) } },
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });

  client.$on('warn', (event) => {
    logger.warn({ prisma: event }, 'Prisma warning');
  });

  client.$on('error', (event) => {
    logger.error({ prisma: event }, 'Prisma error');
  });

  // Slow-query visibility is the cheapest early warning for the N+1 and
  // missing-index problems flagged in SDD 21 (SC-10, PERF-05).
  client.$on('query', (event) => {
    if (event.duration >= SLOW_QUERY_THRESHOLD_MS) {
      logger.warn(
        { durationMs: event.duration, target: event.target },
        'Slow database query detected',
      );
    }
  });

  return client;
};

export const SLOW_QUERY_THRESHOLD_MS = 500;

export interface DatabaseHealth {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

export const checkDatabase = async (client: PrismaClient): Promise<DatabaseHealth> => {
  const startedAt = Date.now();
  try {
    await client.$queryRaw`SELECT 1`;
    return { healthy: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Unknown database error',
    };
  }
};
