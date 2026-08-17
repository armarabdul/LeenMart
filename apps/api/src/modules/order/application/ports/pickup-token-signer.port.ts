import type { SubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';

/** What a verified token proves — nothing more (SDD 13.1's payload, minus the fields verification already consumed). */
export interface PickupTokenPayload {
  readonly subOrderId: SubOrderId;
  readonly nonce: string;
}

export interface SignedPickupToken {
  readonly token: string;
  readonly nonce: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/**
 * Signs and verifies pickup credentials (S4-QR, SDD §13.1: Ed25519, a
 * 128-bit nonce, `aud: 'pickup'`). A port, not a concrete class reference,
 * for the same reason every other cross-cutting security primitive in this
 * codebase is (`PasswordHasherService`, `AccessTokenService`) — the domain
 * and application layers name the capability, never the algorithm or
 * library behind it.
 *
 * `verify` never distinguishes *why* a token was refused (SEC-15, mirroring
 * `AccessTokenService.verify()`'s own doc comment) — every failure collapses
 * to `PickupTokenInvalidError` at the call site.
 */
export interface PickupTokenSigner {
  /** Mints a fresh signed token for `subOrderId` — a new nonce and a new validity window every call (SDD 13.1's 60-second rotation). */
  sign(subOrderId: SubOrderId): SignedPickupToken;

  /** Verifies the signature, expiry and audience. Throws (never returns a null/invalid marker) on any failure — see the class doc comment. */
  verify(token: string): PickupTokenPayload;
}
