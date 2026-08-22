import type { Redis, Result, Callback } from 'ioredis';
import type { CampaignId } from '../../domain/value-objects/campaign-id.value-object.js';

const KEY_PREFIX = 'preorder:campaign:';
/** Generous TTL — the reconciliation sweep (Layer 3) refreshes this on every tick anyway; the TTL is only a backstop against an orphaned key outliving a cancelled/forgotten campaign. */
const KEY_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * SDD §14.4 layer 1 — the Redis admission gate. **Redis holds only derived
 * state** (`redis.ts`'s own doc comment: "deliberately treated as
 * disposable"); PostgreSQL's own atomic conditional `UPDATE`
 * (`CampaignRepository.decrementRemainingIfAvailable`) is the correctness
 * authority regardless of anything this class does. This gate exists purely
 * to shed a thundering herd before it ever reaches Postgres.
 *
 * The one Lua script this codebase uses (confirmed: no other `EVAL`/`MULTI`
 * usage exists anywhere else in the repository) — deliberately the smallest
 * possible one, and deliberately *not* a general Redis-scripting framework:
 * one script, one purpose, checked and decremented atomically in a single
 * round trip so there is no window where a losing request could observe a
 * transiently-negative counter.
 */
declare module 'ioredis' {
  interface RedisCommander<Context> {
    preorderTryReserve(
      key: string,
      quantity: string,
      callback?: Callback<number>,
    ): Result<number, Context>;
  }
}

const TRY_RESERVE_LUA = `
local remaining = redis.call('GET', KEYS[1])
if remaining == false then
  return -1
end
local remainingNum = tonumber(remaining)
local qty = tonumber(ARGV[1])
if remainingNum < qty then
  return 0
end
redis.call('DECRBY', KEYS[1], qty)
return 1
`;

export type QuotaGateOutcome = 'RESERVED' | 'REJECTED' | 'UNKNOWN';

export class RedisCampaignQuotaGate {
  constructor(private readonly redis: Redis) {
    this.redis.defineCommand('preorderTryReserve', { numberOfKeys: 1, lua: TRY_RESERVE_LUA });
  }

  private static key(campaignId: CampaignId): string {
    return `${KEY_PREFIX}${campaignId}:remaining`;
  }

  /** Called when a campaign transitions to `OPEN`, and by every reconciliation tick — `SET`, never `INCR`/`DECR`, so it is idempotent by construction ("PostgreSQL always wins", SDD §14.4 layer 3). */
  async setRemaining(campaignId: CampaignId, remaining: number): Promise<void> {
    await this.redis.set(RedisCampaignQuotaGate.key(campaignId), remaining, 'EX', KEY_TTL_SECONDS);
  }

  async clear(campaignId: CampaignId): Promise<void> {
    await this.redis.del(RedisCampaignQuotaGate.key(campaignId));
  }

  /**
   * The one atomic check-and-decrement. `UNKNOWN` means the gate has no
   * counter for this campaign (never opened through the gate yet, or the
   * key expired/was never reconciled) — the caller must fail *open* in that
   * case, per this class's own doc comment: Redis is optional, Postgres is
   * not.
   */
  async tryReserve(campaignId: CampaignId, quantity: number): Promise<QuotaGateOutcome> {
    const result = await this.redis.preorderTryReserve(
      RedisCampaignQuotaGate.key(campaignId),
      String(quantity),
    );
    if (result === -1) return 'UNKNOWN';
    return result === 1 ? 'RESERVED' : 'REJECTED';
  }

  /** The compensating release — mirrors `CampaignRepository.incrementRemaining`'s own unconditional-increment reasoning; called whenever Postgres ultimately disagrees with what the gate admitted (drift), and on every reservation release (expiry/failure/cancel). */
  async release(campaignId: CampaignId, quantity: number): Promise<void> {
    const exists = await this.redis.exists(RedisCampaignQuotaGate.key(campaignId));
    if (exists === 1) {
      await this.redis.incrby(RedisCampaignQuotaGate.key(campaignId), quantity);
    }
  }
}
