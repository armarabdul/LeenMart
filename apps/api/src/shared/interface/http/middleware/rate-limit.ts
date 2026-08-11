import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Redis } from 'ioredis';
import type { NextFunction, Request, Response } from 'express';
import { RateLimitError } from '@leen-mart/domain-kit';
import type { Env } from '../../../config/env.js';

const FALLBACK_RETRY_AFTER_SECONDS = 60;

/**
 * Reads back the `Retry-After` the library already computed and set, rather
 * than deriving a second value from a second clock: two independently
 * computed hints on the same response could disagree, and the header is the
 * one the client actually obeys.
 */
const retryAfterSeconds = (res: Response, windowMs: number): number => {
  const header = Number(res.getHeader('Retry-After'));
  if (Number.isFinite(header) && header > 0) return header;
  const fromWindow = Math.ceil(windowMs / 1000);
  return fromWindow > 0 ? fromWindow : FALLBACK_RETRY_AFTER_SECONDS;
};

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
    // SDD 9.2 names `X-RateLimit-Limit/Remaining/Reset` specifically, which is
    // this library's "legacy" set. Emitted alongside draft-7's `RateLimit`
    // header rather than instead of it — the SDD's contract is what clients
    // are written against, and keeping the modern header costs nothing.
    legacyHeaders: true,
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
    /**
     * Hands the refusal to the global error handler instead of writing a body
     * here (SDD 9.3). A short-circuit response was the one place in the API
     * that answered with a different error shape: it carried `code` and
     * `message` but neither `requestId` nor `timestamp`, so the single
     * response a client is most likely to have to debug was the one it could
     * not correlate to a log line.
     *
     * `RateLimitError` already existed in `domain-kit` and the error handler
     * already mapped it to 429 with a `Retry-After` — this is the caller that
     * was missing. The `RATE_LIMIT_EXCEEDED` code and the message are
     * unchanged, so the only difference on the wire is the two fields SDD 9.3
     * requires.
     */
    handler: (_req: Request, res: Response, next: NextFunction): void => {
      next(
        new RateLimitError(
          retryAfterSeconds(res, options.windowMs ?? env.RATE_LIMIT_WINDOW_MS),
          'Too many requests. Please retry shortly.',
        ),
      );
    },
  });
