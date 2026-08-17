import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import { SetVendorPickupCapabilityUseCase } from '../../../../../src/modules/vendor/application/use-cases/set-vendor-pickup-capability.use-case.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorProfileNotFoundError } from '../../../../../src/modules/vendor/domain/errors/vendor-errors.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);

const userId = toUserId(ids.generate());
const principal: Principal = {
  userId,
  sessionId: toSessionId(ids.generate()),
  role: 'VENDOR_OWNER',
};

const vendor = VendorProfile.reconstitute({
  id: toVendorId(ids.generate()),
  userId,
  status: VendorStatus.ACTIVE,
  plan: 'COMMISSION',
  shopName: 'Test Shop',
  supportsPickup: false,
  createdAt: NOW,
  updatedAt: NOW,
});

const vendorRepo = (overrides: Partial<VendorRepository> = {}): VendorRepository => {
  const repository: VendorRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn(),
    findByUserId: vi.fn().mockResolvedValue(vendor),
    ...overrides,
  };
  return repository;
};

describe('SetVendorPickupCapabilityUseCase', () => {
  it('turns pickup capability on for the caller’s own vendor profile', async () => {
    const repository = vendorRepo();
    const useCase = new SetVendorPickupCapabilityUseCase({
      vendorRepository: repository,
      clock,
      logger: new NullLogger(),
    });

    const updated = await useCase.execute({ principal, supportsPickup: true });

    expect(updated.supportsPickup).toBe(true);
    expect(repository.update).toHaveBeenCalledWith(
      expect.objectContaining({ supportsPickup: true }),
    );
  });

  it('can also turn pickup capability back off', async () => {
    const alreadyOn = VendorProfile.reconstitute({
      id: toVendorId(ids.generate()),
      userId,
      status: VendorStatus.ACTIVE,
      plan: 'COMMISSION',
      shopName: 'Test Shop',
      supportsPickup: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const useCase = new SetVendorPickupCapabilityUseCase({
      vendorRepository: vendorRepo({ findByUserId: vi.fn().mockResolvedValue(alreadyOn) }),
      clock,
      logger: new NullLogger(),
    });

    const updated = await useCase.execute({ principal, supportsPickup: false });

    expect(updated.supportsPickup).toBe(false);
  });

  it('never accepts a vendor id from the caller — always the principal’s own profile', async () => {
    const repository = vendorRepo();
    const useCase = new SetVendorPickupCapabilityUseCase({
      vendorRepository: repository,
      clock,
      logger: new NullLogger(),
    });

    await useCase.execute({ principal, supportsPickup: true });

    expect(repository.findByUserId).toHaveBeenCalledWith(userId);
  });

  it('rejects with VendorProfileNotFoundError when the caller has no vendor profile', async () => {
    const useCase = new SetVendorPickupCapabilityUseCase({
      vendorRepository: vendorRepo({ findByUserId: vi.fn().mockResolvedValue(null) }),
      clock,
      logger: new NullLogger(),
    });

    await expect(useCase.execute({ principal, supportsPickup: true })).rejects.toThrow(
      VendorProfileNotFoundError,
    );
  });
});
