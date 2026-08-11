import { InvalidKycIdentifierError } from '../errors/kyc-errors.js';

/**
 * Five letters, four digits, one letter. SDD 15.1 lists "PAN format" among the
 * verification checks; this is that check and nothing more — it says the value
 * is *shaped* like a PAN, never that the Income Tax Department has heard of
 * it. Confirming a PAN actually exists needs the external verification SDD
 * 15.1 also describes, which V1 defers.
 */
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const LAST_DIGITS = 4;

/**
 * A vendor's PAN, held only long enough to be canonicalised, fingerprinted and
 * reduced to its last four characters.
 *
 * **This value object is never persisted.** SDD 12.3 displays KYC identifiers
 * "masked by default (last 4 characters)", and the full number lives inside
 * the client-encrypted document in object storage. What reaches the database
 * is `last4` — which *is* the masked form, so it discloses nothing the UI does
 * not already show — and a fingerprint computed from `canonical`, which is
 * one-way. Keeping the full value out of every row is what stops a database
 * compromise from being a PAN disclosure.
 */
export class Pan {
  private constructor(
    /** Uppercased and stripped of surrounding whitespace, so the same PAN always fingerprints identically. */
    public readonly canonical: string,
  ) {}

  static create(value: string): Pan {
    const canonical = value.trim().toUpperCase();
    if (!PAN_PATTERN.test(canonical)) {
      throw new InvalidKycIdentifierError('pan', 'must be ten characters in the form AAAAA9999A');
    }
    return new Pan(canonical);
  }

  /** The only part of a PAN that is ever stored or displayed (SDD 12.3). */
  get last4(): string {
    return this.canonical.slice(-LAST_DIGITS);
  }

  equals(other: Pan): boolean {
    return this.canonical === other.canonical;
  }

  /**
   * Masked, deliberately. `toString` is what ends up in a template literal or
   * an accidental log line, so the safe form is the only form it returns —
   * code that genuinely needs the full value has to ask for `canonical` and be
   * visible in review doing so.
   */
  toString(): string {
    return `PAN••••••${this.last4}`;
  }
}
