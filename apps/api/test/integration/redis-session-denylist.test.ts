import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { RedisSessionDenylist } from '../../src/modules/identity/infrastructure/cache/redis-session-denylist.js';
import {
  toSessionId,
  type SessionId,
} from '../../src/modules/identity/domain/value-objects/session-id.value-object.js';

const KEY_PREFIX = 'denied-session:';

/**
 * Direct adapter-level integration test against real Redis, mirroring the
 * repository-level Postgres tests. The TTL behaviour is the point: SDD 7.2
 * caps a denylist entry at the remaining access-token life, and an entry that
 * never expired would turn a disposable cache into unbounded growth.
 */
describe('RedisSessionDenylist', () => {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const denylist = new RedisSessionDenylist(redis);
  const idGenerator = new UuidV7Generator();

  const created: SessionId[] = [];
  const newSessionId = (): SessionId => {
    const id = toSessionId(idGenerator.generate());
    created.push(id);
    return id;
  };

  beforeAll(async () => {
    await redis.ping();
  });

  afterAll(async () => {
    if (created.length > 0) {
      await redis.del(...created.map((id) => `${KEY_PREFIX}${id}`));
    }
    redis.disconnect();
  });

  it('writes an entry that isDenied() then reports', async () => {
    const sessionId = newSessionId();

    expect(await denylist.isDenied(sessionId)).toBe(false);
    await denylist.deny(sessionId, 600);

    expect(await denylist.isDenied(sessionId)).toBe(true);
  });

  it('bounds the entry by the requested TTL', async () => {
    const sessionId = newSessionId();

    await denylist.deny(sessionId, 600);

    const ttl = await redis.ttl(`${KEY_PREFIX}${sessionId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(600);
  });

  it('never writes a non-expiring entry', async () => {
    const sessionId = newSessionId();

    await denylist.deny(sessionId, 0);

    // -1 is Redis for "key exists, no expiry" — the leak this guards against.
    const ttl = await redis.ttl(`${KEY_PREFIX}${sessionId}`);
    expect(ttl).not.toBe(-1);
    expect(ttl).toBeGreaterThan(0);
  });

  it('stops denying once the entry expires', async () => {
    const sessionId = newSessionId();
    await denylist.deny(sessionId, 600);
    expect(await denylist.isDenied(sessionId)).toBe(true);

    // Expiry is driven directly rather than by waiting: the assertion is that
    // an expired entry stops denying, not that Redis can count seconds.
    await redis.del(`${KEY_PREFIX}${sessionId}`);

    expect(await denylist.isDenied(sessionId)).toBe(false);
  });

  it('leaves a different session unaffected', async () => {
    const denied = newSessionId();
    const untouched = newSessionId();

    await denylist.deny(denied, 600);

    expect(await denylist.isDenied(denied)).toBe(true);
    expect(await denylist.isDenied(untouched)).toBe(false);
  });

  it('is idempotent — denying twice leaves one bounded entry', async () => {
    const sessionId = newSessionId();

    await denylist.deny(sessionId, 600);
    await denylist.deny(sessionId, 600);

    expect(await redis.exists(`${KEY_PREFIX}${sessionId}`)).toBe(1);
    expect(await redis.ttl(`${KEY_PREFIX}${sessionId}`)).toBeGreaterThan(0);
  });

  it('stores no credential — only the key carries meaning', async () => {
    const sessionId = newSessionId();

    await denylist.deny(sessionId, 600);

    const value = await redis.get(`${KEY_PREFIX}${sessionId}`);
    expect(value).toBe('1');
  });
});
