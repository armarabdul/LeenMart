import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaMfaChallengeRepository } from '../../src/modules/identity/infrastructure/persistence/prisma-mfa-challenge.repository.js';
import { MfaChallenge } from '../../src/modules/identity/domain/entities/mfa-challenge.entity.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toMfaChallengeId } from '../../src/modules/identity/domain/value-objects/mfa-challenge-id.value-object.js';

/**
 * Direct repository-level integration test, same reasoning as
 * `prisma-otp.repository.test.ts`/`prisma-mfa-secret.repository.test.ts`: no
 * use case consumes this repository yet (Milestone 3 Step 5D is
 * persistence-only), so there is no HTTP flow to route a test through.
 */
describe('PrismaMfaChallengeRepository', () => {
  const prisma = new PrismaClient();
  const repository = new PrismaMfaChallengeRepository(prisma);
  const idGenerator = new UuidV7Generator();
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));

  const userId = toUserId(idGenerator.generate());

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `mfa-challenge-repo-test-${Date.now()}@example.com`,
        passwordHash: 'hashed:not-a-real-password-hash-value',
      },
    });
  });

  afterAll(async () => {
    await prisma.mfaChallenge.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('persists and round-trips every field, storing only the token hash', async () => {
    const id = toMfaChallengeId(idGenerator.generate());
    const tokenHash = 'a'.repeat(64); // sha256-hex-shaped, not a real hash
    const challenge = MfaChallenge.issue({ id, userId, tokenHash, now: clock.now() });

    await repository.create(challenge);

    const row = await prisma.mfaChallenge.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).toBe(tokenHash);
    expect(row.userId).toBe(userId);
    expect(row.attempts).toBe(0);
    expect(row.consumedAt).toBeNull();

    const found = await repository.findByTokenHash(tokenHash);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(id);
    expect(found?.userId).toBe(userId);
    expect(found?.tokenHash).toBe(tokenHash);
    expect(found?.expiresAt.getTime()).toBe(new Date('2026-01-01T00:05:00.000Z').getTime());
    expect(found?.consumedAt).toBeNull();
  });

  it('findByTokenHash returns null for a hash that was never issued', async () => {
    const missing = await repository.findByTokenHash('f'.repeat(64));
    expect(missing).toBeNull();
  });

  it('round-trips attempt count and consumed state after update()', async () => {
    const id = toMfaChallengeId(idGenerator.generate());
    const tokenHash = 'b'.repeat(64);
    const challenge = MfaChallenge.issue({ id, userId, tokenHash, now: clock.now() });
    await repository.create(challenge);

    const afterAttempt = challenge.recordFailedAttempt(clock.now());
    await repository.update(afterAttempt);

    const foundAfterAttempt = await repository.findByTokenHash(tokenHash);
    expect(foundAfterAttempt?.attempts).toBe(1);
    expect(foundAfterAttempt?.consumedAt).toBeNull();

    const consumed = afterAttempt.consume(clock.now());
    await repository.update(consumed);

    const foundAfterConsume = await repository.findByTokenHash(tokenHash);
    expect(foundAfterConsume?.consumedAt).toEqual(clock.now());
  });

  it('rejects a second challenge with the same token hash', async () => {
    const tokenHash = 'c'.repeat(64);
    const first = MfaChallenge.issue({
      id: toMfaChallengeId(idGenerator.generate()),
      userId,
      tokenHash,
      now: clock.now(),
    });
    await repository.create(first);

    const duplicate = MfaChallenge.issue({
      id: toMfaChallengeId(idGenerator.generate()),
      userId,
      tokenHash,
      now: clock.now(),
    });

    await expect(repository.create(duplicate)).rejects.toThrow();
  });
});
