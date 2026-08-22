/**
 * A Vitest `setupFiles` entry for the `integration` project — runs before
 * every integration test file's own top-level code, including files that
 * construct a bare `new PrismaClient()` without importing
 * `src/container.js` or `src/shared/config/env.js` themselves (e.g.
 * `prisma-audit-log.repository.test.ts`, `prisma-mfa-challenge.repository.test.ts`,
 * and every other repository-only integration test that never calls
 * `createContainer()`).
 *
 * Without this, such a file's `PrismaClient` construction races
 * `@prisma/client`'s own independent, unconditional `.env` auto-load (see
 * `env.ts`'s own comment on `tryLoadEnv`) — and whichever loader runs first
 * wins `DATABASE_URL`, since `dotenv` defaults to `override: false`. A file
 * with no import path to `env.ts` has nothing to make it lose that race
 * safely, and depending on which file Vitest happens to run first in a
 * given invocation, its queries can silently land on the *development*
 * database instead of `leenmart_test` — the exact data-safety failure the
 * `env: { ENV_FILE: '.env.test' }` project setting and `env.ts`'s own
 * `override: true` already exist to close for every file that *does* import
 * one of those two modules.
 *
 * This closes the gap for every file, including the ones that don't:
 * importing `env.js` here, before any test file's own code runs, makes its
 * `override: true` dotenv call authoritative for the whole worker process,
 * so a bare `new PrismaClient()` anywhere afterward finds `DATABASE_URL`
 * already correctly pointed at `leenmart_test` — `dotenv`'s own
 * non-override default then leaves it alone.
 */
import { beforeEach } from 'vitest';
import { Redis } from 'ioredis';
import '../../src/shared/config/env.js';

let redisClient: Redis | null = null;

const getRedisClient = (): Redis => {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    redisClient = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  }
  return redisClient;
};

beforeEach(async () => {
  try {
    const client = getRedisClient();
    if (client.status === 'wait') {
      await client.connect();
    }
    const keys = await client.keys('rl:*');
    if (keys.length > 0) {
      await client.del(...keys);
    }
  } catch {
    // Ignore Redis errors if Redis is not active in current test context
  }
});
