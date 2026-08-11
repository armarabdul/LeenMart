import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import { RegisterVendorUseCase } from '../../../../../src/modules/vendor/application/use-cases/register-vendor.use-case.js';
import type { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import {
  VendorAlreadyRegisteredError,
  VendorRegistrationNotAllowedError,
} from '../../../../../src/modules/vendor/domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import type { RoleName } from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { VendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { UserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';

class InMemoryVendorRepository implements VendorRepository {
  private readonly byId = new Map<VendorId, VendorProfile>();

  create(vendorProfile: VendorProfile): Promise<void> {
    this.byId.set(vendorProfile.id, vendorProfile);
    return Promise.resolve();
  }

  update(vendorProfile: VendorProfile): Promise<void> {
    this.byId.set(vendorProfile.id, vendorProfile);
    return Promise.resolve();
  }

  findById(id: VendorId): Promise<VendorProfile | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  findByUserId(userId: UserId): Promise<VendorProfile | null> {
    for (const vendor of this.byId.values()) {
      if (vendor.userId === userId) return Promise.resolve(vendor);
    }
    return Promise.resolve(null);
  }
}

const NOW = new Date('2026-01-01T00:00:00.000Z');
const customerId = toUserId('00000000-0000-7000-8000-0000000000b1');

const sessionId = toSessionId('00000000-0000-7000-8000-00000000e5d0');

const principalOf = (role: RoleName, userId: UserId = customerId): Principal => ({
  userId,
  sessionId,
  role,
});

const setup = (): {
  useCase: RegisterVendorUseCase;
  vendorRepository: InMemoryVendorRepository;
} => {
  const vendorRepository = new InMemoryVendorRepository();
  const useCase = new RegisterVendorUseCase({
    vendorRepository,
    idGenerator: new UuidV7Generator(),
    clock: new FixedClock(NOW),
    logger: new NullLogger(),
  });
  return { useCase, vendorRepository };
};

describe('RegisterVendorUseCase', () => {
  it('registers a vendor in the REGISTERED state (SDD 15.1 lifecycle entry)', async () => {
    const { useCase } = setup();

    const vendor = await useCase.execute({ principal: principalOf('CUSTOMER') });

    expect(vendor.status).toBe(VendorStatus.REGISTERED);
    expect(vendor.userId).toBe(customerId);
  });

  it('persists the new vendor through the repository', async () => {
    const { useCase, vendorRepository } = setup();

    const vendor = await useCase.execute({ principal: principalOf('CUSTOMER') });

    const stored = await vendorRepository.findByUserId(customerId);
    expect(stored?.id).toBe(vendor.id);
  });

  it('stamps the vendor with the injected clock', async () => {
    const { useCase } = setup();

    const vendor = await useCase.execute({ principal: principalOf('CUSTOMER') });

    expect(vendor.createdAt).toEqual(NOW);
    expect(vendor.updatedAt).toEqual(NOW);
  });

  it('rejects a second registration for the same account', async () => {
    const { useCase } = setup();
    await useCase.execute({ principal: principalOf('CUSTOMER') });

    await expect(useCase.execute({ principal: principalOf('CUSTOMER') })).rejects.toBeInstanceOf(
      VendorAlreadyRegisteredError,
    );
  });

  it('does not create a second vendor profile when the duplicate is rejected', async () => {
    const { useCase, vendorRepository } = setup();
    const first = await useCase.execute({ principal: principalOf('CUSTOMER') });
    await expect(useCase.execute({ principal: principalOf('CUSTOMER') })).rejects.toThrow();

    expect((await vendorRepository.findByUserId(customerId))?.id).toBe(first.id);
  });

  it.each([
    'VENDOR_OWNER',
    'VENDOR_MANAGER',
    'VENDOR_STAFF',
    'SUPER_ADMIN',
    'CATALOGUE_MODERATOR',
    'FINANCE_ADMIN',
    'RISK_ANALYST',
    'SUPPORT_AGENT',
  ] as const satisfies readonly RoleName[])(
    'rejects a caller holding the %s role',
    async (role) => {
      const { useCase } = setup();

      await expect(useCase.execute({ principal: principalOf(role) })).rejects.toBeInstanceOf(
        VendorRegistrationNotAllowedError,
      );
    },
  );

  it('never touches the repository when the caller is not a CUSTOMER', async () => {
    const { useCase, vendorRepository } = setup();
    const createSpy = vi.spyOn(vendorRepository, 'create');
    const findSpy = vi.spyOn(vendorRepository, 'findByUserId');

    await expect(useCase.execute({ principal: principalOf('SUPER_ADMIN') })).rejects.toThrow();

    expect(findSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('registers separate vendors for separate accounts', async () => {
    const { useCase } = setup();
    const otherId = toUserId('00000000-0000-7000-8000-0000000000b2');

    const first = await useCase.execute({ principal: principalOf('CUSTOMER') });
    const second = await useCase.execute({ principal: principalOf('CUSTOMER', otherId) });

    expect(second.id).not.toBe(first.id);
    expect(second.userId).toBe(otherId);
  });
});
