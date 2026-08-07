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
export const createPrismaClient = (env: Env, logger: PinoLogger): PrismaClient => {
  const client = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
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
