import type { SensitiveFingerprint } from '../value-objects/sensitive-fingerprint.value-object.js';

/**
 * What kind of identifier a fingerprint was computed over.
 *
 * Bound into the computation so the same digits cannot collide across kinds:
 * without it, an account number that happened to equal another vendor's
 * something-else would read as a duplicate.
 */
export type FingerprintedIdentifier = 'PAN' | 'BANK_ACCOUNT';

/**
 * Computes the one-way fingerprints SEC-17 duplicate detection compares
 * ("Link identities on PAN/bank account/device fingerprint/address; block at
 * KYC"). Only the two kinds above are listed, because they are the only ones
 * `KycIdentifiers` holds a value for. SEC-17 also links on phone and device:
 * the phone belongs to the account in `identity`, not to a KYC submission, and
 * device fingerprinting is deferred with the Stage 6 fraud module where SDD 16
 * puts it. Each becomes one more member here when the chunk that owns the
 * value arrives.
 *
 * An interface here and an implementation in infrastructure, for the same
 * reason `OtpHasher` and `TokenHasher` are split that way: the computation is
 * keyed by a secret, and a secret is not something the domain layer may hold
 * or know the shape of. The domain states *what* is fingerprinted; how it is
 * keyed, and with which pepper, is a deployment concern.
 *
 * Implementations must be deterministic — the same canonical value and kind
 * must always produce the same fingerprint, or duplicate detection silently
 * stops detecting anything.
 */
export interface IdentifierFingerprinter {
  fingerprint(kind: FingerprintedIdentifier, canonicalValue: string): SensitiveFingerprint;
}
