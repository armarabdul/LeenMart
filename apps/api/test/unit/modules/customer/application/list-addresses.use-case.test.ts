import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { toUserId, type Principal } from '../../../../../src/modules/identity/index.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { AddAddressUseCase } from '../../../../../src/modules/customer/application/use-cases/add-address.use-case.js';
import { ListAddressesUseCase } from '../../../../../src/modules/customer/application/use-cases/list-addresses.use-case.js';
import type { AddressDetails } from '../../../../../src/modules/customer/domain/entities/address.entity.js';
import { InMemoryAddressRepository, nullLogger } from './fakes.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const userId = toUserId('00000000-0000-7000-8000-0000000000d1');
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
  listUseCase: ListAddressesUseCase;
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
  const listUseCase = new ListAddressesUseCase({ addressRepository });
  return { addUseCase, listUseCase, addressRepository };
};

describe('ListAddressesUseCase', () => {
  it('returns an empty list for a customer with no addresses', async () => {
    const { listUseCase } = setup();

    const addresses = await listUseCase.execute({ principal });

    expect(addresses).toEqual([]);
  });

  it('lists only the authenticated principal’s own addresses', async () => {
    const { addUseCase, listUseCase } = setup();
    const otherUserId = toUserId('00000000-0000-7000-8000-0000000000d2');
    await addUseCase.execute({ principal, details });
    await addUseCase.execute({
      principal: { userId: otherUserId, sessionId, role: 'CUSTOMER' },
      details,
    });

    const addresses = await listUseCase.execute({ principal });

    expect(addresses).toHaveLength(1);
    expect(addresses[0]?.userId).toBe(userId);
  });

  it('lists the default address first', async () => {
    const { addUseCase, listUseCase } = setup();
    await addUseCase.execute({ principal, details }); // becomes default
    await addUseCase.execute({ principal, details: { ...details, label: 'Work' } });

    const addresses = await listUseCase.execute({ principal });

    expect(addresses[0]?.isDefault).toBe(true);
    expect(addresses[0]?.label).toBe('Home');
  });
});
