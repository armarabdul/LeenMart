import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import type { Env } from '../../../config/env.js';
import { createRateLimiter } from './rate-limit.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * SDD 23.3's rate-limit budgets, transcribed row for row for the auth
 * endpoints that exist today. Kept as a table for the same reason
 * `PERMISSION_MATRIX` is one: it can be read side-by-side against the SDD.
 *
 * | `POST /auth/login`       | 5/min per identity, 20/min per IP, exponential backoff |
 * | `POST /auth/otp/request` | 1/min, 5/hour per phone; 20/hour per IP                 |
 * | `POST /auth/refresh`     | 10/min per session                                      |
 *
 * Three rows of that table are deliberately absent here:
 *
 *  * **Exponential backoff** on login. SDD 7.5 and 23.3 both call for it, but
 *    neither specifies the curve — base delay, multiplier, or cap — and
 *    inventing one would be inventing a security parameter. The fixed 5/min
 *    ceiling *is* fully specified and lands now; backoff is tracked as an
 *    open item rather than guessed at.
 *  * **`/admin/*` at 300/min per admin.** Every admin route today is an
 *    unauthenticated credential exchange, so there is no authenticated admin
 *    to key on. It arrives with the first admin route that has one.
 *  * **`POST /auth/otp/verify` at 5 per challenge, then destroy.** Already
 *    enforced, and better placed: `Otp.MAX_ATTEMPTS` makes it an invariant of
 *    the challenge itself rather than a property of the transport.
 *
 * The global 1,000/min per-IP row is the limiter `app.ts` already mounts.
 */
const BUDGETS = {
  LOGIN_PER_IDENTITY: { windowMs: MINUTE_MS, max: 5, prefix: 'rl:login:id:' },
  LOGIN_PER_IP: { windowMs: MINUTE_MS, max: 20, prefix: 'rl:login:ip:' },
  OTP_REQUEST_PER_PHONE_MINUTE: { windowMs: MINUTE_MS, max: 1, prefix: 'rl:otp:phone:m:' },
  OTP_REQUEST_PER_PHONE_HOUR: { windowMs: HOUR_MS, max: 5, prefix: 'rl:otp:phone:h:' },
  OTP_REQUEST_PER_IP_HOUR: { windowMs: HOUR_MS, max: 20, prefix: 'rl:otp:ip:h:' },
  REFRESH_PER_SESSION: { windowMs: MINUTE_MS, max: 10, prefix: 'rl:refresh:session:' },
} as const;

/**
 * Buckets are named by a truncated SHA-256 rather than by the raw value.
 *
 * Two reasons, both already this codebase's posture. A refresh token is a
 * live credential and is only ever persisted as a hash (`Session.tokenHash`),
 * so it must not appear in a cache key either. An email or phone number is
 * personal data that SDD 18.2 keeps out of logs, and a Redis key is no better
 * a place for it. 128 bits is far past collision relevance for a bucket name.
 */
const bucket = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);

/**
 * Reads a field from the raw body. These limiters run *before* `validate()`,
 * deliberately — a limiter that only counts well-formed requests is trivially
 * bypassed by sending malformed ones — so nothing here may assume the body
 * has been parsed into a known shape.
 */
const bodyField = (req: Request, field: string): string | undefined => {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) return undefined;
  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * The bucketing policy behind SDD 23.3's "per identity" / "per phone" / "per
 * session" budgets, exported because it *is* policy: which requests share a
 * ceiling is a security decision worth asserting directly, and once wrapped in
 * a limiter it is no longer reachable to test.
 *
 * Every one returns `undefined` when the request names no such subject, which
 * the limiter reads as "nothing to count here".
 */
export const AUTH_RATE_LIMIT_KEYS = {
  /** Matches `emailSchema`'s own trim + lowercase, so casing cannot split a bucket. */
  identity: (req: Request): string | undefined => {
    const email = bodyField(req, 'email');
    return email === undefined ? undefined : bucket(email.toLowerCase());
  },
  phone: (req: Request): string | undefined => {
    const phone = bodyField(req, 'phone');
    return phone === undefined ? undefined : bucket(phone);
  },
  session: (req: Request): string | undefined => {
    const token = bodyField(req, 'refreshToken');
    return token === undefined ? undefined : bucket(token);
  },
} as const;

export interface AuthRateLimiters {
  /** SDD 23.3: 5/min per identity, then 20/min per IP. */
  readonly login: readonly RequestHandler[];
  /** SDD 23.3 / 7.3: 1/min and 5/hour per phone, 20/hour per IP. */
  readonly otpRequest: readonly RequestHandler[];
  /** SDD 23.3: 10/min per session. */
  readonly refresh: readonly RequestHandler[];
}

/**
 * Builds the per-endpoint auth limiters (SDD 23.3).
 *
 * Each budget gets its own limiter and its own Redis prefix, so the "per
 * identity" and "per IP" ceilings on one endpoint count independently — a
 * single limiter cannot express both at once, and collapsing them would let
 * whichever is stricter mask the other.
 *
 * Order within an endpoint is narrowest-first: the identity ceiling is the
 * one an attacker targeting a specific account hits, and rejecting there
 * avoids spending the shared per-IP budget on an attack aimed at one account.
 */
export const createAuthRateLimiters = (redis: Redis, env: Env): AuthRateLimiters => ({
  login: [
    createRateLimiter(redis, env, {
      ...BUDGETS.LOGIN_PER_IDENTITY,
      keyBy: AUTH_RATE_LIMIT_KEYS.identity,
    }),
    createRateLimiter(redis, env, BUDGETS.LOGIN_PER_IP),
  ],
  otpRequest: [
    createRateLimiter(redis, env, {
      ...BUDGETS.OTP_REQUEST_PER_PHONE_MINUTE,
      keyBy: AUTH_RATE_LIMIT_KEYS.phone,
    }),
    createRateLimiter(redis, env, {
      ...BUDGETS.OTP_REQUEST_PER_PHONE_HOUR,
      keyBy: AUTH_RATE_LIMIT_KEYS.phone,
    }),
    createRateLimiter(redis, env, BUDGETS.OTP_REQUEST_PER_IP_HOUR),
  ],
  refresh: [
    createRateLimiter(redis, env, {
      ...BUDGETS.REFRESH_PER_SESSION,
      keyBy: AUTH_RATE_LIMIT_KEYS.session,
    }),
  ],
});
