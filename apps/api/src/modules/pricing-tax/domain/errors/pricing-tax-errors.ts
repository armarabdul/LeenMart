import { type AppErrorOptions, DomainRuleError, NotFoundError } from '@leen-mart/domain-kit';

/**
 * `rateBasisPoints` outside 0–10000 (0%–100%). Mirrors
 * `InvalidInventoryOperationError`'s shape, including the uniform message
 * (SEC-15): what names the broken rule is `details[0]`. `chk_commission_rules_rate_basis_points_range`
 * is the copy that survives an application bug.
 */
export class InvalidCommissionRuleError extends DomainRuleError {
  constructor(issue: string, options: AppErrorOptions = {}) {
    super('INVALID_COMMISSION_RULE', 'This commission rule is not valid.', {
      ...options,
      details: [{ field: 'rateBasisPoints', issue }],
    });
  }
}

/** Same shape as `InvalidCommissionRuleError`, for `tax_rates` and `chk_tax_rates_rate_basis_points_range`. */
export class InvalidTaxRateError extends DomainRuleError {
  constructor(issue: string, options: AppErrorOptions = {}) {
    super('INVALID_TAX_RATE', 'This tax rate is not valid.', {
      ...options,
      details: [{ field: 'rateBasisPoints', issue }],
    });
  }
}

/**
 * No `CommissionRule` resolves for a plan as of a given instant — a genuine
 * anomaly, not an expected state: `20260815090000_add_pricing_tax_foundation`
 * seeds one row for every `VendorPlan` value effective from a fixed baseline
 * date, so this should only ever fire for an `asOf` predating that seed (a
 * defensive case, not a real V1 scenario) or a future `VendorPlan` value
 * added without a corresponding rule. Deliberately thrown rather than
 * returned — unlike `ResolveTaxUseCase`'s tax-rate lookup, commission
 * resolution is approved to be "fully functional" (D-S3-01), so an
 * unresolved commission is this codebase's definition of exceptional.
 */
export class CommissionRuleNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('No commission rule is configured for this plan.', {
      ...options,
      code: 'COMMISSION_RULE_NOT_FOUND',
    });
  }
}
