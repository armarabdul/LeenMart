import type { Clock, Logger } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import type { Address, AddressDetails } from '../../domain/entities/address.entity.js';
import { AddressNotFoundError } from '../../domain/errors/customer-errors.js';
import type { AddressRepository } from '../../domain/repositories/address.repository.js';
import type { AddressId } from '../../domain/value-objects/address-id.value-object.js';

export interface UpdateAddressInput {
  readonly principal: Principal;
  readonly addressId: AddressId;
  readonly details: Partial<AddressDetails>;
}

export interface UpdateAddressDeps {
  readonly addressRepository: AddressRepository;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Partial update (PATCH semantics — only supplied fields change). Looks the
 * address up scoped to `principal.userId` first: a client-supplied id that
 * belongs to someone else, or doesn't exist at all, produces the identical
 * `AddressNotFoundError` either way (SDD 6.6's cross-tenant 404 convention),
 * never a distinguishable 403.
 */
export class UpdateAddressUseCase {
  constructor(private readonly deps: UpdateAddressDeps) {}

  async execute(input: UpdateAddressInput): Promise<Address> {
    const { addressRepository, clock, logger } = this.deps;
    const { principal, addressId, details } = input;

    const existing = await addressRepository.findById(addressId, principal.userId);
    if (!existing) {
      throw new AddressNotFoundError();
    }

    const now = clock.now();
    const updated = existing.updateDetails(details, now);
    const applied = await addressRepository.update(updated, principal.userId);
    if (!applied) {
      // Lost a race against a concurrent delete between the read above and
      // this write — the same "not found" outcome a client sees for any
      // other missing/not-owned address.
      throw new AddressNotFoundError();
    }

    logger.info({ userId: principal.userId, addressId }, 'Address updated');
    return updated;
  }
}
