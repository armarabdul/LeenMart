import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { toUserId, type Principal } from '../../../../../src/modules/identity/index.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { AddAddressUseCase } from '../../../../../src/modules/customer/application/use-cases/add-address.use-case.js';
import { UpdateAddressUseCase } from '../../../../../src/modules/customer/application/use-cases/update-address.use-case.js';
import { AddressNotFoundError } from '../../../../../src/modules/customer/domain/errors/customer-errors.js';
import { toAddressId } from '../../../../../src/modules/customer/domain/value-objects/address-id.value-object.js';
import type { AddressDetails } from '../../../../../src/modules/customer/domain/entities/address.entity.js';
import { InMemoryAddressRepository, nullLogger } from './fakes.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const userId = toUserId('00000000-0000-7000-8000-0000000000e1');
const otherUserId = toUserId('00000000-0000-7000-8000-0000000000e2');
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
  updateUseCase: UpdateAddressUseCase;
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
  const updateUseCase = new UpdateAddressUseCase({ addressRepository, clock, logger: nullLogger });
  return { addUseCase, updateUseCase, addressRepository };
};

describe('UpdateAddressUseCase', () => {
  it('updates only the supplied fields', async () => {
    const { addUseCase, updateUseCase } = setup();
    const address = await addUseCase.execute({ principal, details });

    const updated = await updateUseCase.execute({
      principal,
      addressId: address.id,
      details: { city: 'Mumbai' },
    });

    expect(updated.city).toBe('Mumbai');
    expect(updated.recipientName).toBe('Asha Rao');
  });

  it('persists the update', async () => {
    const { addUseCase, updateUseCase, addressRepository } = setup();
    const address = await addUseCase.execute({ principal, details });

    await updateUseCase.execute({ principal, addressId: address.id, details: { city: 'Pune' } });

    const found = await addressRepository.findById(address.id, userId);
    expect(found?.city).toBe('Pune');
  });

  it('rejects an unknown address id', async () => {
    const { updateUseCase } = setup();

    await expect(
      updateUseCase.execute({
        principal,
        addressId: toAddressId('00000000-0000-7000-8000-0000000000e9'),
        details: { city: 'Pune' },
      }),
    ).rejects.toBeInstanceOf(AddressNotFoundError);
  });

  it('rejects an address id belonging to another customer, identically to unknown', async () => {
    const { addUseCase, updateUseCase } = setup();
    const address = await addUseCase.execute({ principal, details });

    const unknownError: unknown = await updateUseCase
      .execute({
        principal,
        addressId: toAddressId('00000000-0000-7000-8000-0000000000e9'),
        details: { city: 'Pune' },
      })
      .catch((error: unknown) => error);
    const crossOwnerError: unknown = await updateUseCase
      .execute({
        principal: { userId: otherUserId, sessionId, role: 'CUSTOMER' },
        addressId: address.id,
        details: { city: 'Pune' },
      })
      .catch((error: unknown) => error);

    expect(unknownError).toBeInstanceOf(AddressNotFoundError);
    expect(crossOwnerError).toBeInstanceOf(AddressNotFoundError);
    expect((unknownError as Error).message).toBe((crossOwnerError as Error).message);
  });

  it('does not change id, userId, or isDefault', async () => {
    const { addUseCase, updateUseCase } = setup();
    const address = await addUseCase.execute({ principal, details }); // first address -> default

    const updated = await updateUseCase.execute({
      principal,
      addressId: address.id,
      details: { city: 'Pune' },
    });

    expect(updated.id).toBe(address.id);
    expect(updated.userId).toBe(userId);
    expect(updated.isDefault).toBe(true);
  });
});
