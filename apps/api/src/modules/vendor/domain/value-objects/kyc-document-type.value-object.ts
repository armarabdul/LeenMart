import { UnsupportedKycDocumentTypeError } from '../errors/kyc-errors.js';

/**
 * The V1 document set.
 *
 * SDD 15.1 proposes six documents but marks the list "(BR-26 — pending your
 * confirmation)". The confirmed answer is these three. The other three are
 * deferred for stated reasons rather than forgotten:
 *
 *  * **Aadhaar** — SDD 12.3 makes legal review a gate on handling it.
 *  * **FSSAI licence** — category-conditional (BR-17), and no category
 *    taxonomy exists before Stage 2 for it to be conditional on.
 *  * **Shop/establishment proof** — deferred with the rest of the expansion.
 *
 * Adding a member here is a product decision, not a refactor: each one implies
 * a validation rule, a retention obligation and a reviewer instruction.
 */
export type KycDocumentTypeName = 'PAN' | 'BANK_ACCOUNT_PROOF' | 'GSTIN';

export class KycDocumentType {
  private constructor(public readonly name: KycDocumentTypeName) {}

  static readonly PAN = new KycDocumentType('PAN');
  static readonly BANK_ACCOUNT_PROOF = new KycDocumentType('BANK_ACCOUNT_PROOF');
  static readonly GSTIN = new KycDocumentType('GSTIN');

  private static readonly BY_NAME: Readonly<Record<KycDocumentTypeName, KycDocumentType>> = {
    PAN: KycDocumentType.PAN,
    BANK_ACCOUNT_PROOF: KycDocumentType.BANK_ACCOUNT_PROOF,
    GSTIN: KycDocumentType.GSTIN,
  };

  /** Every type a complete submission must carry — currently all of them (SDD 15.1). */
  static readonly REQUIRED: readonly KycDocumentType[] = [
    KycDocumentType.PAN,
    KycDocumentType.BANK_ACCOUNT_PROOF,
    KycDocumentType.GSTIN,
  ];

  /**
   * Rejects anything outside the set rather than falling through to a default.
   * An unrecognised type reaching persistence would be a document nobody knows
   * how to review, retain or erase.
   */
  static fromName(name: string): KycDocumentType {
    const type = (KycDocumentType.BY_NAME as Record<string, KycDocumentType | undefined>)[name];
    if (!type) {
      throw new UnsupportedKycDocumentTypeError({
        details: [
          {
            field: 'documentType',
            issue: `must be one of: ${Object.keys(KycDocumentType.BY_NAME).join(', ')}`,
          },
        ],
      });
    }
    return type;
  }

  equals(other: KycDocumentType): boolean {
    return this.name === other.name;
  }

  toString(): string {
    return this.name;
  }
}
