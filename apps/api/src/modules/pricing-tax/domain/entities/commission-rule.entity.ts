import type { VendorPlanName } from '../../../vendor/index.js';
import { InvalidCommissionRuleError } from '../errors/pricing-tax-errors.js';
import type { CommissionRuleId } from '../value-objects/commission-rule-id.value-object.js';

const MAX_RATE_BASIS_POINTS = 10_000;

export interface CommissionRuleProps {
  readonly id: CommissionRuleId;
  readonly plan: VendorPlanName;
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
    throw new InvalidCommissionRuleError(
      'Must be a whole number of basis points between 0 and 10000.',
    );
  }
};

/**
 * A commission rate effective from a point in time, for one vendor plan
 * (S3-2, D-S3-01). Append-only by convention (this schema's own stated
 * principle: financial-adjacent config is corrected with a new row, never an
 * edit) — there is deliberately no method here that changes an existing
 * rule's rate or `effectiveFrom`; a rate change is always a new `create()`.
 *
 * `rateBasisPoints` (0–10000) is an integer, matching this schema's
 * money-adjacent convention of never using a float for anything that will be
 * multiplied against `Money` — 10% is 1000, 0% is 0.
 */
export class CommissionRule {
  private constructor(private readonly props: CommissionRuleProps) {}

  static create(props: {
    id: CommissionRuleId;
    plan: VendorPlanName;
    rateBasisPoints: number;
    effectiveFrom: Date;
    now: Date;
  }): CommissionRule {
    assertValidRate(props.rateBasisPoints);
    return new CommissionRule({
      id: props.id,
      plan: props.plan,
      rateBasisPoints: props.rateBasisPoints,
      effectiveFrom: props.effectiveFrom,
      createdAt: props.now,
    });
  }

  static reconstitute(props: CommissionRuleProps): CommissionRule {
    return new CommissionRule(props);
  }

  get id(): CommissionRuleId {
    return this.props.id;
  }

  get plan(): VendorPlanName {
    return this.props.plan;
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
