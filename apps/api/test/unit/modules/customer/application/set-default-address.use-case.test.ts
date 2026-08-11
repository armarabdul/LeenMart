import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { toUserId, type Principal } from '../../../../../src/modules/identity/index.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { AddAddressUseCase } from '../../../../../src/modules/customer/application/use-cases/add-address.use-case.js';
import { SetDefaultAddressUseCase } from '../../../../../src/modules/customer/application/use-cases/set-default-address.use-case.js';
import { AddressNotFoundError } from '../../../../../src/modules/customer/domain/errors/customer-errors.js';
import { toAddressId } from '../../../../../src/modules/customer/domain/value-objects/address-id.value-object.js';
import type { AddressDetails } from '../../../../../src/modules/customer/domain/entities/address.entity.js';
import { InMemoryAddressRepository, nullLogger } from './fakes.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const userId = toUserId('00000000-0000-7000-8000-0000000001a1');
const otherUserId = toUserId('00000000-0000-7000-8000-0000000001a2');
const sessionId = toSessionId('00000000-0000-7000-8000-00000000e5d0');
const principal: Principal = { userId, sessionId, role: 'CUSTOMER' };

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
  setDefaultUseCase: SetDefaultAddressUseCase;
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
  const setDefaultUseCase = new SetDefaultAddressUseCase({
    addressRepository,
    clock,
    logger: nullLogger,
  });
  return { addUseCase, setDefaultUseCase, addressRepository };
};

describe('SetDefaultAddressUseCase', () => {
  it('makes the target address the default', async () => {
    const { addUseCase, setDefaultUseCase } = setup();
    await addUseCase.execute({ principal, details }); // first -> default
    const second = await addUseCase.execute({ principal, details: { ...details, label: 'Work' } });

    const result = await setDefaultUseCase.execute({ principal, addressId: second.id });

    expect(result.isDefault).toBe(true);
  });

  it('unsets the previous default at the same time', async () => {
    const { addUseCase, setDefaultUseCase, addressRepository } = setup();
    const first = await addUseCase.execute({ principal, details });
    const second = await addUseCase.execute({ principal, details: { ...details, label: 'Work' } });

    await setDefaultUseCase.execute({ principal, addressId: second.id });

    const refetchedFirst = await addressRepository.findById(first.id, userId);
    expect(refetchedFirst?.isDefault).toBe(false);
  });

  it('never results in more than one default address for the customer', async () => {
    const { addUseCase, setDefaultUseCase, addressRepository } = setup();
    await addUseCase.execute({ principal, details });
    const second = await addUseCase.execute({ principal, details: { ...details, label: 'Work' } });
    const third = await addUseCase.execute({ principal, details: { ...details, label: 'Office' } });

    await setDefaultUseCase.execute({ principal, addressId: second.id });
    await setDefaultUseCase.execute({ principal, addressId: third.id });

    const all = await addressRepository.findAllByUserId(userId);
    expect(all.filter((address) => address.isDefault)).toHaveLength(1);
  });

  it('rejects an unknown address id', async () => {
    const { setDefaultUseCase } = setup();

    await expect(
      setDefaultUseCase.execute({
        principal,
        addressId: toAddressId('00000000-0000-7000-8000-0000000001a9'),
      }),
    ).rejects.toBeInstanceOf(AddressNotFoundError);
  });

  it('rejects an address id belonging to another customer, identically to unknown', async () => {
    const { addUseCase, setDefaultUseCase } = setup();
    const address = await addUseCase.execute({ principal, details });

    const unknownError: unknown = await setDefaultUseCase
      .execute({ principal, addressId: toAddressId('00000000-0000-7000-8000-0000000001a9') })
      .catch((error: unknown) => error);
    const crossOwnerError: unknown = await setDefaultUseCase
      .execute({
        principal: { userId: otherUserId, sessionId, role: 'CUSTOMER' },
        addressId: address.id,
      })
      .catch((error: unknown) => error);

    expect(unknownError).toBeInstanceOf(AddressNotFoundError);
    expect(crossOwnerError).toBeInstanceOf(AddressNotFoundError);
    expect((unknownError as Error).message).toBe((crossOwnerError as Error).message);
  });
});
