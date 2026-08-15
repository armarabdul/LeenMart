import type { Clock, Logger } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import type { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import { VendorProfileNotFoundError } from '../../domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';

export interface SetVendorShopNameInput {
  readonly principal: Principal;
  readonly shopName: string;
}

export interface SetVendorShopNameDeps {
  readonly vendorRepository: VendorRepository;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * A vendor sets or changes their own customer-safe shop display name
 * (S3-3A, decision D-S3-03). Gated by `MANAGE_SHOP_PROFILE` — an
 * already-existing SDD 8.2 permission (`VENDOR_OWNER`/`VENDOR_MANAGER`:
 * `OWN`) that had no route until this one, the same "designed for, not yet
 * wired" shape `PLACE_ORDER`/`VIEW_OWN_ORDERS`/`CANCEL_OWN_ORDER` were in
 * before this same milestone gave them callers too.
 *
 * No transaction: a single-row update to a mutable display attribute, the
 * same shape `UpdateAddressUseCase` already uses for a comparable write.
 */
export class SetVendorShopNameUseCase {
  constructor(private readonly deps: SetVendorShopNameDeps) {}

  async execute(input: SetVendorShopNameInput): Promise<VendorProfile> {
    const { vendorRepository, clock, logger } = this.deps;
    const { principal, shopName } = input;

    const vendor = await vendorRepository.findByUserId(principal.userId);
    if (!vendor) {
      throw new VendorProfileNotFoundError();
    }

    const updated = vendor.updateShopName(shopName, clock.now());
    await vendorRepository.update(updated);

    logger.info({ vendorId: vendor.id }, 'Vendor set their shop display name');
    return updated;
  }
}
