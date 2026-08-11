import {
  type AppErrorOptions,
  ConflictError,
  DomainRuleError,
  ForbiddenError,
} from '@leen-mart/domain-kit';
import type { VendorStatusName } from '../value-objects/vendor-status.value-object.js';

/**
 * One account holds at most one vendor profile — the `vendors.user_id`
 * unique constraint enforces the same rule at the database level, so this
 * is the friendly form of a guarantee that holds either way.
 */
export class VendorAlreadyRegisteredError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This account already has a vendor profile.', {
      ...options,
      code: 'VENDOR_ALREADY_REGISTERED',
    });
  }
}

/**
 * Vendor registration is customer self-service: the authenticated caller
 * must hold the CUSTOMER role. Deliberately does not say *which* role the
 * caller actually holds — that is the caller's own account detail and
 * nothing is gained by echoing it back.
 */
export class VendorRegistrationNotAllowedError extends ForbiddenError {
  constructor(options: AppErrorOptions = {}) {
    super('This account may not register as a vendor.', {
      ...options,
      code: 'VENDOR_REGISTRATION_NOT_ALLOWED',
    });
  }
}

/**
 * A move the SDD 15.1 lifecycle does not draw — valid input, disallowed
 * outcome, which is exactly what `DomainRuleError` (HTTP 422) is for.
 *
 * One error for every illegal edge rather than a class per case: the
 * lifecycle has seven legal transitions and far more illegal ones, and a
 * client can tell them apart from `details` without the codebase carrying a
 * name for each. A specific code can be split out if and when an endpoint
 * proves it needs to branch on one.
 *
 * Naming both states is safe here: a vendor asking about their own profile is
 * entitled to know it, and no other principal can reach a transition on it.
 */
export class InvalidVendorStatusTransitionError extends DomainRuleError {
  constructor(from: VendorStatusName, to: VendorStatusName, options: AppErrorOptions = {}) {
    super('VENDOR_INVALID_STATUS_TRANSITION', `A vendor cannot move from ${from} to ${to}.`, {
      ...options,
      details: options.details ?? [
        { field: 'status', issue: `${from} → ${to} is not a permitted transition` },
      ],
    });
  }
}
