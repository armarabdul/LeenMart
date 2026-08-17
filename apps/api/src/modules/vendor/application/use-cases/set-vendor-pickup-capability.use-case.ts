import type { Clock, Logger } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import type { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import { VendorProfileNotFoundError } from '../../domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';

export interface SetVendorPickupCapabilityInput {
  readonly principal: Principal;
  readonly supportsPickup: boolean;
}

export interface SetVendorPickupCapabilityDeps {
  readonly vendorRepository: VendorRepository;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * A vendor declares whether they offer `PICKUP` at all (S4-QR). Gated by
 * `MANAGE_SHOP_PROFILE` — the same permission `SetVendorShopNameUseCase`
 * already uses, since this is another self-service shop-profile attribute,
 * not a new capability. `PlaceOrderUseCase` checks this exact flag
 * (`VendorProfile.supportsPickup`) before accepting a `PICKUP` request for
 * this vendor and never silently downgrades an unsupported one to `DELIVERY`
 * (locked decision #25).
 *
 * No transaction: a single-row update to a mutable capability flag, the same
 * shape `SetVendorShopNameUseCase` already uses for a comparable write.
 */
export class SetVendorPickupCapabilityUseCase {
  constructor(private readonly deps: SetVendorPickupCapabilityDeps) {}

  async execute(input: SetVendorPickupCapabilityInput): Promise<VendorProfile> {
    const { vendorRepository, clock, logger } = this.deps;
    const { principal, supportsPickup } = input;

    const vendor = await vendorRepository.findByUserId(principal.userId);
    if (!vendor) {
      throw new VendorProfileNotFoundError();
    }

    const updated = vendor.updatePickupCapability(supportsPickup, clock.now());
    await vendorRepository.update(updated);

    logger.info({ vendorId: vendor.id, supportsPickup }, 'Vendor set their pickup capability');
    return updated;
  }
}
