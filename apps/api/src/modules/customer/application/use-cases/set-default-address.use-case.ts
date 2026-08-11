import type { Clock, Logger } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import type { Address } from '../../domain/entities/address.entity.js';
import { AddressNotFoundError } from '../../domain/errors/customer-errors.js';
import type { AddressRepository } from '../../domain/repositories/address.repository.js';
import type { AddressId } from '../../domain/value-objects/address-id.value-object.js';

export interface SetDefaultAddressInput {
  readonly principal: Principal;
  readonly addressId: AddressId;
}

export interface SetDefaultAddressDeps {
  readonly addressRepository: AddressRepository;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Makes one address the caller's default, atomically unsetting whichever
 * one previously held that status (SDD Stage 1 address-book behaviour).
 * Ownership-checked first (uniform 404 for missing/not-owned, same as
 * update/remove); the actual clear-then-set is the repository's
 * `setDefault()`, a single database transaction guarded by a partial
 * unique index — this use case does not attempt its own read-then-write,
 * which is exactly the kind of check that a concurrent second call could
 * race past.
 */
export class SetDefaultAddressUseCase {
  constructor(private readonly deps: SetDefaultAddressDeps) {}

  async execute(input: SetDefaultAddressInput): Promise<Address> {
    const { addressRepository, clock, logger } = this.deps;
    const { principal, addressId } = input;

    const existing = await addressRepository.findById(addressId, principal.userId);
    if (!existing) {
      throw new AddressNotFoundError();
    }

    const now = clock.now();
    const applied = await addressRepository.setDefault(addressId, principal.userId, now);
    if (!applied) {
      throw new AddressNotFoundError();
    }

    logger.info({ userId: principal.userId, addressId }, 'Default address changed');
    return existing.markAsDefault(now);
  }
}
