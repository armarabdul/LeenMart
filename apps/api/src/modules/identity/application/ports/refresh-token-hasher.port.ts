/**
 * Generates and hashes opaque refresh tokens.
 *
 * Kept separate from `PasswordHasher`: a refresh token is already 256 bits of
 * randomness, so a fast general-purpose hash (SHA-256) is correct here — an
 * intentionally slow, memory-hard hash like Argon2 would only add latency
 * without adding resistance to anything, since there is no low-entropy
 * secret to protect against brute force.
 */
export interface RefreshTokenHasher {
  /** A new cryptographically random opaque token, returned to the client once. */
  generate(): string;
  /** The stored, irreversible digest of a raw token, used for lookups. */
  hash(rawToken: string): string;
}
