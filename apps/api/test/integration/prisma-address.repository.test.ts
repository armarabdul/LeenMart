import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaAddressRepository } from '../../src/modules/customer/infrastructure/persistence/prisma-address.repository.js';
import {
  Address,
  type AddressDetails,
} from '../../src/modules/customer/domain/entities/address.entity.js';
import { AddressDefaultConflictError } from '../../src/modules/customer/domain/errors/customer-errors.js';
import { toAddressId } from '../../src/modules/customer/domain/value-objects/address-id.value-object.js';
import { toUserId, type UserId } from '../../src/modules/identity/index.js';

const DETAILS: AddressDetails = {
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

/**
 * Direct repository-level integration test against real PostgreSQL,
 * following the convention established by `prisma-vendor.repository.test.ts`.
 * The concurrency test proves the partial unique index
 * (`idx_addresses_one_default_per_user`) plus `PrismaAddressRepository`'s
 * `$transaction` actually stop two simultaneous `setDefault()` callers from
 * both succeeding — not just that the code reads correctly.
 */
describe('PrismaAddressRepository', () => {
  const prisma = new PrismaClient();
  const repository = new PrismaAddressRepository(prisma);
  const idGenerator = new UuidV7Generator();
  const now = new Date('2026-01-01T00:00:00.000Z');

  const createdUserIds: UserId[] = [];

  const createUser = async (): Promise<UserId> => {
    const userId = toUserId(idGenerator.generate());
    await prisma.user.create({
      data: {
        id: userId,
        email: `address-repo-test-${idGenerator.generate()}@example.com`,
        passwordHash: 'hashed:not-a-real-password-hash-value',
      },
    });
    createdUserIds.push(userId);
    return userId;
  };

  afterAll(async () => {
    await prisma.address.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it('persists an address and round-trips every field', async () => {
    const userId = await createUser();
    const id = toAddressId(idGenerator.generate());
    const address = Address.add({ id, userId, details: DETAILS, isDefault: true, now });

    await repository.create(address);

    const found = await repository.findById(id, userId);
    if (!found) throw new Error('expected the created address to be found');
    expect(found.id).toBe(id);
    expect(found.userId).toBe(userId);
    expect(found.recipientName).toBe(DETAILS.recipientName);
    expect(found.phone).toBe(DETAILS.phone);
    expect(found.line1).toBe(DETAILS.line1);
    expect(found.line2).toBeNull();
    expect(found.city).toBe(DETAILS.city);
    expect(found.state).toBe(DETAILS.state);
    expect(found.pincode).toBe(DETAILS.pincode);
    expect(found.landmark).toBeNull();
    expect(found.label).toBe(DETAILS.label);
    expect(found.isDefault).toBe(true);
  });

  it('findById returns null for another customer’s address (never leaks across owners)', async () => {
    const userId = await createUser();
    const otherUserId = await createUser();
    const id = toAddressId(idGenerator.generate());
    await repository.create(Address.add({ id, userId, details: DETAILS, isDefault: false, now }));

    expect(await repository.findById(id, otherUserId)).toBeNull();
  });

  it('findById returns null for an unknown address id', async () => {
    const userId = await createUser();
    expect(await repository.findById(toAddressId(idGenerator.generate()), userId)).toBeNull();
  });

  it('findAllByUserId returns only that user’s addresses, default first', async () => {
    const userId = await createUser();
    const otherUserId = await createUser();
    const first = toAddressId(idGenerator.generate());
    const second = toAddressId(idGenerator.generate());
    await repository.create(
      Address.add({
        id: first,
        userId,
        details: { ...DETAILS, label: 'Work' },
        isDefault: false,
        now,
      }),
    );
    await repository.create(
      Address.add({ id: second, userId, details: DETAILS, isDefault: true, now }),
    );
    await repository.create(
      Address.add({
        id: toAddressId(idGenerator.generate()),
        userId: otherUserId,
        details: DETAILS,
        isDefault: true,
        now,
      }),
    );

    const found = await repository.findAllByUserId(userId);

    expect(found).toHaveLength(2);
    expect(found[0]?.id).toBe(second);
    expect(found[0]?.isDefault).toBe(true);
  });

  it('update() changes only the supplied row, scoped to id + userId', async () => {
    const userId = await createUser();
    const otherUserId = await createUser();
    const id = toAddressId(idGenerator.generate());
    const address = Address.add({ id, userId, details: DETAILS, isDefault: false, now });
    await repository.create(address);

    const updated = address.updateDetails({ city: 'Mumbai' }, now);
    const ownedResult = await repository.update(updated, userId);
    const crossOwnerResult = await repository.update(updated, otherUserId);

    expect(ownedResult).toBe(true);
    expect(crossOwnerResult).toBe(false);
    const found = await repository.findById(id, userId);
    expect(found?.city).toBe('Mumbai');
  });

  it('remove() soft-deletes and clears isDefault, scoped to id + userId', async () => {
    const userId = await createUser();
    const otherUserId = await createUser();
    const id = toAddressId(idGenerator.generate());
    await repository.create(Address.add({ id, userId, details: DETAILS, isDefault: true, now }));

    const crossOwnerResult = await repository.remove(id, otherUserId, now);
    const ownedResult = await repository.remove(id, userId, now);

    expect(crossOwnerResult).toBe(false);
    expect(ownedResult).toBe(true);
    expect(await repository.findById(id, userId)).toBeNull();
    const row = await prisma.address.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.isDefault).toBe(false);
  });

  it('setDefault() atomically moves the default from one address to another', async () => {
    const userId = await createUser();
    const first = toAddressId(idGenerator.generate());
    const second = toAddressId(idGenerator.generate());
    await repository.create(
      Address.add({ id: first, userId, details: DETAILS, isDefault: true, now }),
    );
    await repository.create(
      Address.add({
        id: second,
        userId,
        details: { ...DETAILS, label: 'Work' },
        isDefault: false,
        now,
      }),
    );

    const result = await repository.setDefault(second, userId, now);

    expect(result).toBe(true);
    const rows = await prisma.address.findMany({ where: { userId, deletedAt: null } });
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1);
    expect(rows.find((row) => row.id === second)?.isDefault).toBe(true);
  });

  it('setDefault() returns false for an unknown or not-owned address, leaving the existing default untouched', async () => {
    const userId = await createUser();
    const otherUserId = await createUser();
    const id = toAddressId(idGenerator.generate());
    await repository.create(Address.add({ id, userId, details: DETAILS, isDefault: true, now }));

    const result = await repository.setDefault(id, otherUserId, now);

    expect(result).toBe(false);
    const found = await repository.findById(id, userId);
    expect(found?.isDefault).toBe(true);
  });

  it('race: two concurrent setDefault() calls with an existing default leave exactly one default (serialized by the lock on that row)', async () => {
    const userId = await createUser();
    const first = toAddressId(idGenerator.generate());
    const second = toAddressId(idGenerator.generate());
    const third = toAddressId(idGenerator.generate());
    await repository.create(
      Address.add({ id: first, userId, details: DETAILS, isDefault: true, now }),
    );
    await repository.create(
      Address.add({
        id: second,
        userId,
        details: { ...DETAILS, label: 'Work' },
        isDefault: false,
        now,
      }),
    );
    await repository.create(
      Address.add({
        id: third,
        userId,
        details: { ...DETAILS, label: 'Office' },
        isDefault: false,
        now,
      }),
    );

    const results = await Promise.allSettled([
      repository.setDefault(second, userId, now),
      repository.setDefault(third, userId, now),
    ]);

    // The row lock each transaction takes on the *existing* default row
    // serializes the two "clear old, set new" transactions — whichever runs
    // second sees the first's committed result and clears it in turn. So
    // this ordering alone never hits the unique index; the assertion that
    // matters is the end state, not which/whether one call fails.
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected.length).toBeLessThanOrEqual(1);
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(AddressDefaultConflictError);
    }

    const rows = await prisma.address.findMany({ where: { userId, deletedAt: null } });
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1);
  });

  it('race: two concurrent setDefault() calls with NO existing default — the partial unique index is what stops both from winning', async () => {
    const userId = await createUser();
    const first = toAddressId(idGenerator.generate());
    const second = toAddressId(idGenerator.generate());
    await repository.create(
      Address.add({ id: first, userId, details: DETAILS, isDefault: false, now }),
    );
    await repository.create(
      Address.add({
        id: second,
        userId,
        details: { ...DETAILS, label: 'Work' },
        isDefault: false,
        now,
      }),
    );

    // With no pre-existing default row, there is nothing for the two
    // transactions' "clear" steps to lock on and serialize against — both
    // proceed straight to inserting their own row as the default. Exactly
    // one of the two concurrent commits must be rejected by
    // `idx_addresses_one_default_per_user`, translated to
    // `AddressDefaultConflictError`, never a raw/unhandled DB error and
    // never both silently succeeding.
    const results = await Promise.allSettled([
      repository.setDefault(first, userId, now),
      repository.setDefault(second, userId, now),
    ]);

    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AddressDefaultConflictError);

    const rows = await prisma.address.findMany({ where: { userId, deletedAt: null } });
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1);
  });
});
