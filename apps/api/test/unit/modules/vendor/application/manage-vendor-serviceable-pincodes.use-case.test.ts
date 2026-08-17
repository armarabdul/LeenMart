import { describe, expect, it, vi } from 'vitest';
import { NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import { VendorProfileNotFoundError } from '../../../../../src/modules/vendor/domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import type { ServiceablePincodeRepository } from '../../../../../src/modules/vendor/domain/repositories/serviceable-pincode.repository.js';
import {
  GetVendorServiceablePincodesUseCase,
  SetVendorServiceablePincodesUseCase,
} from '../../../../../src/modules/vendor/application/use-cases/manage-vendor-serviceable-pincodes.use-case.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-01T00:00:00.000Z');
const userId = toUserId(ids.generate());
const vendorId = toVendorId(ids.generate());
const principal: Principal = {
  userId,
  sessionId: toSessionId(ids.generate()),
  role: 'VENDOR_OWNER',
};

const vendor = VendorProfile.reconstitute({
  id: vendorId,
  userId,
  status: VendorStatus.ACTIVE,
  plan: 'COMMISSION',
  shopName: 'FreshMart',
  supportsPickup: true,
  shopAddress: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const vendorRepo = (overrides: Partial<VendorRepository> = {}): VendorRepository => {
  const repository: VendorRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn().mockResolvedValue(vendor),
    findByUserId: vi.fn().mockResolvedValue(vendor),
    ...overrides,
  };
  return repository;
};

const pincodeRepo = (
  stored: readonly string[] = [],
): ServiceablePincodeRepository & { replaceForVendor: ReturnType<typeof vi.fn> } => {
  const replaceForVendor = vi.fn();
  const repository = {
    withTransaction: () => repository,
    findAllByVendor: vi.fn().mockResolvedValue(stored),
    replaceForVendor,
  };
  return repository as unknown as ServiceablePincodeRepository & {
    replaceForVendor: ReturnType<typeof vi.fn>;
  };
};

const runner = (): TransactionRunner => ({
  run: async (work) => work({} as TransactionScope),
});

interface UseCaseDeps {
  readonly vendorRepository: VendorRepository;
  readonly serviceablePincodeRepository: ServiceablePincodeRepository;
  readonly transactionRunner: TransactionRunner;
  readonly logger: NullLogger;
}

const deps = (
  vendorRepository: VendorRepository,
  serviceablePincodeRepository: ServiceablePincodeRepository,
): UseCaseDeps => ({
  vendorRepository,
  serviceablePincodeRepository,
  transactionRunner: runner(),
  logger: new NullLogger(),
});

describe('GetVendorServiceablePincodesUseCase (S4-SERV)', () => {
  it('reports an unconfigured vendor as such, with an empty list', async () => {
    const useCase = new GetVendorServiceablePincodesUseCase(deps(vendorRepo(), pincodeRepo([])));

    const result = await useCase.execute({ principal });

    // D7: this is what tells the portal to say "you deliver everywhere"
    // rather than showing a blank list that reads as "nowhere".
    expect(result).toEqual({ vendorId, configured: false, pincodes: [] });
  });

  it('returns the stored set for a configured vendor', async () => {
    const useCase = new GetVendorServiceablePincodesUseCase(
      deps(vendorRepo(), pincodeRepo(['560001', '560002'])),
    );

    const result = await useCase.execute({ principal });

    expect(result).toEqual({ vendorId, configured: true, pincodes: ['560001', '560002'] });
  });

  it('resolves the vendor from the principal, never from the request', async () => {
    const vendorRepository = vendorRepo();
    await new GetVendorServiceablePincodesUseCase(deps(vendorRepository, pincodeRepo())).execute({
      principal,
    });

    expect(vendorRepository.findByUserId).toHaveBeenCalledWith(userId);
    expect(vendorRepository.findById).not.toHaveBeenCalled();
  });

  it('refuses a caller with no vendor profile', async () => {
    const vendorRepository = vendorRepo({ findByUserId: vi.fn().mockResolvedValue(null) });

    await expect(
      new GetVendorServiceablePincodesUseCase(deps(vendorRepository, pincodeRepo())).execute({
        principal,
      }),
    ).rejects.toThrow(VendorProfileNotFoundError);
  });
});

describe('SetVendorServiceablePincodesUseCase (S4-SERV)', () => {
  it('replaces the set with the supplied pincodes', async () => {
    const repository = pincodeRepo();
    const result = await new SetVendorServiceablePincodesUseCase(
      deps(vendorRepo(), repository),
    ).execute({ principal, pincodes: ['560002', '560001'] });

    // Sorted, so the stored set and every response are order-stable.
    expect(repository.replaceForVendor).toHaveBeenCalledWith(vendorId, ['560001', '560002']);
    expect(result.pincodes).toEqual(['560001', '560002']);
    expect(result.configured).toBe(true);
  });

  it('collapses duplicates rather than rejecting them', async () => {
    const repository = pincodeRepo();

    const result = await new SetVendorServiceablePincodesUseCase(
      deps(vendorRepo(), repository),
    ).execute({ principal, pincodes: ['560001', '560001', '560002'] });

    expect(repository.replaceForVendor).toHaveBeenCalledWith(vendorId, ['560001', '560002']);
    expect(result.pincodes).toEqual(['560001', '560002']);
  });

  it('accepts an empty set, returning the vendor to serve-everywhere', async () => {
    const repository = pincodeRepo(['560001']);

    const result = await new SetVendorServiceablePincodesUseCase(
      deps(vendorRepo(), repository),
    ).execute({ principal, pincodes: [] });

    expect(repository.replaceForVendor).toHaveBeenCalledWith(vendorId, []);
    expect(result).toEqual({ vendorId, configured: false, pincodes: [] });
  });

  it('never adds the vendor’s own shop pincode implicitly (D2)', async () => {
    const repository = pincodeRepo();

    await new SetVendorServiceablePincodesUseCase(deps(vendorRepo(), repository)).execute({
      principal,
      pincodes: ['560002'],
    });

    expect(repository.replaceForVendor).toHaveBeenCalledWith(vendorId, ['560002']);
  });

  it('refuses a caller with no vendor profile, writing nothing', async () => {
    const vendorRepository = vendorRepo({ findByUserId: vi.fn().mockResolvedValue(null) });
    const repository = pincodeRepo();

    await expect(
      new SetVendorServiceablePincodesUseCase(deps(vendorRepository, repository)).execute({
        principal,
        pincodes: ['560001'],
      }),
    ).rejects.toThrow(VendorProfileNotFoundError);
    expect(repository.replaceForVendor).not.toHaveBeenCalled();
  });
});
