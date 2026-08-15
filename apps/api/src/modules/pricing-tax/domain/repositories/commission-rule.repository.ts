import type { TransactionScope } from '@leen-mart/domain-kit';
import type { VendorPlanName } from '../../../vendor/index.js';
import type { CommissionRule } from '../entities/commission-rule.entity.js';

export interface CommissionRuleRepository {
  /** Re-binds to a transaction the caller already opened. Same shape every other repository in this codebase publishes. */
  withTransaction(scope: TransactionScope): CommissionRuleRepository;

  create(rule: CommissionRule): Promise<void>;

  /**
   * The rule in effect for `plan` at `asOf` — the most recent row with
   * `effectiveFrom <= asOf`. `null` means no rule has ever been configured
   * for this plan as of that instant (see `CommissionRuleNotFoundError`'s
   * own doc comment for when that can genuinely happen).
   */
  findEffectiveForPlan(plan: VendorPlanName, asOf: Date): Promise<CommissionRule | null>;
}
