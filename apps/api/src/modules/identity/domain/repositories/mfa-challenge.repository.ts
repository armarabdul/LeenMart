import type { MfaChallengeId } from '../value-objects/mfa-challenge-id.value-object.js';
import type { MfaChallenge } from '../entities/mfa-challenge.entity.js';

/** Uses `string` for the hash lookup, matching `MfaChallenge.tokenHash` — never look up a challenge by anything but its hash. */
export interface MfaChallengeRepository {
  create(mfaChallenge: MfaChallenge): Promise<void>;
  update(mfaChallenge: MfaChallenge): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<MfaChallenge | null>;
  /**
   * Atomically marks the challenge consumed, but only if it is still active
   * (unconsumed, unexpired, under the attempt cap) at the moment of the
   * write — a single conditional database statement, not a read-modify-write.
   *
   * This exists because `update()` is a blind overwrite: two concurrent
   * requests that both read the same active challenge, both verify a
   * correct TOTP, and both call `update()` with a consumed copy would both
   * succeed, producing two sessions from one challenge. This method closes
   * that window by making the database itself the single arbiter of which
   * request wins — the loser gets `false` and must fail exactly like any
   * other invalid-challenge case, never issuing a session.
   */
  consumeIfActive(id: MfaChallengeId, now: Date): Promise<boolean>;
}
