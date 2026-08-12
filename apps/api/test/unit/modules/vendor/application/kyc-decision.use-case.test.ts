import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import { StartKycReviewUseCase } from '../../../../../src/modules/vendor/application/use-cases/start-kyc-review.use-case.js';
import { DecideVendorKycUseCase } from '../../../../../src/modules/vendor/application/use-cases/decide-vendor-kyc.use-case.js';
import {
  KycAlreadyDecidedError,
  KycReviewAlreadyClaimedError,
  KycSubmissionNotFoundError,
} from '../../../../../src/modules/vendor/domain/errors/kyc-errors.js';
import { VendorKyc } from '../../../../../src/modules/vendor/domain/entities/vendor-kyc.entity.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { KycDocument } from '../../../../../src/modules/vendor/domain/entities/kyc-document.entity.js';
import { KycDocumentType } from '../../../../../src/modules/vendor/domain/value-objects/kyc-document-type.value-object.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import { toKycDocumentId } from '../../../../../src/modules/vendor/domain/value-objects/kyc-document-id.value-object.js';
import { toKycId } from '../../../../../src/modules/vendor/domain/value-objects/kyc-id.value-object.js';
import type { SensitiveFingerprint } from '../../../../../src/modules/vendor/domain/value-objects/sensitive-fingerprint.value-object.js';
import type { VendorKycRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor-kyc.repository.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-02-01T00:00:00.000Z');
const clock = new FixedClock(NOW);

const kycId = toKycId(ids.generate());
const vendorId = toVendorId(ids.generate());
const reviewer = toUserId(ids.generate());
const otherReviewer = toUserId(ids.generate());

const principalOf = (userId = reviewer): Principal => ({
  userId,
  sessionId: toSessionId(ids.generate()),
  role: 'RISK_ANALYST',
});

const submission = (): VendorKyc =>
  VendorKyc.submit({
    id: kycId,
    vendorId,
    identifiers: {
      panFingerprint: 'a'.repeat(64) as SensitiveFingerprint,
      panLast4: '234F',
      gstin: '27ABCDE1234F1Z0',
      bankFingerprint: 'b'.repeat(64) as SensitiveFingerprint,
      bankAccountLast4: '9012',
      ifsc: 'HDFC0001234',
    },
    documents: KycDocumentType.REQUIRED.map((type) =>
      KycDocument.awaitUpload({
        id: toKycDocumentId(ids.generate()),
        type,
        objectKey: `vendor/${vendorId}/${kycId}/${type.name}.enc`,
        wrappedDataKey: Buffer.from('wrapped'),
        contentType: 'application/pdf',
        sizeBytes: 1024,
        now: NOW,
      }).markUploaded(NOW),
    ),
    now: NOW,
  });

const profile = (status: VendorStatus): VendorProfile =>
  VendorProfile.reconstitute({
    id: vendorId,
    userId: toUserId(ids.generate()),
    status,
    createdAt: NOW,
    updatedAt: NOW,
  });

/** Runs the callback and rolls nothing back — failure propagates, as a real transaction's would. */
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

const kycRepo = (overrides: Partial<VendorKycRepository> = {}): VendorKycRepository => {
  const repository: VendorKycRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(submission()),
    findCurrentByVendorId: vi.fn(),
    listByVendorId: vi.fn(),
    saveReview: vi.fn(),
    claimForReviewIfUnclaimed: vi.fn().mockResolvedValue(true),
    saveDecisionIfUndecided: vi.fn().mockResolvedValue(true),
    findByIdentifierFingerprints: vi.fn(),
    ...overrides,
  };
  return repository;
};

const vendorRepo = (
  status = VendorStatus.KYC_UNDER_REVIEW,
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

/**
 * Domain-rule messages are deliberately uniform (SEC-15); what names the broken
 * rule is `details`. Same helper shape the KYC-1 domain tests use.
 */
const issueOf = async (act: () => Promise<unknown>): Promise<string> => {
  try {
    await act();
    return 'did not throw';
  } catch (error) {
    const failure = error as { details?: { field: string; issue: string }[] };
    return failure.details?.[0]?.issue ?? 'no detail';
  }
};

describe('StartKycReviewUseCase', () => {
  const build = (repo = kycRepo()): StartKycReviewUseCase =>
    new StartKycReviewUseCase({
      vendorKycRepository: repo,
      transactionRunner: runner(),
      clock,
      logger: new NullLogger(),
    });

  it('records the claiming administrator from the verified principal', async () => {
    // Never from the request body — that would let one admin record work under
    // a colleague's name.
    const { kyc } = await build().execute({ principal: principalOf(), kycId });

    expect(kyc.review?.reviewedBy).toBe(reviewer);
  });

  it('stamps the claim time from the injected clock', async () => {
    const { kyc } = await build().execute({ principal: principalOf(), kycId });

    expect(kyc.review?.startedAt).toEqual(NOW);
  });

  it('decides nothing — a claim is not a decision', async () => {
    const { kyc } = await build().execute({ principal: principalOf(), kycId });

    expect(kyc.review?.decidedBy).toBeNull();
    expect(kyc.review?.decidedAt).toBeNull();
    expect(kyc.isDecided()).toBe(false);
  });

  it('persists through the conditional claim, never saveReview', async () => {
    const repo = kycRepo();
    await build(repo).execute({ principal: principalOf(), kycId });

    expect(repo.claimForReviewIfUnclaimed).toHaveBeenCalledTimes(1);
    expect(repo.saveReview).not.toHaveBeenCalled();
  });

  it('throws the conflict error when another reviewer won the race', async () => {
    const repo = kycRepo({ claimForReviewIfUnclaimed: vi.fn().mockResolvedValue(false) });

    await expect(build(repo).execute({ principal: principalOf(), kycId })).rejects.toBeInstanceOf(
      KycReviewAlreadyClaimedError,
    );
  });

  it('lets the domain refuse a submission already claimed', async () => {
    // The ordinary case, caught by the aggregate before any write.
    const claimed = submission().startReview(otherReviewer, NOW);
    const repo = kycRepo({ findById: vi.fn().mockResolvedValue(claimed) });

    expect(await issueOf(() => build(repo).execute({ principal: principalOf(), kycId }))).toMatch(
      /already under review/,
    );
    expect(repo.claimForReviewIfUnclaimed).not.toHaveBeenCalled();
  });

  it('reports a missing submission as not found', async () => {
    const repo = kycRepo({ findById: vi.fn().mockResolvedValue(null) });

    await expect(build(repo).execute({ principal: principalOf(), kycId })).rejects.toBeInstanceOf(
      KycSubmissionNotFoundError,
    );
  });
});

describe('DecideVendorKycUseCase', () => {
  const claimed = (): VendorKyc => submission().startReview(reviewer, NOW);

  const build = (
    kyc: VendorKycRepository = kycRepo({ findById: vi.fn().mockResolvedValue(claimed()) }),
    vendor: VendorRepository = vendorRepo(),
    onRollback?: () => void,
  ): DecideVendorKycUseCase =>
    new DecideVendorKycUseCase({
      vendorKycRepository: kyc,
      vendorRepository: vendor,
      transactionRunner: runner(onRollback),
      clock,
      logger: new NullLogger(),
    });

  describe('approval', () => {
    it('records the deciding administrator and the time', async () => {
      const { kyc } = await build().execute({
        principal: principalOf(),
        kycId,
        command: { decision: 'APPROVE' },
      });

      expect(kyc.review?.decidedBy).toBe(reviewer);
      expect(kyc.review?.decidedAt).toEqual(NOW);
      expect(kyc.isApproved()).toBe(true);
    });

    it('moves the vendor to KYC_APPROVED and stops there', async () => {
      // Activation is a separate step in SDD 15.1 with its own consequences.
      const { vendor } = await build().execute({
        principal: principalOf(),
        kycId,
        command: { decision: 'APPROVE' },
      });

      expect(vendor.status).toBe(VendorStatus.KYC_APPROVED);
      expect(vendor.status).not.toBe(VendorStatus.ACTIVE);
    });

    it('refuses a submission nobody claimed', async () => {
      const repo = kycRepo({ findById: vi.fn().mockResolvedValue(submission()) });

      expect(
        await issueOf(() =>
          build(repo).execute({
            principal: principalOf(),
            kycId,
            command: { decision: 'APPROVE' },
          }),
        ),
      ).toMatch(/not been claimed/);
    });

    it('persists through the conditional decision, never saveReview', async () => {
      const repo = kycRepo({ findById: vi.fn().mockResolvedValue(claimed()) });
      await build(repo).execute({
        principal: principalOf(),
        kycId,
        command: { decision: 'APPROVE' },
      });

      expect(repo.saveDecisionIfUndecided).toHaveBeenCalledTimes(1);
      expect(repo.saveReview).not.toHaveBeenCalled();
    });
  });

  describe('rejection', () => {
    it.each([
      'DOCUMENT_UNCLEAR',
      'DOCUMENT_INVALID',
      'DETAILS_MISMATCH',
      'BANK_DETAILS_MISMATCH',
      'DUPLICATE_IDENTITY',
    ])('accepts %s without a note', async (reason) => {
      const { kyc, vendor } = await build(
        kycRepo({ findById: vi.fn().mockResolvedValue(claimed()) }),
        vendorRepo(),
      ).execute({ principal: principalOf(), kycId, command: { decision: 'REJECT', reason } });

      expect(kyc.review?.rejectionReason?.name).toBe(reason);
      expect(vendor.status).toBe(VendorStatus.KYC_REJECTED);
    });

    it('requires a note for OTHER, through the domain rule', async () => {
      expect(
        await issueOf(() =>
          build().execute({
            principal: principalOf(),
            kycId,
            command: { decision: 'REJECT', reason: 'OTHER' },
          }),
        ),
      ).toMatch(/must carry an explanation/);
    });

    it('accepts OTHER when explained', async () => {
      const { kyc } = await build().execute({
        principal: principalOf(),
        kycId,
        command: { decision: 'REJECT', reason: 'OTHER', note: 'Business name mismatch.' },
      });

      expect(kyc.review?.rejectionNote).toBe('Business name mismatch.');
    });

    it('rejects a reason outside the closed set', async () => {
      await expect(
        build().execute({
          principal: principalOf(),
          kycId,
          command: { decision: 'REJECT', reason: 'BECAUSE_I_SAID_SO' },
        }),
      ).rejects.toThrow(/not valid/);
    });

    it('does not activate or resubmit', async () => {
      const { vendor } = await build().execute({
        principal: principalOf(),
        kycId,
        command: { decision: 'REJECT', reason: 'DOCUMENT_UNCLEAR' },
      });

      expect(vendor.status).toBe(VendorStatus.KYC_REJECTED);
    });
  });

  describe('atomicity', () => {
    it('writes the KYC decision before the vendor transition', async () => {
      // The KYC row is the arbiter: a competing decider must block on it.
      const order: string[] = [];
      const kyc = kycRepo({
        findById: vi.fn().mockResolvedValue(claimed()),
        saveDecisionIfUndecided: vi.fn(() => {
          order.push('kyc');
          return Promise.resolve(true);
        }),
      });
      const vendor = vendorRepo(VendorStatus.KYC_UNDER_REVIEW, {
        update: vi.fn(() => {
          order.push('vendor');
          return Promise.resolve();
        }),
      });

      await build(kyc, vendor).execute({
        principal: principalOf(),
        kycId,
        command: { decision: 'APPROVE' },
      });

      expect(order).toEqual(['kyc', 'vendor']);
    });

    it('rolls back when the vendor update fails after the decision was written', async () => {
      let rolledBack = false;
      const vendor = vendorRepo(VendorStatus.KYC_UNDER_REVIEW, {
        update: vi.fn().mockRejectedValue(new Error('vendor update failed')),
      });

      await expect(
        build(kycRepo({ findById: vi.fn().mockResolvedValue(claimed()) }), vendor, () => {
          rolledBack = true;
        }).execute({ principal: principalOf(), kycId, command: { decision: 'APPROVE' } }),
      ).rejects.toThrow('vendor update failed');

      expect(rolledBack).toBe(true);
    });

    it('never touches the vendor when the decision write loses', async () => {
      const vendor = vendorRepo();
      const kyc = kycRepo({
        findById: vi.fn().mockResolvedValue(claimed()),
        saveDecisionIfUndecided: vi.fn().mockResolvedValue(false),
      });

      await expect(
        build(kyc, vendor).execute({
          principal: principalOf(),
          kycId,
          command: { decision: 'APPROVE' },
        }),
      ).rejects.toBeInstanceOf(KycAlreadyDecidedError);
      expect(vendor.update).not.toHaveBeenCalled();
    });

    it('rolls back when the decision write itself fails', async () => {
      let rolledBack = false;
      const kyc = kycRepo({
        findById: vi.fn().mockResolvedValue(claimed()),
        saveDecisionIfUndecided: vi.fn().mockRejectedValue(new Error('kyc write failed')),
      });

      await expect(
        build(kyc, vendorRepo(), () => {
          rolledBack = true;
        }).execute({ principal: principalOf(), kycId, command: { decision: 'APPROVE' } }),
      ).rejects.toThrow('kyc write failed');

      expect(rolledBack).toBe(true);
    });

    it('runs both repositories inside the same transaction scope', async () => {
      const kyc = kycRepo({ findById: vi.fn().mockResolvedValue(claimed()) });
      const vendor = vendorRepo();
      const kycScoped = vi.spyOn(kyc, 'withTransaction');
      const vendorScoped = vi.spyOn(vendor, 'withTransaction');

      await build(kyc, vendor).execute({
        principal: principalOf(),
        kycId,
        command: { decision: 'APPROVE' },
      });

      expect(kycScoped).toHaveBeenCalledTimes(1);
      expect(vendorScoped).toHaveBeenCalledTimes(1);
    });
  });

  describe('conflicts', () => {
    it('reports a lost decision race as a conflict, not a silent overwrite', async () => {
      const repo = kycRepo({
        findById: vi.fn().mockResolvedValue(claimed()),
        saveDecisionIfUndecided: vi.fn().mockResolvedValue(false),
      });

      await expect(
        build(repo).execute({ principal: principalOf(), kycId, command: { decision: 'APPROVE' } }),
      ).rejects.toBeInstanceOf(KycAlreadyDecidedError);
    });

    it('lets the domain refuse a submission already decided', async () => {
      const decided = claimed().approve(otherReviewer, NOW);
      const repo = kycRepo({ findById: vi.fn().mockResolvedValue(decided) });

      expect(
        await issueOf(() =>
          build(repo).execute({
            principal: principalOf(),
            kycId,
            command: { decision: 'APPROVE' },
          }),
        ),
      ).toMatch(/already been decided/);
    });

    it('reports a missing submission as not found', async () => {
      const repo = kycRepo({ findById: vi.fn().mockResolvedValue(null) });

      await expect(
        build(repo).execute({ principal: principalOf(), kycId, command: { decision: 'APPROVE' } }),
      ).rejects.toBeInstanceOf(KycSubmissionNotFoundError);
    });
  });
});
