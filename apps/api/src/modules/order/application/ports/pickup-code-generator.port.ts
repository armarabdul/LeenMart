/**
 * Mints a fresh 4-digit manual/scanner-broken pickup fallback code
 * (S4-QR-FALLBACK, SDD 13.3) — a port, mirroring identity's own
 * `OtpGenerator`/`OtpCode` split, so the application layer never reaches
 * into `node:crypto` directly (SDD 24.4).
 */
export interface PickupCodeGenerator {
  /** A 4-digit, zero-padded string (e.g. `"0472"`) — never derived from the QR token's own nonce (locked decision: the two credentials must not be correlated). */
  generate(): string;
}
