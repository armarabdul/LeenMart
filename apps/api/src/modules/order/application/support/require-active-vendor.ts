import type { UserId } from '../../../identity/index.js';
import type { VendorProfile } from '../../../vendor/domain/entities/vendor-profile.entity.js';
import type { VendorRepository } from '../../../vendor/domain/repositories/vendor.repository.js';
import { VendorNotActiveForOrdersError } from '../../domain/errors/order-errors.js';

/**
 * The S3-5 ACTIVE gate, shared by all three vendor-order use cases (locked
 * decision #7). Looks up the caller's *own* vendor profile by `userId` — the
 * same lookup `resolveVendorTenant` already performs for `tenantContext`,
 * repeated here because that resolver only ever returns an id, and this
 * check needs the profile's `status` too.
 *
 * No route before S3-5 ever gated on the *requesting* vendor's own status
 * (S3-5 discovery §A.3 confirmed this is a pre-existing gap everywhere else
 * in `vendor`/`catalogue`) — deliberately narrowed to these order routes
 * only, not a general-purpose middleware, per the locked decision.
 */
export const requireActiveVendor = async (
  vendorRepository: VendorRepository,
  userId: UserId,
): Promise<VendorProfile> => {
  const vendor = await vendorRepository.findByUserId(userId);
  if (!vendor || vendor.status.name !== 'ACTIVE') {
    throw new VendorNotActiveForOrdersError();
  }
  return vendor;
};
