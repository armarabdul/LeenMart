import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaMfaSecretRepository } from '../../src/modules/identity/infrastructure/persistence/prisma-mfa-secret.repository.js';
import { MfaSecret } from '../../src/modules/identity/domain/entities/mfa-secret.entity.js';
import {
  toUserId,
  type UserId,
} from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toMfaSecretId } from '../../src/modules/identity/domain/value-objects/mfa-secret-id.value-object.js';

/**
 * Direct repository-level integration test, same reasoning as
 * `prisma-otp.repository.test.ts`: no use case consumes this repository yet
 * (Milestone 3 Step 5B is persistence-only), so there is no HTTP flow to
 * route a test through. This is the smallest way to prove the mapping
 * round-trips correctly against a real database.
 *
 * Unlike `Otp`, `MfaSecret` has a unique constraint on `userId` — at most one
 * secret per user — so each test that creates a secret gets its own
 * dedicated user rather than sharing one across tests.
 */
describe('PrismaMfaSecretRepository', () => {
  const prisma = new PrismaClient();
  const repository = new PrismaMfaSecretRepository(prisma);
  const idGenerator = new UuidV7Generator();
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));

  const createdUserIds: UserId[] = [];

  const createUser = async (): Promise<UserId> => {
    const userId = toUserId(idGenerator.generate());
    await prisma.user.create({
      data: {
        id: userId,
        email: `mfa-secret-repo-test-${idGenerator.generate()}@example.com`,
        passwordHash: 'hashed:not-a-real-password-hash-value',
      },
    });
    createdUserIds.push(userId);
    return userId;
  };

  afterAll(async () => {
    await prisma.mfaSecret.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  it('persists and round-trips every field, storing only the encrypted form', async () => {
    const userId = await createUser();
    const id = toMfaSecretId(idGenerator.generate());
    const encryptedSecret = 'ciphertext:not-a-real-secret';
    const secret = MfaSecret.enroll({ id, userId, encryptedSecret, now: clock.now() });

    await repository.create(secret);

    const row = await prisma.mfaSecret.findUniqueOrThrow({ where: { id } });
    expect(row.encryptedSecret).toBe(encryptedSecret);
    expect(row.userId).toBe(userId);
    expect(row.confirmedAt).toBeNull();

    const found = await repository.findById(id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(id);
    expect(found?.userId).toBe(userId);
    expect(found?.encryptedSecret).toBe(encryptedSecret);
    expect(found?.confirmedAt).toBeNull();
    expect(found?.isConfirmed()).toBe(false);
  });

  it('findByUserId returns the secret for that user, and null for a user with none', async () => {
    const userId = await createUser();
    const id = toMfaSecretId(idGenerator.generate());
    const secret = MfaSecret.enroll({
      id,
      userId,
      encryptedSecret: 'ciphertext:findable',
      now: clock.now(),
    });
    await repository.create(secret);

    const found = await repository.findByUserId(userId);
    expect(found?.id).toBe(id);

    const missing = await repository.findByUserId(toUserId(idGenerator.generate()));
    expect(missing).toBeNull();
  });

  it('rejects a second secret for a user already holding one', async () => {
    const userId = await createUser();
    const id = toMfaSecretId(idGenerator.generate());
    const secret = MfaSecret.enroll({
      id,
      userId,
      encryptedSecret: 'ciphertext:first',
      now: clock.now(),
    });
    await repository.create(secret);

    const duplicateId = toMfaSecretId(idGenerator.generate());
    const duplicate = MfaSecret.enroll({
      id: duplicateId,
      userId,
      encryptedSecret: 'ciphertext:second',
      now: clock.now(),
    });

    await expect(repository.create(duplicate)).rejects.toThrow();
  });

  it('round-trips a confirmed secret after update()', async () => {
    const userId = await createUser();
    const id = toMfaSecretId(idGenerator.generate());
    const secret = MfaSecret.enroll({
      id,
      userId,
      encryptedSecret: 'ciphertext:confirm-me',
      now: clock.now(),
    });
    await repository.create(secret);

    const confirmedAt = new Date('2026-01-01T00:05:00.000Z');
    const confirmed = secret.confirm(confirmedAt);
    await repository.update(confirmed);

    const found = await repository.findById(id);
    expect(found?.isConfirmed()).toBe(true);
    expect(found?.confirmedAt).toEqual(confirmedAt);
  });
});
