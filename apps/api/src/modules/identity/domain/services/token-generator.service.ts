/**
 * Produces a new opaque, high-entropy token string — generation only.
 * Hashing it for storage is a separate concern (the existing
 * `RefreshTokenHasher` application port bundles both today; see
 * docs/identity-milestone2-backlog.md for reconciling the two).
 */
export interface TokenGenerator {
  generate(): string;
}
