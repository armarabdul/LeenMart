/**
 * TOTP (RFC 6238) generation and verification for admin MFA (SDD 7.1:
 * mandatory TOTP, always). Deliberately minimal, mirroring `OtpGenerator`:
 * plain strings in and out, no dedicated value object for the secret or the
 * token — nothing here needs extra invariants beyond "a base32 string" and
 * "a 6-digit code," and this chunk has no enrollment/verification flow to
 * hand a richer type to yet.
 *
 * `generateSecret()` returns the secret in the clear — the only place this
 * layer ever sees the plaintext. The caller is responsible for encrypting it
 * (via `MfaSecretCipher`) before it touches persistence; this interface has
 * no method that accepts or returns a plaintext secret for storage, only for
 * one-time issuance and for verification (which needs the decrypted value
 * transiently, never the ciphertext).
 */
export interface TotpService {
  /** A fresh, random, base32-encoded secret — never persisted as returned. */
  generateSecret(): string;
  verify(params: { secret: string; token: string; now: Date }): Promise<boolean>;
}
