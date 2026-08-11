import { type AppErrorOptions, ConflictError, NotFoundError } from '@leen-mart/domain-kit';

/**
 * Covers both "this address never existed" and "this address exists but
 * belongs to someone else" — identically, on purpose. Mirrors SDD 6.6's
 * cross-tenant testing convention ("Vendor A receives 404 for Vendor B's
 * resource"): a non-owner learning that *an* address exists at a given id,
 * just not theirs, is exactly the kind of resource-existence leak tenant
 * scoping exists to prevent.
 */
export class AddressNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('This address does not exist.', { ...options, code: 'ADDRESS_NOT_FOUND' });
  }
}

/**
 * Thrown when `setDefault()` loses a race against a concurrent "set
 * default" call for the same customer — the partial unique index
 * (`idx_addresses_one_default_per_user`) is the actual arbiter, the same
 * "database decides who wins" pattern `MfaSecretAlreadyExistsError` and
 * `consumeIfActive` already established. Distinct from `AddressNotFoundError`
 * on purpose: the address is real and owned by this caller, it just lost a
 * timing race, so a retry is the correct client response — not a 404.
 */
export class AddressDefaultConflictError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('Another request already changed the default address. Please try again.', {
      ...options,
      code: 'ADDRESS_DEFAULT_CONFLICT',
    });
  }
}
