import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  FingerprintedIdentifier,
  IdentifierFingerprinter,
} from '../../domain/services/identifier-fingerprinter.service.js';
import type { SensitiveFingerprint } from '../../domain/value-objects/sensitive-fingerprint.value-object.js';

const PEPPER_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * HMAC-SHA256 over the canonical identifier, keyed by a deployment secret.
 *
 * Keyed rather than a plain digest, and this is the whole reason the port
 * exists in the domain while the implementation lives here: a PAN has a fixed
 * ten-character shape and on the order of 10^12 possibilities, so an unkeyed
 * SHA-256 of every PAN is enumerable offline by anyone who obtains the table.
 * With a pepper they hold only digests of a keyspace they cannot search.
 *
 * The pepper never reaches the domain, is never persisted beside the
 * fingerprints it produces, and is not part of any entity's serialised form.
 * A dump of `vendor_kyc_submissions` therefore contains no material that helps
 * reverse what is in it.
 *
 * Deliberately a *separate* secret from `MFA_ENCRYPTION_KEY`, the KMS CMK and
 * `JWT_ACCESS_SECRET`. Reusing any of those would mean one leak defeats two
 * unrelated controls, and unlike those, this value can never be rotated: a new
 * pepper produces different digests for the same PAN, so every stored
 * fingerprint would stop matching every future one.
 */
export class HmacIdentifierFingerprinter implements IdentifierFingerprinter {
  private readonly pepper: Buffer;

  constructor(pepper: string) {
    if (!PEPPER_PATTERN.test(pepper)) {
      // Not a domain error: a misconfigured secret is an operational fault,
      // and letting it through would silently produce fingerprints that no
      // other process could reproduce.
      throw new TypeError(
        'KYC_FINGERPRINT_PEPPER must be a 64-character hexadecimal string (32 bytes).',
      );
    }
    this.pepper = Buffer.from(pepper, 'hex');
  }

  /**
   * The kind is bound *cryptographically*, not concatenated as a prefix on the
   * output: it goes into the HMAC input, so a bank account number that happens
   * to equal some other identifier produces a completely different digest.
   * Prefixing the result instead would leave the underlying digests equal and
   * let a comparison that forgot the prefix report a false duplicate.
   *
   * `|` cannot occur in either canonical form — a PAN is letters and digits,
   * a bank account is `IFSC:digits` — so the split point is unambiguous and no
   * two distinct (kind, value) pairs produce the same HMAC message. A visible
   * ASCII character rather than a control byte on purpose: an invisible
   * separator makes this line unreadable in review and turns the whole file
   * binary to `git diff`.
   */
  fingerprint(kind: FingerprintedIdentifier, canonicalValue: string): SensitiveFingerprint {
    return createHmac('sha256', this.pepper)
      .update(`${kind}|${canonicalValue}`, 'utf8')
      .digest('hex') as SensitiveFingerprint;
  }

  /**
   * Constant-time comparison, for the duplicate-detection lookups KYC-4/KYC-5
   * will perform. Fingerprints are not secrets in the way a token is, but they
   * are compared against attacker-influenced input — a vendor chooses the PAN
   * they submit — and a timing-variable compare is the kind of thing that is
   * free to avoid now and awkward to retrofit.
   */
  static matches(left: SensitiveFingerprint, right: SensitiveFingerprint): boolean {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
