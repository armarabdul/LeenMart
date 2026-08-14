import { Redis } from 'ioredis';
import type { Logger as PinoLogger } from 'pino';
import type { Env } from '../../config/env.js';

/**
 * Redis connection factory.
 *
 * Redis holds only derived state — cache, rate-limit counters, distributed
 * locks and queue jobs — all reconstructible from PostgreSQL. It is deliberately
 * treated as disposable (SDD 22.2 / ADR-024), which is what keeps the recovery
 * story simple.
 */
export const createRedisClient = (env: Env, logger: PinoLogger): Redis => {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
    reconnectOnError: (error) => error.message.includes('READONLY'),
  });

  client.on('error', (error: Error) => {
    logger.error({ err: error }, 'Redis connection error');
  });

  client.on('ready', () => {
    logger.info({}, 'Redis connection ready');
  });

  client.on('reconnecting', () => {
    logger.warn({}, 'Redis reconnecting');
  });

  return client;
};

/**
 * A second, dedicated connection for BullMQ (S2-6b, D-S2-6-A).
 *
 * Not the same instance `createRedisClient` returns: BullMQ's `Worker` and
 * `QueueEvents` block on the connection while waiting for jobs, which
 * requires `maxRetriesPerRequest: null` — a setting that would be wrong for
 * `createRedisClient`'s own callers (rate limiting, session denylist), which
 * need bounded retries on an ordinary request/response connection. Same
 * server, same `REDIS_URL`, deliberately separate client — the same
 * per-purpose credential separation `prisma`/`adminPrisma` already practise,
 * one level down from Postgres.
 */
export const createBullMqRedisClient = (env: Env, logger: PinoLogger): Redis => {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  client.on('error', (error: Error) => {
    logger.error({ err: error }, 'BullMQ Redis connection error');
  });

  return client;
};

export interface CacheHealth {
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

export const checkRedis = async (client: Redis): Promise<CacheHealth> => {
  const startedAt = Date.now();
  try {
    const reply = await client.ping();
    return {
      healthy: reply === 'PONG',
      latencyMs: Date.now() - startedAt,
      // ioredis types `ping()` as resolving only to 'PONG', so TS narrows
      // `reply` to `never` in this branch; the runtime value can still be
      // anything the server actually returned, hence the explicit `String()`.
      ...(reply === 'PONG' ? {} : { error: `Unexpected PING reply: ${String(reply)}` }),
    };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Unknown Redis error',
    };
  }
};
