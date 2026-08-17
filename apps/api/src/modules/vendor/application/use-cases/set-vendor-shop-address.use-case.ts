import type { Clock, Logger } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import type {
  VendorProfile,
  VendorShopAddress,
} from '../../domain/entities/vendor-profile.entity.js';
import { VendorProfileNotFoundError } from '../../domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';

export interface SetVendorShopAddressInput {
  readonly principal: Principal;
  readonly shopAddress: VendorShopAddress;
}

export interface SetVendorShopAddressDeps {
  readonly vendorRepository: VendorRepository;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * A vendor sets or replaces their own shop address (S4-ADDR). Gated by
 * `MANAGE_SHOP_PROFILE` — the same already-existing SDD 8.2 permission
 * (`VENDOR_OWNER`/`VENDOR_MANAGER`: `OWN`) that `/me/shop-profile` and
 * `/me/pickup-capability` already use. This is another self-service
 * shop-profile attribute, not a new capability.
 *
 * The vendor is resolved from `principal.userId` and a vendor id is never
 * accepted from the request — the same discipline every other `/me/*` vendor
 * route follows, and what makes "vendor A cannot edit vendor B's address"
 * true by construction rather than by a check that could be forgotten.
 *
 * No transaction: a single-row update to mutable profile attributes, the same
 * shape `SetVendorShopNameUseCase` and `SetVendorPickupCapabilityUseCase`
 * already use.
 *
 * No audit record, deliberately. The existing shop-profile writes
 * (`shopName`, `supportsPickup`) record a structured log line and nothing
 * more; `auditWriter` in this module is reserved for KYC and admin decisions
 * (`submit-vendor-kyc`, `decide-vendor-kyc`, `activate-vendor`,
 * `access-kyc-document`). Following that established pattern rather than
 * inventing a new audit policy for a comparable write.
 */
export class SetVendorShopAddressUseCase {
  constructor(private readonly deps: SetVendorShopAddressDeps) {}

  async execute(input: SetVendorShopAddressInput): Promise<VendorProfile> {
    const { vendorRepository, clock, logger } = this.deps;
    const { principal, shopAddress } = input;

    const vendor = await vendorRepository.findByUserId(principal.userId);
    if (!vendor) {
      throw new VendorProfileNotFoundError();
    }

    const updated = vendor.updateShopAddress(shopAddress, clock.now());
    await vendorRepository.update(updated);

    // The address itself is not logged: it is the vendor's business premises,
    // and the log only needs to say that it changed and for whom.
    logger.info({ vendorId: vendor.id }, 'Vendor set their shop address');
    return updated;
  }
}
