import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { AuditWriter, AuditWriterInput } from '../../../../../src/modules/audit/index.js';
import { VENDOR_AUDIT_ACTIONS } from '../../../../../src/modules/vendor/domain/audit-actions.js';
import { SuspendVendorUseCase } from '../../../../../src/modules/vendor/application/use-cases/suspend-vendor.use-case.js';
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
  InMemoryRefreshTokenRepository,
  InMemorySessionDenylist,
  InMemoryUserRepository,
  RecordingAuditWriter,
} from '../../identity/application/fakes.js';
import { Session } from '../../../../../src/modules/identity/domain/entities/session.entity.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);
const vendorId = toVendorId(ids.generate());
const ownerId = toUserId(ids.generate());
const admin = toUserId(ids.generate());
const ACCESS_TTL = 600;

const principal: Principal = {
  userId: admin,
  sessionId: toSessionId(ids.generate()),
  role: 'RISK_ANALYST',
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

const owner = (status: UserStatus = UserStatus.ACTIVE, userId: UserId = ownerId): User =>
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

/** Snapshots and restores both stores on rollback — the same shape `register-vendor.use-case.test.ts`'s own `FakeTransactionRunner` uses, so the atomicity assertions prove the store actually reverted, not just that a callback fired. */
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
  useCase: SuspendVendorUseCase;
  vendorRepository: InMemoryVendorRepository;
  userRepository: InMemoryUserRepository;
  sessionRepository: InMemoryRefreshTokenRepository;
  sessionDenylist: InMemorySessionDenylist;
  auditWriter: AuditWriter;
} => {
  const {
    vendorStatus = VendorStatus.ACTIVE,
    ownerStatus = UserStatus.ACTIVE,
    seedOwner = true,
    auditWriter = new RecordingAuditWriter(),
  } = options;

  const vendorRepository = new InMemoryVendorRepository();
  vendorRepository.seed(profile(vendorStatus));

  const userRepository = new InMemoryUserRepository();
  if (seedOwner) void userRepository.create(owner(ownerStatus));

  const sessionRepository = new InMemoryRefreshTokenRepository();
  const sessionDenylist = new InMemorySessionDenylist();

  const useCase = new SuspendVendorUseCase({
    vendorRepository,
    userRepository,
    sessionRepository,
    sessionDenylist,
    transactionRunner: new FakeTransactionRunner(
      () => ({ vendors: vendorRepository.snapshot(), users: userRepository.snapshot() }),
      (state) => {
        vendorRepository.restore(state.vendors);
        userRepository.restore(state.users);
      },
    ),
    auditWriter,
    accessTokenTtlSeconds: ACCESS_TTL,
    clock,
    logger: new NullLogger(),
  });

  return {
    useCase,
    vendorRepository,
    userRepository,
    sessionRepository,
    sessionDenylist,
    auditWriter,
  };
};

const REASON = 'Repeated late fulfilment (risk case #4821)';

describe('SuspendVendorUseCase', () => {
  it('suspends an ACTIVE vendor', async () => {
    const { useCase } = build();

    const suspended = await useCase.execute({ principal, vendorId, reason: REASON });

    expect(suspended.status).toBe(VendorStatus.SUSPENDED);
  });

  it('refuses to suspend a vendor in any other status — the domain transition table decides, not this use case', async () => {
    const { useCase } = build({ vendorStatus: VendorStatus.KYC_APPROVED });

    await expect(useCase.execute({ principal, vendorId, reason: REASON })).rejects.toBeInstanceOf(
      InvalidVendorStatusTransitionError,
    );
  });

  it('reports a missing vendor as not found', async () => {
    const { useCase, vendorRepository } = build();
    vi.spyOn(vendorRepository, 'findById').mockResolvedValueOnce(null);

    await expect(useCase.execute({ principal, vendorId, reason: REASON })).rejects.toBeInstanceOf(
      VendorProfileNotFoundError,
    );
  });

  describe('the linked User — the load-bearing part of this use case', () => {
    it('suspends the linked User account, not just the vendor profile', async () => {
      const { useCase, userRepository } = build();

      await useCase.execute({ principal, vendorId, reason: REASON });

      const linked = await userRepository.findById(ownerId);
      expect(linked?.status).toBe(UserStatus.SUSPENDED);
    });

    it('the suspended User can no longer authenticate — assertCanAuthenticate() now throws', async () => {
      const { useCase, userRepository } = build();

      await useCase.execute({ principal, vendorId, reason: REASON });

      const linked = await userRepository.findById(ownerId);
      expect(() => linked?.assertCanAuthenticate()).toThrow();
    });

    it('throws if the vendor has no linked user (data-integrity invariant, not a domain rule)', async () => {
      const { useCase } = build({ seedOwner: false });

      await expect(useCase.execute({ principal, vendorId, reason: REASON })).rejects.toThrow(
        /has no linked user/,
      );
    });
  });

  describe('session revocation (SDD 7.2)', () => {
    it('revokes every session the vendor account holds', async () => {
      const { useCase, sessionRepository } = build();
      const sessionIds = [toSessionId(ids.generate()), toSessionId(ids.generate())];
      for (const id of sessionIds) {
        void sessionRepository.create(
          Session.reconstitute({
            id,
            userId: ownerId,
            familyId: id,
            tokenHash: `hash-${id}`,
            expiresAt: new Date(NOW.getTime() + 86_400_000),
            revokedAt: null,
            replacedByTokenId: null,
            createdAt: NOW,
          }),
        );
      }

      await useCase.execute({ principal, vendorId, reason: REASON });

      const live = await sessionRepository.revokeAllForUser(ownerId, NOW);
      expect(live).toEqual([]);
    });

    it('denies every session id — an already-issued access token must fail its next check', async () => {
      const { useCase, sessionRepository, sessionDenylist } = build();
      const sessionId = toSessionId(ids.generate());
      void sessionRepository.create(
        Session.reconstitute({
          id: sessionId,
          userId: ownerId,
          familyId: sessionId,
          tokenHash: 'hash-x',
          expiresAt: new Date(NOW.getTime() + 86_400_000),
          revokedAt: null,
          replacedByTokenId: null,
          createdAt: NOW,
        }),
      );

      await useCase.execute({ principal, vendorId, reason: REASON });

      expect(await sessionDenylist.isDenied(sessionId)).toBe(true);
      expect(sessionDenylist.denied.get(sessionId)).toBe(ACCESS_TTL);
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

      await useCase.execute({ principal, vendorId, reason: REASON });

      expect(auditWriter.entries).toHaveLength(1);
    });

    it('records the suspended action, the vendor id, the deciding admin, and the exact supplied reason', async () => {
      const auditWriter = new RecordingAuditWriter();
      const { useCase } = build({ auditWriter });

      await useCase.execute({ principal, vendorId, reason: REASON });

      const entry = entryOf(auditWriter);
      expect(entry.action).toBe(VENDOR_AUDIT_ACTIONS.SUSPENDED);
      expect(entry.entityType).toBe('VendorProfile');
      expect(entry.actorId).toBe(admin);
      expect(entry.reason).toBe(REASON);
      expect(entry.before).toEqual({ status: 'ACTIVE' });
      expect(entry.after).toEqual({ status: 'SUSPENDED' });
    });

    it('rolls back BOTH the vendor and the linked User when the audit write fails — never half-suspended', async () => {
      const { useCase, vendorRepository, userRepository } = build({
        auditWriter: new FailingAuditWriter(),
      });

      await expect(useCase.execute({ principal, vendorId, reason: REASON })).rejects.toThrow(
        /audit log unavailable/,
      );

      expect((await vendorRepository.findById(vendorId))?.status).toBe(VendorStatus.ACTIVE);
      expect((await userRepository.findById(ownerId))?.status).toBe(UserStatus.ACTIVE);
    });
  });
});
