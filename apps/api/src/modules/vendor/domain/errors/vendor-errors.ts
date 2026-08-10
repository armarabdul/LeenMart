import { type AppErrorOptions, ConflictError, ForbiddenError } from '@leen-mart/domain-kit';

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
