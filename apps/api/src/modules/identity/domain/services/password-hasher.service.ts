import type { PasswordHash } from '../value-objects/password-hash.value-object.js';

/**
 * Uses the `PasswordHash` value object rather than a raw `string` — a
 * deliberate refinement over the pre-existing application-layer
 * `PasswordHasher` port (written before this value object existed).
 * Reconciling the two is tracked in docs/identity-milestone2-backlog.md.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<PasswordHash>;
  verify(hash: PasswordHash, plaintext: string): Promise<boolean>;
}
