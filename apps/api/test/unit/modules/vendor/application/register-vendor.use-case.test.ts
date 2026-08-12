import { describe, expect, it, vi } from 'vitest';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import {
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
} from '../../identity/application/fakes.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import { Role } from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { UserStatus } from '../../../../../src/modules/identity/domain/value-objects/user-status.value-object.js';
import { Session } from '../../../../../src/modules/identity/domain/entities/session.entity.js';
import type { SessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
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
  /** Set when `create` should fail, to prove the transaction rolls both writes back. */
  failOnCreate = false;

  withTransaction(): VendorRepository {
    return this;
  }

  snapshot(): Map<VendorId, VendorProfile> {
    return new Map(this.byId);
  }

  restore(state: Map<VendorId, VendorProfile>): void {
    this.byId.clear();
    for (const [id, vendor] of state) this.byId.set(id, vendor);
  }

  create(vendorProfile: VendorProfile): Promise<void> {
    if (this.failOnCreate) return Promise.reject(new Error('vendor insert failed'));
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

/** A CUSTOMER account, seeded so registration has something to promote. */
const seedCustomer = (
  userRepository: InMemoryUserRepository,
  userId: UserId = customerId,
): User => {
  const user = User.reconstitute({
    id: userId,
    email: `vendor-${userId}@example.com`,
    phoneVerifiedAt: null,
    role: Role.CUSTOMER,
    status: UserStatus.ACTIVE,
    createdAt: NOW,
    updatedAt: NOW,
  });
  void userRepository.create(user);
  return user;
};

const ACCESS_TTL = 600;

/**
 * A transaction runner that actually rolls back, so the atomicity tests prove
 * something. `run` snapshots both stores, and restores them if the callback
 * throws — the in-memory stand-in for what PostgreSQL does.
 */
class FakeTransactionRunner implements TransactionRunner {
  constructor(
    private readonly snapshot: () => {
      users: Map<UserId, User>;
      vendors: Map<VendorId, VendorProfile>;
    },
    private readonly restore: (state: {
      users: Map<UserId, User>;
      vendors: Map<VendorId, VendorProfile>;
    }) => void,
  ) {}

  async run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> {
    const before = this.snapshot();
    try {
      return await work({} as TransactionScope);
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }
}

const setup = (): {
  useCase: RegisterVendorUseCase;
  vendorRepository: InMemoryVendorRepository;
  userRepository: InMemoryUserRepository;
  sessionRepository: InMemoryRefreshTokenRepository;
  denied: { id: SessionId; ttl: number }[];
} => {
  const vendorRepository = new InMemoryVendorRepository();
  const userRepository = new InMemoryUserRepository();
  const sessionRepository = new InMemoryRefreshTokenRepository();
  const denied: { id: SessionId; ttl: number }[] = [];

  const useCase = new RegisterVendorUseCase({
    vendorRepository,
    userRepository,
    sessionRepository,
    sessionDenylist: {
      deny: (id: SessionId, ttl: number) => {
        denied.push({ id, ttl });
        return Promise.resolve();
      },
      isDenied: () => Promise.resolve(false),
    },
    transactionRunner: new FakeTransactionRunner(
      () => ({ users: userRepository.snapshot(), vendors: vendorRepository.snapshot() }),
      (state) => {
        userRepository.restore(state.users);
        vendorRepository.restore(state.vendors);
      },
    ),
    accessTokenTtlSeconds: ACCESS_TTL,
    idGenerator: new UuidV7Generator(),
    clock: new FixedClock(NOW),
    logger: new NullLogger(),
  });
  // Every registration promotes an existing CUSTOMER, so the account has to
  // exist for the use case to have anything to promote.
  seedCustomer(userRepository);
  return { useCase, vendorRepository, userRepository, sessionRepository, denied };
};

/** Two live sessions on different families — a laptop and a phone. */
const seedSessions = (
  sessionRepository: InMemoryRefreshTokenRepository,
  userId: UserId = customerId,
): SessionId[] => {
  const ids = [
    toSessionId('00000000-0000-7000-8000-00000000e5d0'),
    toSessionId('00000000-0000-7000-8000-00000000e5d1'),
  ];
  for (const id of ids) {
    void sessionRepository.create(
      Session.reconstitute({
        id,
        userId,
        familyId: id,
        tokenHash: `hash-${id}`,
        expiresAt: new Date(NOW.getTime() + 86_400_000),
        revokedAt: null,
        replacedByTokenId: null,
        createdAt: NOW,
      }),
    );
  }
  return ids;
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

  it('writes nothing when the caller is not a CUSTOMER', async () => {
    // The duplicate lookup now runs first (so a promoted vendor gets 409
    // rather than 403), but a non-customer must still not create anything.
    const { useCase, vendorRepository, userRepository } = setup();
    const createSpy = vi.spyOn(vendorRepository, 'create');
    const updateSpy = vi.spyOn(userRepository, 'update');

    await expect(useCase.execute({ principal: principalOf('SUPER_ADMIN') })).rejects.toThrow(
      VendorRegistrationNotAllowedError,
    );

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('reports an already-registered account as a conflict, whatever its role', async () => {
    // After promotion the caller arrives as VENDOR_OWNER, so checking the role
    // first would answer "you may not register" when the truthful answer is
    // "you already did".
    const { useCase } = setup();
    await useCase.execute({ principal: principalOf('CUSTOMER') });

    await expect(useCase.execute({ principal: principalOf('VENDOR_OWNER') })).rejects.toThrow(
      VendorAlreadyRegisteredError,
    );
  });

  it('registers separate vendors for separate accounts', async () => {
    const { useCase, userRepository } = setup();
    const otherId = toUserId('00000000-0000-7000-8000-0000000000b2');
    seedCustomer(userRepository, otherId);

    const first = await useCase.execute({ principal: principalOf('CUSTOMER') });
    const second = await useCase.execute({ principal: principalOf('CUSTOMER', otherId) });

    expect(second.id).not.toBe(first.id);
    expect(second.userId).toBe(otherId);
  });

  describe('role promotion (SDD 8.1/8.2)', () => {
    it('promotes the registering CUSTOMER to VENDOR_OWNER', async () => {
      // Without this the account owns a vendor it has no permission to act
      // for: SDD 8.2 grants SUBMIT_OR_EDIT_KYC to VENDOR_OWNER and withholds
      // it from CUSTOMER.
      const { useCase, userRepository } = setup();

      await useCase.execute({ principal: principalOf('CUSTOMER') });

      const promoted = await userRepository.findById(customerId);
      expect(promoted?.role).toBe(Role.VENDOR_OWNER);
    });

    it('creates the vendor and promotes the role in the same transaction', async () => {
      const { useCase, userRepository, vendorRepository } = setup();

      const vendor = await useCase.execute({ principal: principalOf('CUSTOMER') });

      expect(await vendorRepository.findById(vendor.id)).not.toBeNull();
      expect((await userRepository.findById(customerId))?.role).toBe(Role.VENDOR_OWNER);
    });

    it('rolls BOTH writes back when the vendor insert fails', async () => {
      // Either write alone is a broken account: a promoted user with no
      // vendor, or a vendor whose owner cannot reach it.
      const { useCase, userRepository, vendorRepository } = setup();
      vendorRepository.failOnCreate = true;

      await expect(useCase.execute({ principal: principalOf('CUSTOMER') })).rejects.toThrow(
        'vendor insert failed',
      );

      expect((await userRepository.findById(customerId))?.role).toBe(Role.CUSTOMER);
      expect(await vendorRepository.findByUserId(customerId)).toBeNull();
    });

    it('refuses to promote an account that is not a CUSTOMER', () => {
      // The domain guard, independent of the use case's own role check.
      const user = User.reconstitute({
        id: customerId,
        email: 'admin@example.com',
        phoneVerifiedAt: null,
        role: Role.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        createdAt: NOW,
        updatedAt: NOW,
      });

      expect(() => user.promoteToVendorOwner(NOW)).toThrow(/Only a CUSTOMER/);
    });
  });

  describe('session revocation (SDD 7.2)', () => {
    it('revokes every session the account holds, across families', async () => {
      const { useCase, sessionRepository } = setup();
      const ids = seedSessions(sessionRepository);

      await useCase.execute({ principal: principalOf('CUSTOMER') });

      const live = await sessionRepository.revokeAllForUser(customerId, NOW);
      expect(live).toEqual([]);
      expect(await sessionRepository.findSessionIdsByUserId(customerId)).toHaveLength(ids.length);
    });

    it('denies the current session too — it carries a now-stale CUSTOMER claim', async () => {
      const { useCase, sessionRepository, denied } = setup();
      const ids = seedSessions(sessionRepository);

      await useCase.execute({ principal: principalOf('CUSTOMER') });

      expect(denied.map((entry) => entry.id)).toContain(sessionId);
      expect(new Set(denied.map((entry) => entry.id))).toEqual(new Set(ids));
    });

    it('denies each session for exactly the access-token lifetime', async () => {
      // The tightest bound that still covers every token in flight (SDD 7.2):
      // a live token was issued at most one lifetime ago.
      const { useCase, sessionRepository, denied } = setup();
      seedSessions(sessionRepository);

      await useCase.execute({ principal: principalOf('CUSTOMER') });

      expect(denied).not.toHaveLength(0);
      expect(denied.every((entry) => entry.ttl === ACCESS_TTL)).toBe(true);
    });

    it('does not revoke sessions belonging to another account', async () => {
      const other = toUserId('00000000-0000-7000-8000-0000000000c9');
      const { useCase, sessionRepository, denied } = setup();
      seedSessions(sessionRepository);
      void sessionRepository.create(
        Session.reconstitute({
          id: toSessionId('00000000-0000-7000-8000-00000000e5ff'),
          userId: other,
          familyId: toSessionId('00000000-0000-7000-8000-00000000e5ff'),
          tokenHash: 'hash-other',
          expiresAt: new Date(NOW.getTime() + 86_400_000),
          revokedAt: null,
          replacedByTokenId: null,
          createdAt: NOW,
        }),
      );

      await useCase.execute({ principal: principalOf('CUSTOMER') });

      expect(denied.map((entry) => entry.id)).not.toContain(
        toSessionId('00000000-0000-7000-8000-00000000e5ff'),
      );
      expect(await sessionRepository.findSessionIdsByUserId(other)).toHaveLength(1);
    });
  });
});
