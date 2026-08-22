import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { AuditWriter, AuditWriterInput } from '../../../../../src/modules/audit/index.js';
import { VENDOR_AUDIT_ACTIONS } from '../../../../../src/modules/vendor/domain/audit-actions.js';
import { ReinstateVendorUseCase } from '../../../../../src/modules/vendor/application/use-cases/reinstate-vendor.use-case.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import {
  InvalidVendorStatusTransitionError,
  VendorProfileNotFoundError,
} from '../../../../../src/modules/vendor/domain/errors/vendor-errors.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import { Role } from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { UserStatus } from '../../../../../src/modules/identity/domain/value-objects/user-status.value-object.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import type { UserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { VendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import {
  FailingAuditWriter,
  InMemoryUserRepository,
  RecordingAuditWriter,
} from '../../identity/application/fakes.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);
const vendorId = toVendorId(ids.generate());
const ownerId = toUserId(ids.generate());
const admin = toUserId(ids.generate());

const principal: Principal = {
  userId: admin,
  sessionId: toSessionId(ids.generate()),
  role: 'SUPER_ADMIN',
};

const profile = (status: VendorStatus, userId: UserId = ownerId): VendorProfile =>
  VendorProfile.reconstitute({
    id: vendorId,
    userId,
    status,
    plan: 'COMMISSION',
    shopName: null,
    supportsPickup: false,
    shopAddress: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

const owner = (status: UserStatus, userId: UserId = ownerId): User =>
  User.reconstitute({
    id: userId,
    email: `vendor-${userId}@example.com`,
    passwordHash: PasswordHash.create('hashed:a-password-value'),
    phoneVerifiedAt: null,
    role: Role.VENDOR_OWNER,
    status,
    createdAt: NOW,
    updatedAt: NOW,
  });

class FakeTransactionRunner implements TransactionRunner {
  constructor(
    private readonly snapshot: () => {
      vendors: Map<VendorId, VendorProfile>;
      users: Map<UserId, User>;
    },
    private readonly restore: (state: {
      vendors: Map<VendorId, VendorProfile>;
      users: Map<UserId, User>;
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

class InMemoryVendorRepository implements VendorRepository {
  private readonly byId = new Map<VendorId, VendorProfile>();

  withTransaction(): VendorRepository {
    return this;
  }

  seed(vendor: VendorProfile): void {
    this.byId.set(vendor.id, vendor);
  }

  snapshot(): Map<VendorId, VendorProfile> {
    return new Map(this.byId);
  }

  restore(state: Map<VendorId, VendorProfile>): void {
    this.byId.clear();
    for (const [id, vendor] of state) this.byId.set(id, vendor);
  }

  create(vendor: VendorProfile): Promise<void> {
    this.byId.set(vendor.id, vendor);
    return Promise.resolve();
  }

  update(vendor: VendorProfile): Promise<void> {
    this.byId.set(vendor.id, vendor);
    return Promise.resolve();
  }

  findById(id: VendorId): Promise<VendorProfile | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }

  findByUserId(): Promise<VendorProfile | null> {
    throw new Error('not used by this use case');
  }
}

const build = (
  options: {
    vendorStatus?: VendorStatus;
    ownerStatus?: UserStatus;
    seedOwner?: boolean;
    auditWriter?: AuditWriter;
  } = {},
): {
  useCase: ReinstateVendorUseCase;
  vendorRepository: InMemoryVendorRepository;
  userRepository: InMemoryUserRepository;
  auditWriter: AuditWriter;
} => {
  const {
    vendorStatus = VendorStatus.SUSPENDED,
    ownerStatus = UserStatus.SUSPENDED,
    seedOwner = true,
    auditWriter = new RecordingAuditWriter(),
  } = options;

  const vendorRepository = new InMemoryVendorRepository();
  vendorRepository.seed(profile(vendorStatus));

  const userRepository = new InMemoryUserRepository();
  if (seedOwner) void userRepository.create(owner(ownerStatus));

  const useCase = new ReinstateVendorUseCase({
    vendorRepository,
    userRepository,
    transactionRunner: new FakeTransactionRunner(
      () => ({ vendors: vendorRepository.snapshot(), users: userRepository.snapshot() }),
      (state) => {
        vendorRepository.restore(state.vendors);
        userRepository.restore(state.users);
      },
    ),
    auditWriter,
    clock,
    logger: new NullLogger(),
  });

  return { useCase, vendorRepository, userRepository, auditWriter };
};

describe('ReinstateVendorUseCase', () => {
  it('reinstates a SUSPENDED vendor', async () => {
    const { useCase } = build();

    const reinstated = await useCase.execute({ principal, vendorId });

    expect(reinstated.status).toBe(VendorStatus.ACTIVE);
  });

  it('refuses to reinstate a vendor in any other status — the domain transition table decides, not this use case', async () => {
    const { useCase } = build({ vendorStatus: VendorStatus.ACTIVE });

    await expect(useCase.execute({ principal, vendorId })).rejects.toBeInstanceOf(
      InvalidVendorStatusTransitionError,
    );
  });

  it('reports a missing vendor as not found', async () => {
    const { useCase, vendorRepository } = build();
    vi.spyOn(vendorRepository, 'findById').mockResolvedValueOnce(null);

    await expect(useCase.execute({ principal, vendorId })).rejects.toBeInstanceOf(
      VendorProfileNotFoundError,
    );
  });

  describe('the linked User — reinstate() alone is not enough', () => {
    it('leaves the linked User able to authenticate again — status ACTIVE, not PENDING', async () => {
      // The one asymmetry this use case exists to close: User.reinstate()
      // alone lands on PENDING, which would leave VendorProfile=ACTIVE beside
      // an account that still cannot log in.
      const { useCase, userRepository } = build();

      await useCase.execute({ principal, vendorId });

      const linked = await userRepository.findById(ownerId);
      expect(linked?.status).toBe(UserStatus.ACTIVE);
    });

    it('the reinstated User can authenticate again — assertCanAuthenticate() no longer throws', async () => {
      const { useCase, userRepository } = build();

      await useCase.execute({ principal, vendorId });

      const linked = await userRepository.findById(ownerId);
      expect(() => linked?.assertCanAuthenticate()).not.toThrow();
    });

    it('introduces no new User state — the final status is one of the entity’s own existing states', async () => {
      const { useCase, userRepository } = build();

      await useCase.execute({ principal, vendorId });

      const linked = await userRepository.findById(ownerId);
      expect(linked?.status.name).toBe('ACTIVE');
    });

    it('throws if the vendor has no linked user (data-integrity invariant, not a domain rule)', async () => {
      const { useCase } = build({ seedOwner: false });

      await expect(useCase.execute({ principal, vendorId })).rejects.toThrow(/has no linked user/);
    });
  });

  describe('audit', () => {
    const entryOf = (writer: AuditWriter): AuditWriterInput => {
      const [entry] = (writer as RecordingAuditWriter).entries;
      if (!entry) throw new Error('expected an audit entry');
      return entry;
    };

    it('records exactly one audit event', async () => {
      const auditWriter = new RecordingAuditWriter();
      const { useCase } = build({ auditWriter });

      await useCase.execute({ principal, vendorId });

      expect(auditWriter.entries).toHaveLength(1);
    });

    it('records the reinstated action, the vendor id, and the deciding admin — reason is optional and may be absent', async () => {
      const auditWriter = new RecordingAuditWriter();
      const { useCase } = build({ auditWriter });

      await useCase.execute({ principal, vendorId });

      const entry = entryOf(auditWriter);
      expect(entry.action).toBe(VENDOR_AUDIT_ACTIONS.REINSTATED);
      expect(entry.entityType).toBe('VendorProfile');
      expect(entry.actorId).toBe(admin);
      expect(entry.reason).toBeNull();
      expect(entry.before).toEqual({ status: 'SUSPENDED' });
      expect(entry.after).toEqual({ status: 'ACTIVE' });
    });

    it('records a supplied optional reason verbatim', async () => {
      const auditWriter = new RecordingAuditWriter();
      const { useCase } = build({ auditWriter });

      await useCase.execute({ principal, vendorId, reason: 'Appeal upheld' });

      expect(entryOf(auditWriter).reason).toBe('Appeal upheld');
    });

    it('rolls back BOTH the vendor and the linked User when the audit write fails — never left VendorProfile=ACTIVE beside User=SUSPENDED', async () => {
      const { useCase, vendorRepository, userRepository } = build({
        auditWriter: new FailingAuditWriter(),
      });

      await expect(useCase.execute({ principal, vendorId })).rejects.toThrow(
        /audit log unavailable/,
      );

      expect((await vendorRepository.findById(vendorId))?.status).toBe(VendorStatus.SUSPENDED);
      expect((await userRepository.findById(ownerId))?.status).toBe(UserStatus.SUSPENDED);
    });
  });
});
