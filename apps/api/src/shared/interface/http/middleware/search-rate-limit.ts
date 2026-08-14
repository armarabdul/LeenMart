import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Redis } from 'ioredis';
import type { Env } from '../../../config/env.js';
import { createRateLimiter } from './rate-limit.js';

const MINUTE_MS = 60_000;

/**
 * `GET /api/v1/search`'s two-tier budget (SDD 20/line 1430): 60/min per IP
 * anonymous, 120/min authenticated.
 *
 * Two independent limiters, picked one-or-the-other per request, rather than
 * one keyed limiter with a `keyBy` that tries to skip itself conditionally —
 * an authenticated request must never also draw from the anonymous IP
 * bucket, and the surest way to guarantee that is to never call the IP
 * limiter for it at all. `perIp` reuses `createRateLimiter`'s own default
 * key generator (no `keyBy`) rather than reimplementing IP normalisation,
 * the same restraint `BUDGETS.LOGIN_PER_IP` already shows.
 *
 * Requires `optionalAuthenticate` to run first: this reads `req.principal`,
 * never the `Authorization` header directly.
 */
export const createSearchRateLimiter = (redis: Redis, env: Env): RequestHandler => {
  const perIp = createRateLimiter(redis, env, {
    windowMs: MINUTE_MS,
    max: 60,
    prefix: 'rl:search:ip:',
  });
  const perUser = createRateLimiter(redis, env, {
    windowMs: MINUTE_MS,
    max: 120,
    prefix: 'rl:search:user:',
    keyBy: (req: Request): string | undefined => req.principal?.userId,
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.principal) {
      perUser(req, res, next);
    } else {
      perIp(req, res, next);
    }
  };
};
