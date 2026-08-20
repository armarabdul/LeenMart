import * as argon2 from 'argon2';
import type { PickupCodeHasher } from '../../application/ports/pickup-code-hasher.port.js';

/**
 * Argon2id, mirroring `Argon2OtpHasher`'s own reasoning exactly: a 4-digit
 * code is only 10,000 possibilities, so a fast hash would let anyone who
 * steals `pickup_tokens` brute-force every code in milliseconds.
 */
export class Argon2PickupCodeHasher implements PickupCodeHasher {
  async hash(rawCode: string): Promise<string> {
    return await argon2.hash(rawCode, { type: argon2.argon2id });
  }

  async verify(hash: string, rawCode: string): Promise<boolean> {
    return await argon2.verify(hash, rawCode);
  }
}
