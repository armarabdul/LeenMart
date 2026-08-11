import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { toUserId, type Principal } from '../../../../../src/modules/identity/index.js';
import { AddAddressUseCase } from '../../../../../src/modules/customer/application/use-cases/add-address.use-case.js';
import { RemoveAddressUseCase } from '../../../../../src/modules/customer/application/use-cases/remove-address.use-case.js';
import { AddressNotFoundError } from '../../../../../src/modules/customer/domain/errors/customer-errors.js';
import { toAddressId } from '../../../../../src/modules/customer/domain/value-objects/address-id.value-object.js';
import type { AddressDetails } from '../../../../../src/modules/customer/domain/entities/address.entity.js';
import { InMemoryAddressRepository, nullLogger } from './fakes.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const userId = toUserId('00000000-0000-7000-8000-0000000000f1');
const otherUserId = toUserId('00000000-0000-7000-8000-0000000000f2');
const principal: Principal = { userId, role: 'CUSTOMER' };

const details: AddressDetails = {
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  landmark: null,
  label: 'Home',
};

const setup = (): {
  addUseCase: AddAddressUseCase;
  removeUseCase: RemoveAddressUseCase;
  addressRepository: InMemoryAddressRepository;
} => {
  const addressRepository = new InMemoryAddressRepository();
  const idGenerator = new UuidV7Generator();
  const clock = new FixedClock(NOW);
  const addUseCase = new AddAddressUseCase({
    addressRepository,
    idGenerator,
    clock,
    logger: nullLogger,
  });
  const removeUseCase = new RemoveAddressUseCase({ addressRepository, clock, logger: nullLogger });
  return { addUseCase, removeUseCase, addressRepository };
};

describe('RemoveAddressUseCase', () => {
  it('removes the address', async () => {
    const { addUseCase, removeUseCase, addressRepository } = setup();
    const address = await addUseCase.execute({ principal, details });

    await removeUseCase.execute({ principal, addressId: address.id });

    const found = await addressRepository.findById(address.id, userId);
    expect(found).toBeNull();
  });

  it('rejects an unknown address id', async () => {
    const { removeUseCase } = setup();

    await expect(
      removeUseCase.execute({
        principal,
        addressId: toAddressId('00000000-0000-7000-8000-0000000000f9'),
      }),
    ).rejects.toBeInstanceOf(AddressNotFoundError);
  });

  it('rejects an address id belonging to another customer, identically to unknown', async () => {
    const { addUseCase, removeUseCase } = setup();
    const address = await addUseCase.execute({ principal, details });

    const unknownError: unknown = await removeUseCase
      .execute({ principal, addressId: toAddressId('00000000-0000-7000-8000-0000000000f9') })
      .catch((error: unknown) => error);
    const crossOwnerError: unknown = await removeUseCase
      .execute({ principal: { userId: otherUserId, role: 'CUSTOMER' }, addressId: address.id })
      .catch((error: unknown) => error);

    expect(unknownError).toBeInstanceOf(AddressNotFoundError);
    expect(crossOwnerError).toBeInstanceOf(AddressNotFoundError);
    expect((unknownError as Error).message).toBe((crossOwnerError as Error).message);
  });

  it('does not remove another customer’s address', async () => {
    const { addUseCase, removeUseCase, addressRepository } = setup();
    const address = await addUseCase.execute({ principal, details });

    await expect(
      removeUseCase.execute({
        principal: { userId: otherUserId, role: 'CUSTOMER' },
        addressId: address.id,
      }),
    ).rejects.toBeInstanceOf(AddressNotFoundError);

    const stillThere = await addressRepository.findById(address.id, userId);
    expect(stillThere).not.toBeNull();
  });
});
