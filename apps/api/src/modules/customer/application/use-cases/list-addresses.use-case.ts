import type { Principal } from '../../../identity/index.js';
import type { Address } from '../../domain/entities/address.entity.js';
import type { AddressRepository } from '../../domain/repositories/address.repository.js';

export interface ListAddressesInput {
  readonly principal: Principal;
}

export interface ListAddressesDeps {
  readonly addressRepository: AddressRepository;
}

/** Lists the caller's own address book — always scoped to `principal.userId`, never a client-supplied id. */
export class ListAddressesUseCase {
  constructor(private readonly deps: ListAddressesDeps) {}

  async execute(input: ListAddressesInput): Promise<readonly Address[]> {
    return this.deps.addressRepository.findAllByUserId(input.principal.userId);
  }
}
