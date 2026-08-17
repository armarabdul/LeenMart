import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { AuditWriter, AuditWriterInput } from '../../../../../src/modules/audit/index.js';
import { VENDOR_AUDIT_ACTIONS } from '../../../../../src/modules/vendor/domain/audit-actions.js';
import { ActivateVendorUseCase } from '../../../../../src/modules/vendor/application/use-cases/activate-vendor.use-case.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorProfileNotFoundError } from '../../../../../src/modules/vendor/domain/errors/vendor-errors.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import { InvalidVendorStatusTransitionError } from '../../../../../src/modules/vendor/domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { FailingAuditWriter, RecordingAuditWriter } from '../../identity/application/fakes.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);
const vendorId = toVendorId(ids.generate());
const admin = toUserId(ids.generate());

const principal: Principal = {
  userId: admin,
  sessionId: toSessionId(ids.generate()),
  role: 'RISK_ANALYST',
};

const profile = (status: VendorStatus): VendorProfile =>
  VendorProfile.reconstitute({
    id: vendorId,
    userId: toUserId(ids.generate()),
    status,
    plan: 'COMMISSION',
    shopName: null,
    supportsPickup: false,
    shopAddress: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

const runner = (onRollback?: () => void): TransactionRunner => ({
  run: async (work) => {
    try {
      return await work({} as TransactionScope);
    } catch (error) {
      onRollback?.();
      throw error;
    }
  },
});

const vendorRepo = (
  status: VendorStatus = VendorStatus.KYC_APPROVED,
  overrides: Partial<VendorRepository> = {},
): VendorRepository => {
  const repository: VendorRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn().mockResolvedValue(profile(status)),
    findByUserId: vi.fn(),
    ...overrides,
  };
  return repository;
};

const build = (
  vendor: VendorRepository = vendorRepo(),
  auditWriter: AuditWriter = new RecordingAuditWriter(),
  onRollback?: () => void,
): ActivateVendorUseCase =>
  new ActivateVendorUseCase({
    vendorRepository: vendor,
    transactionRunner: runner(onRollback),
    auditWriter,
    clock,
    logger: new NullLogger(),
  });

describe('ActivateVendorUseCase', () => {
  it('activates a KYC_APPROVED vendor', async () => {
    const activated = await build().execute({ principal, vendorId });

    expect(activated.status).toBe(VendorStatus.ACTIVE);
  });

  it('refuses to activate a vendor in any other status — the domain transition table decides, not this use case', async () => {
    const useCase = build(vendorRepo(VendorStatus.KYC_UNDER_REVIEW));

    await expect(useCase.execute({ principal, vendorId })).rejects.toBeInstanceOf(
      InvalidVendorStatusTransitionError,
    );
  });

  it('reports a missing vendor as not found', async () => {
    const useCase = build(
      vendorRepo(VendorStatus.KYC_APPROVED, { findById: vi.fn().mockResolvedValue(null) }),
    );

    await expect(useCase.execute({ principal, vendorId })).rejects.toBeInstanceOf(
      VendorProfileNotFoundError,
    );
  });

  describe('audit', () => {
    const entryOf = (writer: AuditWriter): AuditWriterInput => {
      const [entry] = (writer as RecordingAuditWriter).entries;
      if (!entry) throw new Error('expected an audit entry');
      return entry;
    };

    it('records exactly one audit event', async () => {
      const auditWriter = new RecordingAuditWriter();
      await build(vendorRepo(), auditWriter).execute({ principal, vendorId });

      expect(auditWriter.entries).toHaveLength(1);
    });

    it('records the activated action, the vendor id and the deciding admin', async () => {
      const auditWriter = new RecordingAuditWriter();
      await build(vendorRepo(), auditWriter).execute({ principal, vendorId });

      const entry = entryOf(auditWriter);
      expect(entry.action).toBe(VENDOR_AUDIT_ACTIONS.ACTIVATED);
      expect(entry.entityType).toBe('VendorProfile');
      expect(entry.actorId).toBe(admin);
    });

    it('rolls back the vendor transition when the audit write fails', async () => {
      let rolledBack = false;
      const vendor = vendorRepo();
      const vendorUpdate = vi.spyOn(vendor, 'update');

      await expect(
        build(vendor, new FailingAuditWriter(), () => {
          rolledBack = true;
        }).execute({ principal, vendorId }),
      ).rejects.toThrow(/audit log unavailable/);

      expect(vendorUpdate).toHaveBeenCalledTimes(1);
      expect(rolledBack).toBe(true);
    });
  });
});
