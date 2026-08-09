/**
 * Hashes opaque token material for storage — generation-only is
 * `TokenGenerator`, hashing-only is this. Kept split because
 * `PasswordHasher` needs both `hash` and `verify` on a low-entropy secret,
 * while a refresh token is already 256 bits of randomness: lookups are by
 * re-hashing the presented token and comparing digests via a repository
 * query, so no `verify` method is needed here.
 */
export interface TokenHasher {
  hash(rawToken: string): string;
}
