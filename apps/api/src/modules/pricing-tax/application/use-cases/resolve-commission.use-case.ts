import type { Clock, Money } from '@leen-mart/domain-kit';
import type { VendorPlanName } from '../../../vendor/index.js';
import type { CommissionRule } from '../../domain/entities/commission-rule.entity.js';
import { CommissionRuleNotFoundError } from '../../domain/errors/pricing-tax-errors.js';
import type { CommissionRuleRepository } from '../../domain/repositories/commission-rule.repository.js';

export interface ResolveCommissionInput {
  readonly plan: VendorPlanName;
  readonly amount: Money;
  /** Defaults to `clock.now()` — pass explicitly to resolve the rate that applied at a past instant. */
  readonly asOf?: Date;
}

export interface CommissionResolution {
  readonly rule: CommissionRule;
  readonly commissionAmount: Money;
}

export interface ResolveCommissionDeps {
  readonly commissionRuleRepository: CommissionRuleRepository;
  readonly clock: Clock;
}

/**
 * Resolves the commission owed on `amount` for a vendor on `plan`, as of a
 * point in time (D-S3-01). Approved to be "fully functional" — unlike tax
 * resolution, an unresolvable commission is treated as exceptional
 * (`CommissionRuleNotFoundError`), not an expected state, because the
 * migration seeds a rule for every `VendorPlan` value from a fixed baseline
 * date onward.
 */
export class ResolveCommissionUseCase {
  constructor(private readonly deps: ResolveCommissionDeps) {}

  async execute(input: ResolveCommissionInput): Promise<CommissionResolution> {
    const { commissionRuleRepository, clock } = this.deps;
    const asOf = input.asOf ?? clock.now();

    const rule = await commissionRuleRepository.findEffectiveForPlan(input.plan, asOf);
    if (!rule) {
      throw new CommissionRuleNotFoundError();
    }

    const commissionAmount = input.amount.percentageOf(rule.rateBasisPoints / 100);
    return { rule, commissionAmount };
  }
}
