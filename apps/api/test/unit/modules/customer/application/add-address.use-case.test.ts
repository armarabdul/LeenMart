import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { toUserId, type Principal } from '../../../../../src/modules/identity/index.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { AddAddressUseCase } from '../../../../../src/modules/customer/application/use-cases/add-address.use-case.js';
import type { AddressDetails } from '../../../../../src/modules/customer/domain/entities/address.entity.js';
import { InMemoryAddressRepository, nullLogger } from './fakes.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const userId = toUserId('00000000-0000-7000-8000-0000000000c1');
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

const setup = (): { useCase: AddAddressUseCase; addressRepository: InMemoryAddressRepository } => {
  const addressRepository = new InMemoryAddressRepository();
  const useCase = new AddAddressUseCase({
    addressRepository,
    idGenerator: new UuidV7Generator(),
    clock: new FixedClock(NOW),
    logger: nullLogger,
  });
  return { useCase, addressRepository };
};

describe('AddAddressUseCase', () => {
  it('adds an address for the authenticated principal', async () => {
    const { useCase } = setup();

    const address = await useCase.execute({ principal, details });

    expect(address.userId).toBe(userId);
    expect(address.recipientName).toBe('Asha Rao');
  });

  it('persists the address', async () => {
    const { useCase, addressRepository } = setup();

    const address = await useCase.execute({ principal, details });

    const found = await addressRepository.findById(address.id, userId);
    expect(found).not.toBeNull();
  });

  it('makes the very first address the default automatically', async () => {
    const { useCase } = setup();

    const address = await useCase.execute({ principal, details });

    expect(address.isDefault).toBe(true);
  });

  it('does not default a second address', async () => {
    const { useCase } = setup();
    await useCase.execute({ principal, details });

    const second = await useCase.execute({ principal, details: { ...details, label: 'Work' } });

    expect(second.isDefault).toBe(false);
  });

  it('does not disturb the existing default when a later address is added', async () => {
    const { useCase, addressRepository } = setup();
    const first = await useCase.execute({ principal, details });

    await useCase.execute({ principal, details: { ...details, label: 'Work' } });

    const refetchedFirst = await addressRepository.findById(first.id, userId);
    expect(refetchedFirst?.isDefault).toBe(true);
  });

  it('scopes the new address to the calling principal, not any client-supplied id', async () => {
    const { useCase, addressRepository } = setup();
    const otherUserId = toUserId('00000000-0000-7000-8000-0000000000c2');

    const address = await useCase.execute({ principal, details });

    const foundForOther = await addressRepository.findById(address.id, otherUserId);
    expect(foundForOther).toBeNull();
  });
});
