import * as argon2 from 'argon2';
import type { OtpHasher } from '../../domain/services/otp-hasher.service.js';

/**
 * Argon2id, not the SHA-256 used for refresh tokens (`CryptoRefreshTokenHasher`).
 * A refresh token is already 256 bits of randomness; a 6-digit OTP is only
 * ~20 bits (1,000,000 possibilities) — a fast hash would let anyone who
 * steals the `otps` table brute-force every code in milliseconds. Argon2's
 * memory-hardness is exactly the same reasoning `PasswordHasher` already
 * applies to passwords, which is why this reuses the identical
 * configuration (`argon2id`, default parameters) rather than inventing a
 * separate parameter set.
 */
export class Argon2OtpHasher implements OtpHasher {
  async hash(rawCode: string): Promise<string> {
    return await argon2.hash(rawCode, { type: argon2.argon2id });
  }

  async verify(hash: string, rawCode: string): Promise<boolean> {
    return await argon2.verify(hash, rawCode);
  }
}
