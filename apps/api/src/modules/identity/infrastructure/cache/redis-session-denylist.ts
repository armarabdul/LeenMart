import type { Redis } from 'ioredis';
import type { SessionDenylist } from '../../application/ports/session-denylist.port.js';
import type { SessionId } from '../../domain/value-objects/session-id.value-object.js';

/**
 * Namespaced like the rate limiter's `rl:` keys so the two cross-cutting uses
 * of Redis stay visibly distinct in a `KEYS` dump or an eviction report.
 */
const KEY_PREFIX = 'denied-session:';

/**
 * Redis-backed implementation of SDD 7.2's revocation denylist.
 *
 * Redis rather than process memory for the same reason the rate limiter is
 * (SC-07): an in-memory set would revoke a session only on whichever API task
 * happened to serve the logout, leaving every other task still honouring the
 * token — which is not revocation at all.
 *
 * The stored value is a constant; only the key's existence carries meaning.
 * Nothing about the session, the user, or the token is written, so this cache
 * holds no credential and no personal data.
 */
export class RedisSessionDenylist implements SessionDenylist {
  constructor(private readonly redis: Redis) {}

  private static key(sessionId: SessionId): string {
    return `${KEY_PREFIX}${sessionId}`;
  }

  async deny(sessionId: SessionId, ttlSeconds: number): Promise<void> {
    // `SET … EX` in one round trip: a separate SET + EXPIRE could leave a
    // permanent key behind if the process died between them, and a session
    // denied forever is a slow memory leak in a store sized for short-lived
    // entries. Redis rejects a non-positive EX, so a caller passing a
    // degenerate TTL would otherwise fail the whole revocation.
    const ttl = Math.max(1, Math.ceil(ttlSeconds));
    await this.redis.set(RedisSessionDenylist.key(sessionId), '1', 'EX', ttl);
  }

  async isDenied(sessionId: SessionId): Promise<boolean> {
    const found = await this.redis.exists(RedisSessionDenylist.key(sessionId));
    return found === 1;
  }
}
