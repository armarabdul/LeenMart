import { InvalidKycIdentifierError } from '../errors/kyc-errors.js';

/** Four letters, a reserved `0`, then six branch characters. */
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Indian account numbers run roughly 9–18 digits across banks. */
const ACCOUNT_MIN_LENGTH = 9;
const ACCOUNT_MAX_LENGTH = 18;

const LAST_DIGITS = 4;

/**
 * The bank account a vendor is to be paid into.
 *
 * **This is shape, not verification.** SDD 15.1's actual bank check is a
 * penny-drop for name match, which V1 defers in favour of an administrator
 * reading the uploaded proof (D2). Nothing here contacts a bank, and nothing
 * here says the account exists or belongs to the vendor — it only rejects
 * input that cannot be an account number at all, so an obvious typo is caught
 * before a human is asked to review it.
 *
 * Held exactly as `Pan` is: the full number is never persisted. The database
 * gets `last4` (the masked form SDD 12.3 displays) plus a one-way fingerprint
 * of `canonical` for SEC-17 duplicate detection.
 */
export class BankAccount {
  private constructor(
    private readonly accountNumber: string,
    public readonly ifsc: string,
  ) {}

  static create(input: { accountNumber: string; ifsc: string }): BankAccount {
    // Vendors type account numbers with spaces and hyphens copied from a
    // passbook or cheque; the same account must fingerprint identically
    // however it was entered, so separators are stripped before anything else.
    const accountNumber = input.accountNumber.replace(/[\s-]/g, '');
    const ifsc = input.ifsc.trim().toUpperCase();

    if (!/^[0-9]+$/.test(accountNumber)) {
      throw new InvalidKycIdentifierError('accountNumber', 'must contain digits only');
    }
    if (accountNumber.length < ACCOUNT_MIN_LENGTH || accountNumber.length > ACCOUNT_MAX_LENGTH) {
      throw new InvalidKycIdentifierError(
        'accountNumber',
        `must be between ${ACCOUNT_MIN_LENGTH} and ${ACCOUNT_MAX_LENGTH} digits`,
      );
    }
    if (!IFSC_PATTERN.test(ifsc)) {
      throw new InvalidKycIdentifierError('ifsc', 'must be an eleven-character IFSC');
    }

    return new BankAccount(accountNumber, ifsc);
  }

  /**
   * What the fingerprint is computed over. The IFSC is included because an
   * account number alone is not unique across banks — two vendors at different
   * banks can legitimately share one, and treating that as a duplicate would
   * block an honest vendor.
   */
  get canonical(): string {
    return `${this.ifsc}:${this.accountNumber}`;
  }

  /** The only part of the account number ever stored or displayed (SDD 12.3). */
  get last4(): string {
    return this.accountNumber.slice(-LAST_DIGITS);
  }

  equals(other: BankAccount): boolean {
    return this.canonical === other.canonical;
  }

  /** Masked, for the same reason `Pan.toString` is. */
  toString(): string {
    return `${this.ifsc}••••${this.last4}`;
  }
}
