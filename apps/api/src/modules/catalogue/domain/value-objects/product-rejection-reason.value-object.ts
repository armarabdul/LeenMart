import { InvalidProductOperationError } from '../errors/catalogue-errors.js';

/**
 * Why a product was rejected (S2-5). SDD 15.2 requires "a structured reason
 * code plus optional free text" but defines no vocabulary for it — this set
 * is a project decision, kept deliberately small, mirroring
 * `KycRejectionReason`'s "small closed rejection reason enum" precedent.
 *
 * Every member is reachable by a human reviewer's judgement alone, with no
 * automated engine behind it — S2-5 builds no NSFW classifier, price-anomaly
 * detector or keyword-policy engine, so there is no `NSFW_IMAGE` or
 * `PRICE_ANOMALY_DETECTED` member.
 *
 * See `ProductRejectionReason` in `schema.prisma` for the full reasoning
 * behind each member.
 */
export type ProductRejectionReasonName =
  | 'INCOMPLETE_MANDATORY_FIELDS'
  | 'POLICY_VIOLATION'
  | 'MISLEADING_LISTING'
  | 'DUPLICATE_LISTING'
  | 'PRICING_ISSUE'
  | 'OTHER';

export class ProductRejectionReason {
  private constructor(public readonly name: ProductRejectionReasonName) {}

  static readonly INCOMPLETE_MANDATORY_FIELDS = new ProductRejectionReason(
    'INCOMPLETE_MANDATORY_FIELDS',
  );
  static readonly POLICY_VIOLATION = new ProductRejectionReason('POLICY_VIOLATION');
  static readonly MISLEADING_LISTING = new ProductRejectionReason('MISLEADING_LISTING');
  static readonly DUPLICATE_LISTING = new ProductRejectionReason('DUPLICATE_LISTING');
  static readonly PRICING_ISSUE = new ProductRejectionReason('PRICING_ISSUE');
  static readonly OTHER = new ProductRejectionReason('OTHER');

  private static readonly BY_NAME: Readonly<
    Record<ProductRejectionReasonName, ProductRejectionReason>
  > = {
    INCOMPLETE_MANDATORY_FIELDS: ProductRejectionReason.INCOMPLETE_MANDATORY_FIELDS,
    POLICY_VIOLATION: ProductRejectionReason.POLICY_VIOLATION,
    MISLEADING_LISTING: ProductRejectionReason.MISLEADING_LISTING,
    DUPLICATE_LISTING: ProductRejectionReason.DUPLICATE_LISTING,
    PRICING_ISSUE: ProductRejectionReason.PRICING_ISSUE,
    OTHER: ProductRejectionReason.OTHER,
  };

  static fromName(name: string): ProductRejectionReason {
    const reason = (
      ProductRejectionReason.BY_NAME as Record<string, ProductRejectionReason | undefined>
    )[name];
    if (!reason) {
      throw new InvalidProductOperationError(
        'rejectionReason',
        `must be one of: ${Object.keys(ProductRejectionReason.BY_NAME).join(', ')}`,
      );
    }
    return reason;
  }

  equals(other: ProductRejectionReason): boolean {
    return this.name === other.name;
  }

  toString(): string {
    return this.name;
  }
}
