import { InvalidKycIdentifierError } from '../errors/kyc-errors.js';

/**
 * 15 characters: a 2-digit state code, the holder's 10-character PAN, a
 * 1-character entity number, the literal `Z`, and a check character.
 */
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/** The GSTIN check character is computed in base 36 over this ordering. */
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const CHECKSUM_INPUT_LENGTH = 14;

/**
 * The published GSTIN check-character algorithm: weight each of the first
 * fourteen characters alternately by 1 and 2, fold each product back into base
 * 36 (quotient plus remainder), and the check character completes the sum to a
 * multiple of 36.
 *
 * SDD 15.1 names "GSTIN checksum" as a verification check, and this is it —
 * arithmetic over the string, no network. It proves the number is internally
 * consistent, not that it is registered or active; that is the GST API status
 * lookup SDD 15.1 also names, which V1 defers.
 */
const checkCharacterFor = (first14: string): string => {
  let sum = 0;
  for (let position = 0; position < CHECKSUM_INPUT_LENGTH; position += 1) {
    const value = CHARSET.indexOf(first14[position] ?? '');
    const weighted = value * (position % 2 === 0 ? 1 : 2);
    sum += Math.floor(weighted / CHARSET.length) + (weighted % CHARSET.length);
  }
  return CHARSET[(CHARSET.length - (sum % CHARSET.length)) % CHARSET.length] ?? '';
};

/**
 * A vendor's GSTIN (BR-13: "capture vendor GSTIN at KYC").
 *
 * Unlike `Pan` and `BankAccount`, a GSTIN is **not** treated as a secret and
 * is stored in full. BR-13 is why: as an e-commerce operator the platform
 * files GSTR-8 and issues tax invoices naming the vendor of record (SDD 5,
 * module 13), and both carry the supplier's GSTIN in full. A fingerprint
 * cannot be printed on an invoice or filed with a return, so the whole value
 * has to survive to persistence. SDD 18.2's redaction allowlist agrees by
 * omission: it names PAN, Aadhaar and bank details, and not GSTIN.
 *
 * Characters 3–12 of a GSTIN are the holder's PAN by construction, so storing
 * it whole necessarily discloses that PAN. See `VendorKyc` for what that costs
 * and why it is a property of the required data rather than a reason to add a
 * second plaintext copy.
 */
export class Gstin {
  private constructor(public readonly value: string) {}

  static create(value: string): Gstin {
    const canonical = value.trim().toUpperCase();

    if (!GSTIN_PATTERN.test(canonical)) {
      throw new InvalidKycIdentifierError(
        'gstin',
        'must be fifteen characters in the GSTIN format',
      );
    }
    if (canonical.slice(CHECKSUM_INPUT_LENGTH) !== checkCharacterFor(canonical)) {
      // Deliberately distinguished from a shape failure: a mistyped GSTIN
      // passes the pattern and fails here, and telling the vendor which is
      // wrong is the difference between a fixable error and a mystery.
      throw new InvalidKycIdentifierError('gstin', 'check character does not match the GSTIN');
    }
    return new Gstin(canonical);
  }

  equals(other: Gstin): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
