/**
 * Hashes the manual/scanner-broken pickup fallback code for storage
 * (S4-QR-FALLBACK, SDD 13.3). Deliberately a module-local port rather than a
 * cross-module import of identity's own `OtpHasher` — SDD 5.1/24.4 confines
 * cross-module access to a module's published `index.ts`, and `OtpHasher` is
 * not published there. The shape is intentionally identical, for the same
 * reason `OtpHasher` gives for not reusing `PasswordHasher`: a 4-digit
 * pickup code is not a password and not an OTP, but it is exactly the same
 * *kind* of secret — short, numeric, brute-forceable by anyone who steals
 * the row — so it gets the same treatment, not a bespoke one.
 */
export interface PickupCodeHasher {
  hash(rawCode: string): Promise<string>;
  verify(hash: string, rawCode: string): Promise<boolean>;
}
