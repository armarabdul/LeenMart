/**
 * Hashes OTP codes for storage — deliberately not `PasswordHasher`.
 *
 * `PasswordHasher` returns the `PasswordHash` value object, which exists
 * specifically to wrap an already-hashed *password* (its own validation,
 * its own domain meaning). An OTP code isn't a password, so reusing that
 * type here would misrepresent what's being hashed. This interface mirrors
 * `PasswordHasher`'s async shape (Argon2 hashing is inherently async) but
 * stays deliberately minimal — plain strings in, plain strings out, no
 * dedicated value object — because nothing here needs `PasswordHash`'s
 * extra invariants, and inventing an `OtpHash` type with no behaviour of
 * its own would be symmetry for its own sake, not a real requirement.
 */
export interface OtpHasher {
  hash(rawCode: string): Promise<string>;
  verify(hash: string, rawCode: string): Promise<boolean>;
}
