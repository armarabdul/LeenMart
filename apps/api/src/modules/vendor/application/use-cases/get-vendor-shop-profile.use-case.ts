import type { Principal } from '../../../identity/index.js';
import type { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import { VendorProfileNotFoundError } from '../../domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';

export interface GetVendorShopProfileInput {
  readonly principal: Principal;
}

export interface GetVendorShopProfileDeps {
  readonly vendorRepository: VendorRepository;
}

/**
 * A vendor reads back their own shop profile (S4-ADDR).
 *
 * Exists because the vendor portal's shop-address form has to render the
 * current values before it can offer to change them, and until this milestone
 * the vendor module exposed no read route at all — every `/me/*` route was a
 * write whose response happened to echo the new state back.
 *
 * Resolved from `principal.userId`, never from a request-supplied vendor id,
 * exactly as the sibling write use cases do. Gated by the same
 * `MANAGE_SHOP_PROFILE` permission, so a role that cannot edit the profile
 * cannot read it here either.
 */
export class GetVendorShopProfileUseCase {
  constructor(private readonly deps: GetVendorShopProfileDeps) {}

  async execute(input: GetVendorShopProfileInput): Promise<VendorProfile> {
    const vendor = await this.deps.vendorRepository.findByUserId(input.principal.userId);
    if (!vendor) {
      throw new VendorProfileNotFoundError();
    }
    return vendor;
  }
}
