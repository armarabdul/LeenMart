import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Redis } from 'ioredis';
import type { Request } from 'express';
import type { Env } from '../../../config/env.js';

/**
 * Distributed rate limiting (SDD 23.3).
 *
 * Backed by Redis rather than process memory: an in-memory counter multiplies
 * the effective limit by the number of API tasks and silently stops working the
 * moment the service scales horizontally (SC-07).
 */
export const createRateLimiter = (
  redis: Redis,
  env: Env,
  options: {
    windowMs?: number;
    max?: number;
    prefix?: string;
    /**
     * Buckets requests by something other than the client IP — SDD 23.3's
     * "per identity" / "per session" budgets. Returning `undefined` means
     * this request carries no such key, and the limiter skips it rather than
     * dropping every anonymous request into one shared bucket, which would
     * hand an attacker a way to exhaust everyone else's budget at once.
     */
    keyBy?: (req: Request) => string | undefined;
  } = {},
): RateLimitRequestHandler =>
  rateLimit({
    windowMs: options.windowMs ?? env.RATE_LIMIT_WINDOW_MS,
    limit: options.max ?? env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Only overridden for a keyed budget; otherwise the library's own
    // IP key generator (which normalises IPv6 correctly) stays in place.
    ...(options.keyBy
      ? { keyGenerator: (req: Request): string => options.keyBy?.(req) ?? '' }
      : {}),
    store: new RedisStore({
      prefix: options.prefix ?? 'rl:global:',
      sendCommand: async (...args: string[]): Promise<never> => {
        const [command, ...rest] = args;
        return (await redis.call(command ?? 'PING', ...rest)) as never;
      },
    }),
    // Health checks must stay answerable even while shedding load.
    // Typed explicitly: `express-rate-limit` re-exports `Request` from a
    // pnpm peer-dependency-scoped copy of `express` whose own types aren't
    // reachable from here, so its inferred parameter type is unusable;
    // this package's own (correctly resolving) `express` import isn't.
    skip: (req: Request): boolean =>
      req.path === '/healthz' ||
      req.path === '/readyz' ||
      // A keyed limiter with nothing to key on has no bucket to count into.
      (options.keyBy !== undefined && options.keyBy(req) === undefined),
    message: {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please retry shortly.',
      },
    },
  });
