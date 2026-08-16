import type { UserId } from '../../../identity/index.js';
import type { VendorProfile } from '../../../vendor/domain/entities/vendor-profile.entity.js';
import type { VendorRepository } from '../../../vendor/domain/repositories/vendor.repository.js';
import { VendorNotActiveForEarningsError } from '../../domain/errors/ledger-errors.js';

/**
 * The same ACTIVE gate `order`'s own `requireActiveVendor` enforces (S3-5
 * §A.3), duplicated here rather than imported: that helper lives under
 * `order/application/support/`, an unpublished path `order/index.ts` does
 * not export, and SDD 5.1 only allows crossing a module boundary through its
 * `index.ts`. A ~10-line duplicate is the correct cost of that boundary,
 * not a reason to reach around it.
 */
export const requireActiveVendor = async (
  vendorRepository: VendorRepository,
  userId: UserId,
): Promise<VendorProfile> => {
  const vendor = await vendorRepository.findByUserId(userId);
  if (!vendor || vendor.status.name !== 'ACTIVE') {
    throw new VendorNotActiveForEarningsError();
  }
  return vendor;
};
