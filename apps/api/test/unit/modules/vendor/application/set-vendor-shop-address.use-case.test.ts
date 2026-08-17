import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import { VendorProfileNotFoundError } from '../../../../../src/modules/vendor/domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import { SetVendorShopAddressUseCase } from '../../../../../src/modules/vendor/application/use-cases/set-vendor-shop-address.use-case.js';
import { GetVendorShopProfileUseCase } from '../../../../../src/modules/vendor/application/use-cases/get-vendor-shop-profile.use-case.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-01T00:00:00.000Z');
const LATER = new Date('2026-08-02T00:00:00.000Z');
const clock = new FixedClock(LATER);

const userId = toUserId(ids.generate());
const vendorId = toVendorId(ids.generate());
const principal: Principal = {
  userId,
  sessionId: toSessionId(ids.generate()),
  role: 'VENDOR_OWNER',
};

const ADDRESS = {
  line1: '12 Market Road',
  line2: 'Near the clock tower',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
};

const vendor = (shopAddress: typeof ADDRESS | null = null): VendorProfile =>
  VendorProfile.reconstitute({
    id: vendorId,
    userId,
    status: VendorStatus.ACTIVE,
    plan: 'COMMISSION',
    shopName: 'FreshMart',
    supportsPickup: true,
    shopAddress,
    createdAt: NOW,
    updatedAt: NOW,
  });

const vendorRepo = (overrides: Partial<VendorRepository> = {}): VendorRepository => {
  const repository: VendorRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn().mockResolvedValue(vendor()),
    findByUserId: vi.fn().mockResolvedValue(vendor()),
    ...overrides,
  };
  return repository;
};

const buildUseCase = (vendorRepository: VendorRepository): SetVendorShopAddressUseCase =>
  new SetVendorShopAddressUseCase({ vendorRepository, clock, logger: new NullLogger() });

describe('SetVendorShopAddressUseCase', () => {
  it('sets an address on a vendor that had none', async () => {
    const repository = vendorRepo();
    const updated = await buildUseCase(repository).execute({ principal, shopAddress: ADDRESS });

    expect(updated.shopAddress).toEqual(ADDRESS);
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  it('replaces an existing address wholesale rather than merging', async () => {
    const repository = vendorRepo({
      findByUserId: vi.fn().mockResolvedValue(vendor(ADDRESS)),
    });
    const replacement = {
      line1: '99 New Street',
      line2: null,
      city: 'Mysuru',
      state: 'Karnataka',
      pincode: '570001',
    };

    const updated = await buildUseCase(repository).execute({
      principal,
      shopAddress: replacement,
    });

    // Nothing survives from the old address — in particular `line2`, which a
    // field-by-field merge would have left behind.
    expect(updated.shopAddress).toEqual(replacement);
  });

  it('stamps updatedAt from the clock', async () => {
    const updated = await buildUseCase(vendorRepo()).execute({ principal, shopAddress: ADDRESS });

    expect(updated.updatedAt).toEqual(LATER);
  });

  it('resolves the vendor from the principal, never from the request', async () => {
    const repository = vendorRepo();
    await buildUseCase(repository).execute({ principal, shopAddress: ADDRESS });

    // This is what makes "vendor A cannot edit vendor B's address" true by
    // construction: there is no vendor id on the input at all.
    expect(repository.findByUserId).toHaveBeenCalledWith(userId);
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('refuses a caller with no vendor profile', async () => {
    const repository = vendorRepo({ findByUserId: vi.fn().mockResolvedValue(null) });

    await expect(
      buildUseCase(repository).execute({ principal, shopAddress: ADDRESS }),
    ).rejects.toThrow(VendorProfileNotFoundError);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('writes no audit record, matching the existing shop-profile convention', async () => {
    // `SetVendorShopNameUseCase`/`SetVendorPickupCapabilityUseCase` take no
    // audit writer either — audit in this module is reserved for KYC and
    // admin decisions. Asserted structurally: the use case's dependencies
    // simply have nowhere to write one.
    const repository = vendorRepo();
    const useCase = buildUseCase(repository);

    await useCase.execute({ principal, shopAddress: ADDRESS });

    expect(Object.keys(useCase as unknown as { deps: object })).not.toContain('auditWriter');
  });
});

describe('GetVendorShopProfileUseCase', () => {
  it('returns the caller’s own profile including the address', async () => {
    const repository = vendorRepo({
      findByUserId: vi.fn().mockResolvedValue(vendor(ADDRESS)),
    });

    const profile = await new GetVendorShopProfileUseCase({ vendorRepository: repository }).execute(
      {
        principal,
      },
    );

    expect(profile.shopAddress).toEqual(ADDRESS);
    expect(repository.findByUserId).toHaveBeenCalledWith(userId);
  });

  it('refuses a caller with no vendor profile', async () => {
    const repository = vendorRepo({ findByUserId: vi.fn().mockResolvedValue(null) });

    await expect(
      new GetVendorShopProfileUseCase({ vendorRepository: repository }).execute({ principal }),
    ).rejects.toThrow(VendorProfileNotFoundError);
  });
});
