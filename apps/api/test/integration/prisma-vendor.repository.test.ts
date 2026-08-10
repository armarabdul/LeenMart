import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaVendorRepository } from '../../src/modules/vendor/infrastructure/persistence/prisma-vendor.repository.js';
import { VendorProfile } from '../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

/**
 * Direct repository-level integration test against real PostgreSQL,
 * following the convention established by `prisma-otp.repository.test.ts`.
 * Written at this level because no `RegisterVendorUseCase` or HTTP route
 * exists yet (Chunks 4C/4D) to route a higher-level test through — this is
 * the smallest way to prove the mapping round-trips and that the database
 * actually enforces one vendor profile per user.
 */
describe('PrismaVendorRepository', () => {
  const prisma = new PrismaClient();
  const repository = new PrismaVendorRepository(prisma);
  const idGenerator = new UuidV7Generator();
  const now = new Date('2026-01-01T00:00:00.000Z');

  const userId = toUserId(idGenerator.generate());
  const otherUserId = toUserId(idGenerator.generate());

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: userId,
          email: `vendor-repo-test-${Date.now()}@example.com`,
          passwordHash: 'hashed:not-a-real-password-hash-value',
        },
        {
          id: otherUserId,
          email: `vendor-repo-test-other-${Date.now()}@example.com`,
          passwordHash: 'hashed:not-a-real-password-hash-value',
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.vendorProfile.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it('persists a registered vendor and round-trips every field', async () => {
    const vendorId = toVendorId(idGenerator.generate());
    const vendor = VendorProfile.register({ id: vendorId, userId, now });

    await repository.create(vendor);

    const found = await repository.findById(vendorId);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(vendorId);
    expect(found?.userId).toBe(userId);
    expect(found?.status).toBe(VendorStatus.REGISTERED);
    expect(found?.createdAt).toEqual(now);
    expect(found?.updatedAt).toEqual(now);
  });

  it('stores the SDD 15.1 status as its own column value, not a UserStatus name', async () => {
    const row = await prisma.vendorProfile.findUniqueOrThrow({ where: { userId } });

    expect(row.status).toBe('REGISTERED');
  });

  it('finds a vendor by the owning user id — the duplicate-registration guard', async () => {
    const found = await repository.findByUserId(userId);

    expect(found?.userId).toBe(userId);
  });

  it('returns null for a user that has no vendor profile', async () => {
    expect(await repository.findByUserId(otherUserId)).toBeNull();
  });

  it('returns null for an unknown vendor id', async () => {
    expect(await repository.findById(toVendorId(idGenerator.generate()))).toBeNull();
  });

  it('lets the database reject a second vendor profile for the same user', async () => {
    const duplicate = VendorProfile.register({
      id: toVendorId(idGenerator.generate()),
      userId,
      now,
    });

    await expect(repository.create(duplicate)).rejects.toThrow();
  });

  it('round-trips a lifecycle status change through update()', async () => {
    const existing = await repository.findByUserId(userId);
    const later = new Date('2026-01-02T00:00:00.000Z');
    const submitted = VendorProfile.reconstitute({
      id: existing!.id,
      userId: existing!.userId,
      status: VendorStatus.KYC_SUBMITTED,
      createdAt: existing!.createdAt,
      updatedAt: later,
    });

    await repository.update(submitted);

    const found = await repository.findById(existing!.id);
    expect(found?.status).toBe(VendorStatus.KYC_SUBMITTED);
    expect(found?.createdAt).toEqual(now);
  });

  it('does not change the owning user (registration never touches User.role)', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    expect(user.role).toBe('CUSTOMER');
  });
});
