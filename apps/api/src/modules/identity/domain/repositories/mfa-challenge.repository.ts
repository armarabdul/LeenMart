import type { MfaChallenge } from '../entities/mfa-challenge.entity.js';

/** Uses `string` for the hash lookup, matching `MfaChallenge.tokenHash` — never look up a challenge by anything but its hash. */
export interface MfaChallengeRepository {
  create(mfaChallenge: MfaChallenge): Promise<void>;
  update(mfaChallenge: MfaChallenge): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<MfaChallenge | null>;
}
