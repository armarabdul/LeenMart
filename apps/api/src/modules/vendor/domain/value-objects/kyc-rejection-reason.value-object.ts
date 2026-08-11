import { InvalidKycIdentifierError } from '../errors/kyc-errors.js';

/**
 * Why a KYC submission was refused.
 *
 * **SDD 15.1 defines no vocabulary for this.** Its only reason codes belong to
 * §15.2's *product* moderation machine, which is a different state machine for
 * a different decision — so this set is a project decision, kept deliberately
 * small (D7: "small closed rejection reason enum").
 *
 * Every member maps to a concrete failure a reviewer of the three V1 documents
 * can actually reach; none is aspirational:
 *
 *  * `DOCUMENT_UNCLEAR` — the upload cannot be read.
 *  * `DOCUMENT_INVALID` — it is readable but is not the document claimed, or
 *    has been altered.
 *  * `DETAILS_MISMATCH` — SDD 15.1's "name match": the document does not agree
 *    with the submitted identifiers.
 *  * `BANK_DETAILS_MISMATCH` — the bank proof does not match the account given
 *    (D2's manual stand-in for penny-drop).
 *  * `DUPLICATE_IDENTITY` — SEC-17: these identifiers already belong to another
 *    vendor.
 *  * `OTHER` — the escape hatch, and the one case where free text is required
 *    rather than optional.
 *
 * There is deliberately no `GSTIN_INVALID` or `PAN_INVALID`: both are checked
 * deterministically at submission by `Gstin` and `Pan`, so a submission
 * carrying a malformed one never reaches a reviewer.
 */
export type KycRejectionReasonName =
  | 'DOCUMENT_UNCLEAR'
  | 'DOCUMENT_INVALID'
  | 'DETAILS_MISMATCH'
  | 'BANK_DETAILS_MISMATCH'
  | 'DUPLICATE_IDENTITY'
  | 'OTHER';

export class KycRejectionReason {
  private constructor(public readonly name: KycRejectionReasonName) {}

  static readonly DOCUMENT_UNCLEAR = new KycRejectionReason('DOCUMENT_UNCLEAR');
  static readonly DOCUMENT_INVALID = new KycRejectionReason('DOCUMENT_INVALID');
  static readonly DETAILS_MISMATCH = new KycRejectionReason('DETAILS_MISMATCH');
  static readonly BANK_DETAILS_MISMATCH = new KycRejectionReason('BANK_DETAILS_MISMATCH');
  static readonly DUPLICATE_IDENTITY = new KycRejectionReason('DUPLICATE_IDENTITY');
  static readonly OTHER = new KycRejectionReason('OTHER');

  private static readonly BY_NAME: Readonly<Record<KycRejectionReasonName, KycRejectionReason>> = {
    DOCUMENT_UNCLEAR: KycRejectionReason.DOCUMENT_UNCLEAR,
    DOCUMENT_INVALID: KycRejectionReason.DOCUMENT_INVALID,
    DETAILS_MISMATCH: KycRejectionReason.DETAILS_MISMATCH,
    BANK_DETAILS_MISMATCH: KycRejectionReason.BANK_DETAILS_MISMATCH,
    DUPLICATE_IDENTITY: KycRejectionReason.DUPLICATE_IDENTITY,
    OTHER: KycRejectionReason.OTHER,
  };

  static fromName(name: string): KycRejectionReason {
    const reason = (KycRejectionReason.BY_NAME as Record<string, KycRejectionReason | undefined>)[
      name
    ];
    if (!reason) {
      throw new InvalidKycIdentifierError(
        'rejectionReason',
        `must be one of: ${Object.keys(KycRejectionReason.BY_NAME).join(', ')}`,
      );
    }
    return reason;
  }

  /** `OTHER` says nothing on its own, so it is the one reason that must be explained. */
  requiresExplanation(): boolean {
    return this.name === 'OTHER';
  }

  equals(other: KycRejectionReason): boolean {
    return this.name === other.name;
  }

  toString(): string {
    return this.name;
  }
}
