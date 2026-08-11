import type { Clock, Logger } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import { AddressNotFoundError } from '../../domain/errors/customer-errors.js';
import type { AddressRepository } from '../../domain/repositories/address.repository.js';
import type { AddressId } from '../../domain/value-objects/address-id.value-object.js';

export interface RemoveAddressInput {
  readonly principal: Principal;
  readonly addressId: AddressId;
}

export interface RemoveAddressDeps {
  readonly addressRepository: AddressRepository;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Soft-deletes an address (SDD's `deleted_at` convention — a past order may
 * still reference this address, so it must remain resolvable, not vanish).
 * Ownership-checked first, same uniform-404 reasoning as update. Deleting
 * the default address does not auto-promote another one: the customer picks
 * a new default explicitly, rather than this operation silently guessing
 * which address they'd want instead.
 */
export class RemoveAddressUseCase {
  constructor(private readonly deps: RemoveAddressDeps) {}

  async execute(input: RemoveAddressInput): Promise<void> {
    const { addressRepository, clock, logger } = this.deps;
    const { principal, addressId } = input;

    const existing = await addressRepository.findById(addressId, principal.userId);
    if (!existing) {
      throw new AddressNotFoundError();
    }

    const removed = await addressRepository.remove(addressId, principal.userId, clock.now());
    if (!removed) {
      throw new AddressNotFoundError();
    }

    logger.info({ userId: principal.userId, addressId }, 'Address removed');
  }
}
