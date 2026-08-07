/**
 * Password hashing as a port so the domain and use cases never depend on
 * Argon2 directly (SDD 2.3) — the algorithm is an infrastructure decision.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(hash: string, plaintext: string): Promise<boolean>;
}
