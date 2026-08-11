import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import { Address, type AddressDetails } from '../../domain/entities/address.entity.js';
import { AddressDefaultConflictError } from '../../domain/errors/customer-errors.js';
import type { AddressRepository } from '../../domain/repositories/address.repository.js';
import { toAddressId } from '../../domain/value-objects/address-id.value-object.js';

export interface AddAddressInput {
  readonly principal: Principal;
  readonly details: AddressDetails;
}

export interface AddAddressDeps {
  readonly addressRepository: AddressRepository;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Adds a new address to the caller's own address book (SDD Stage 1). A
 * customer's very first address becomes their default automatically — the
 * alternative (no default until a separate, explicit call) would leave
 * every brand-new customer unable to check out without a second manual
 * step for a case that only ever has one right answer.
 *
 * The address itself is always created non-default first, then promoted via
 * the repository's own atomic `setDefault()` — reusing the one place that
 * already handles the "two concurrent first adds" race, rather than
 * duplicating that handling here. If the promotion loses that race (another
 * concurrent add legitimately became default first), it's swallowed: the
 * address was still created successfully, and *some* default now exists for
 * this customer, which is all the "never leave a new customer with zero
 * defaults" goal actually requires.
 */
export class AddAddressUseCase {
  constructor(private readonly deps: AddAddressDeps) {}

  async execute(input: AddAddressInput): Promise<Address> {
    const { addressRepository, idGenerator, clock, logger } = this.deps;
    const { principal, details } = input;

    const existing = await addressRepository.findAllByUserId(principal.userId);
    const now = clock.now();
    const address = Address.add({
      id: toAddressId(idGenerator.generate()),
      userId: principal.userId,
      details,
      isDefault: false,
      now,
    });
    await addressRepository.create(address);

    if (existing.length === 0) {
      try {
        await addressRepository.setDefault(address.id, principal.userId, now);
        logger.info(
          { userId: principal.userId, addressId: address.id },
          'First address auto-defaulted',
        );
        return address.markAsDefault(now);
      } catch (error) {
        if (error instanceof AddressDefaultConflictError) {
          logger.info(
            { userId: principal.userId, addressId: address.id },
            'Address added, but lost the auto-default race to a concurrent add',
          );
          return address;
        }
        throw error;
      }
    }

    logger.info({ userId: principal.userId, addressId: address.id }, 'Address added');
    return address;
  }
}
