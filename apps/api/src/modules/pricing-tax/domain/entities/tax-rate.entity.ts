import { InvalidTaxRateError } from '../errors/pricing-tax-errors.js';
import type { TaxRateId } from '../value-objects/tax-rate-id.value-object.js';

const MAX_RATE_BASIS_POINTS = 10_000;

export interface TaxRateProps {
  readonly id: TaxRateId;
  readonly hsnCode: string;
  readonly rateBasisPoints: number;
  readonly effectiveFrom: Date;
  readonly createdAt: Date;
}

const assertValidRate = (rateBasisPoints: number): void => {
  if (
    !Number.isInteger(rateBasisPoints) ||
    rateBasisPoints < 0 ||
    rateBasisPoints > MAX_RATE_BASIS_POINTS
  ) {
    throw new InvalidTaxRateError('Must be a whole number of basis points between 0 and 10000.');
  }
};

/**
 * A GST/tax rate effective from a point in time, for one HSN/SAC
 * classification (S3-2, D-S3-05). Keyed by `hsnCode` — a nationwide GST
 * classification, not a per-vendor or per-listing attribute, matching the
 * `tax_rates` table's own doc comment in `schema.prisma`.
 *
 * Every row this entity can construct is, by definition, CA-approved: this
 * milestone builds the structure and the resolution path, never invents a
 * rate. Whether *any* row exists for a given HSN code is exactly what
 * `ResolveTaxUseCase` treats as an explicit unresolved state rather than an
 * error — an empty `tax_rates` table is this milestone's correct, intended
 * state, not something this entity works around.
 */
export class TaxRate {
  private constructor(private readonly props: TaxRateProps) {}

  static create(props: {
    id: TaxRateId;
    hsnCode: string;
    rateBasisPoints: number;
    effectiveFrom: Date;
    now: Date;
  }): TaxRate {
    assertValidRate(props.rateBasisPoints);
    return new TaxRate({
      id: props.id,
      hsnCode: props.hsnCode,
      rateBasisPoints: props.rateBasisPoints,
      effectiveFrom: props.effectiveFrom,
      createdAt: props.now,
    });
  }

  static reconstitute(props: TaxRateProps): TaxRate {
    return new TaxRate(props);
  }

  get id(): TaxRateId {
    return this.props.id;
  }

  get hsnCode(): string {
    return this.props.hsnCode;
  }

  get rateBasisPoints(): number {
    return this.props.rateBasisPoints;
  }

  get effectiveFrom(): Date {
    return this.props.effectiveFrom;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
