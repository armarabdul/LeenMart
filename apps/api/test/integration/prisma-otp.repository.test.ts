import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaOtpRepository } from '../../src/modules/identity/infrastructure/persistence/prisma-otp.repository.js';
import { Otp } from '../../src/modules/identity/domain/entities/otp.entity.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toOtpId } from '../../src/modules/identity/domain/value-objects/otp-id.value-object.js';

/**
 * Direct repository-level integration test — no existing Prisma repository
 * had one of these before (`PrismaUserRepository`/`PrismaRefreshTokenRepository`
 * are only exercised indirectly via `identity.test.ts`'s HTTP flow). Written
 * this way here because no `RequestOtp`/`VerifyOtp` use case exists yet
 * (Chunk 4) to route an HTTP-level test through — this is the smallest way
 * to prove the persistence mapping round-trips correctly against a real
 * database, per Milestone 3 Step 2 Chunk 3's requirements.
 */
describe('PrismaOtpRepository', () => {
  const prisma = new PrismaClient();
  const repository = new PrismaOtpRepository(prisma);
  const idGenerator = new UuidV7Generator();
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));

  const userId = toUserId(idGenerator.generate());

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: userId,
        email: `otp-repo-test-${Date.now()}@example.com`,
        passwordHash: 'hashed:not-a-real-password-hash-value',
      },
    });
  });

  afterAll(async () => {
    await prisma.otp.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('persists and round-trips every field, storing only the hash', async () => {
    const otpId = toOtpId(idGenerator.generate());
    const codeHash = '$argon2id$fake-hash-not-a-real-code$abcdef';
    const otp = Otp.issue({ id: otpId, userId, codeHash, now: clock.now() });

    await repository.create(otp);

    const row = await prisma.otp.findUniqueOrThrow({ where: { id: otpId } });
    expect(row.codeHash).toBe(codeHash);
    expect(row.codeHash).not.toMatch(/^\d{6}$/); // never the raw 6-digit shape

    const found = await repository.findById(otpId);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(otpId);
    expect(found?.userId).toBe(userId);
    expect(found?.codeHash).toBe(codeHash);
    expect(found?.attempts).toBe(0);
    expect(found?.expiresAt.getTime()).toBe(new Date('2026-01-01T00:05:00.000Z').getTime());
    expect(found?.consumedAt).toBeNull();
  });

  it('round-trips attempt count and consumed state after update()', async () => {
    const otpId = toOtpId(idGenerator.generate());
    const otp = Otp.issue({ id: otpId, userId, codeHash: 'hash-2', now: clock.now() });
    await repository.create(otp);

    const afterAttempt = otp.recordFailedAttempt(clock.now());
    await repository.update(afterAttempt);

    const foundAfterAttempt = await repository.findById(otpId);
    expect(foundAfterAttempt?.attempts).toBe(1);
    expect(foundAfterAttempt?.consumedAt).toBeNull();

    const consumed = afterAttempt.consume(clock.now());
    await repository.update(consumed);

    const foundAfterConsume = await repository.findById(otpId);
    expect(foundAfterConsume?.consumedAt).toEqual(clock.now());
  });

  it('findActiveByUserId returns the most recent unconsumed OTP for that user', async () => {
    const olderId = toOtpId(idGenerator.generate());
    const older = Otp.issue({ id: olderId, userId, codeHash: 'hash-older', now: clock.now() });
    await repository.create(older);

    const newerId = toOtpId(idGenerator.generate());
    const newerClock = new FixedClock(new Date('2026-01-01T00:01:00.000Z'));
    const newer = Otp.issue({ id: newerId, userId, codeHash: 'hash-newer', now: newerClock.now() });
    await repository.create(newer);

    const active = await repository.findActiveByUserId(userId);
    expect(active?.id).toBe(newerId);

    await repository.update(newer.consume(newerClock.now()));
    const afterConsumingNewer = await repository.findActiveByUserId(userId);
    expect(afterConsumingNewer?.id).toBe(olderId);
  });
});
