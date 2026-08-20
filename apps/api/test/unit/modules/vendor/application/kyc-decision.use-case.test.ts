import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { AuditWriter, AuditWriterInput } from '../../../../../src/modules/audit/index.js';
import { VENDOR_AUDIT_ACTIONS } from '../../../../../src/modules/vendor/domain/audit-actions.js';
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
import {
  FailingAuditWriter,
  RecordingAuditWriter,
  RecordingOutboxWriter,
} from '../../identity/application/fakes.js';

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
    plan: 'COMMISSION',
    shopName: null,
    supportsPickup: false,
    shopAddress: null,
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
  const build = (
    repo = kycRepo(),
    auditWriter: AuditWriter = new RecordingAuditWriter(),
    onRollback?: () => void,
  ): StartKycReviewUseCase =>
    new StartKycReviewUseCase({
      vendorKycRepository: repo,
      transactionRunner: runner(onRollback),
      auditWriter,
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

  describe('audit (KYC-6)', () => {
    const entryOf = (writer: AuditWriter): AuditWriterInput => {
      const [entry] = (writer as RecordingAuditWriter).entries;
      if (!entry) throw new Error('expected an audit entry');
      return entry;
    };

    it('records exactly one audit event for a winning claim', async () => {
      const auditWriter = new RecordingAuditWriter();

      await build(kycRepo(), auditWriter).execute({ principal: principalOf(), kycId });

      expect(auditWriter.entries).toHaveLength(1);
    });

    it('records the review-started action and the claimed kyc id', async () => {
      const auditWriter = new RecordingAuditWriter();

      await build(kycRepo(), auditWriter).execute({ principal: principalOf(), kycId });

      const entry = entryOf(auditWriter);
      expect(entry.action).toBe(VENDOR_AUDIT_ACTIONS.KYC_REVIEW_STARTED);
      expect(entry.entityType).toBe('VendorKyc');
      expect(entry.entityId).toBe(kycId);
    });

    it('takes the reviewer identity from the authenticated principal', async () => {
      const auditWriter = new RecordingAuditWriter();

      await build(kycRepo(), auditWriter).execute({ principal: principalOf(reviewer), kycId });

      const entry = entryOf(auditWriter);
      expect(entry.actorId).toBe(reviewer);
      expect(entry.actorRole).toBe('RISK_ANALYST');
    });

    it('writes no audit row when another reviewer wins the race', async () => {
      const auditWriter = new RecordingAuditWriter();
      const repo = kycRepo({ claimForReviewIfUnclaimed: vi.fn().mockResolvedValue(false) });

      await expect(
        build(repo, auditWriter).execute({ principal: principalOf(), kycId }),
      ).rejects.toBeInstanceOf(KycReviewAlreadyClaimedError);
      expect(auditWriter.entries).toHaveLength(0);
    });

    it('writes no audit row when the domain refuses an already-claimed submission', async () => {
      const auditWriter = new RecordingAuditWriter();
      const claimedByOther = submission().startReview(otherReviewer, NOW);
      const repo = kycRepo({ findById: vi.fn().mockResolvedValue(claimedByOther) });

      await expect(
        build(repo, auditWriter).execute({ principal: principalOf(), kycId }),
      ).rejects.toThrow();
      expect(auditWriter.entries).toHaveLength(0);
    });

    it('rolls back the claim when the audit write fails', async () => {
      let rolledBack = false;

      await expect(
        build(kycRepo(), new FailingAuditWriter(), () => {
          rolledBack = true;
        }).execute({ principal: principalOf(), kycId }),
      ).rejects.toThrow(/audit log unavailable/);

      expect(rolledBack).toBe(true);
    });
  });
});

describe('DecideVendorKycUseCase', () => {
  const claimed = (): VendorKyc => submission().startReview(reviewer, NOW);

  const build = (
    kyc: VendorKycRepository = kycRepo({ findById: vi.fn().mockResolvedValue(claimed()) }),
    vendor: VendorRepository = vendorRepo(),
    onRollback?: () => void,
    auditWriter: AuditWriter = new RecordingAuditWriter(),
  ): DecideVendorKycUseCase =>
    new DecideVendorKycUseCase({
      vendorKycRepository: kyc,
      vendorRepository: vendor,
      transactionRunner: runner(onRollback),
      auditWriter,
      outboxWriter: new RecordingOutboxWriter(),
      clock,
      logger: new NullLogger(),
    });

  describe('published events (S6-NOTIFY-LIFECYCLE)', () => {
    /** Built directly rather than through `build`, so the recorder is reachable for assertions. */
    const withOutbox = (
      outboxWriter: RecordingOutboxWriter,
      auditWriter: AuditWriter = new RecordingAuditWriter(),
      onRollback?: () => void,
    ): DecideVendorKycUseCase =>
      new DecideVendorKycUseCase({
        vendorKycRepository: kycRepo({ findById: vi.fn().mockResolvedValue(claimed()) }),
        vendorRepository: vendorRepo(),
        transactionRunner: runner(onRollback),
        auditWriter,
        outboxWriter,
        clock,
        logger: new NullLogger(),
      });
    it('publishes exactly one kyc.approved on approval', async () => {
      const outbox = new RecordingOutboxWriter();

      await withOutbox(outbox).execute({
        principal: principalOf(),
        kycId,
        command: { decision: 'APPROVE' },
      });

      expect(outbox.events).toHaveLength(1);
      expect(outbox.events[0]).toMatchObject({
        eventType: 'kyc.approved',
        aggregateType: 'VendorProfile',
      });
    });

    it('publishes exactly one kyc.rejected on rejection', async () => {
      const outbox = new RecordingOutboxWriter();

      await withOutbox(outbox).execute({
        principal: principalOf(),
        kycId,
        command: { decision: 'REJECT', reason: 'OTHER', note: 'reviewer prose' },
      });

      expect(outbox.events).toHaveLength(1);
      expect(outbox.events[0]?.eventType).toBe('kyc.rejected');
    });

    it('names the vendor, which is the only identity the consumer needs', async () => {
      const outbox = new RecordingOutboxWriter();

      await withOutbox(outbox).execute({
        principal: principalOf(),
        kycId,
        command: { decision: 'APPROVE' },
      });

      expect(outbox.events[0]?.payload).toHaveProperty('vendorId');
    });

    it('never puts the rejection reason or the reviewer’s note in the payload', async () => {
      const outbox = new RecordingOutboxWriter();
      const note = 'internal reviewer prose about this vendor';

      await withOutbox(outbox).execute({
        principal: principalOf(),
        kycId,
        command: { decision: 'REJECT', reason: 'OTHER', note },
      });

      expect(JSON.stringify(outbox.events)).not.toContain(note);
    });

    it('publishes nothing when the transaction rolls back', async () => {
      const outbox = new RecordingOutboxWriter();
      let rolledBack = false;

      await expect(
        withOutbox(outbox, new FailingAuditWriter(), () => {
          rolledBack = true;
        }).execute({ principal: principalOf(), kycId, command: { decision: 'APPROVE' } }),
      ).rejects.toThrow();

      expect(rolledBack).toBe(true);
      expect(outbox.events).toHaveLength(0);
    });
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

  describe('audit (KYC-6)', () => {
    const entryOf = (writer: AuditWriter): AuditWriterInput => {
      const [entry] = (writer as RecordingAuditWriter).entries;
      if (!entry) throw new Error('expected an audit entry');
      return entry;
    };

    describe('approval', () => {
      it('records exactly one audit event', async () => {
        const auditWriter = new RecordingAuditWriter();

        await build(undefined, undefined, undefined, auditWriter).execute({
          principal: principalOf(),
          kycId,
          command: { decision: 'APPROVE' },
        });

        expect(auditWriter.entries).toHaveLength(1);
      });

      it('records the approved action, kyc id and deciding admin', async () => {
        const auditWriter = new RecordingAuditWriter();

        await build(undefined, undefined, undefined, auditWriter).execute({
          principal: principalOf(reviewer),
          kycId,
          command: { decision: 'APPROVE' },
        });

        const entry = entryOf(auditWriter);
        expect(entry.action).toBe(VENDOR_AUDIT_ACTIONS.KYC_APPROVED);
        expect(entry.entityType).toBe('VendorKyc');
        expect(entry.entityId).toBe(kycId);
        expect(entry.actorId).toBe(reviewer);
        expect(entry.actorRole).toBe('RISK_ANALYST');
      });

      it('carries no sensitive KYC material in the audit payload', async () => {
        const auditWriter = new RecordingAuditWriter();

        await build(undefined, undefined, undefined, auditWriter).execute({
          principal: principalOf(),
          kycId,
          command: { decision: 'APPROVE' },
        });

        const serialised = JSON.stringify(entryOf(auditWriter));
        expect(serialised).not.toContain('panFingerprint');
        expect(serialised).not.toContain('bankFingerprint');
        expect(serialised).not.toContain('wrappedDataKey');
      });

      it('writes no audit row when the decision write loses the race', async () => {
        const auditWriter = new RecordingAuditWriter();
        const kyc = kycRepo({
          findById: vi.fn().mockResolvedValue(claimed()),
          saveDecisionIfUndecided: vi.fn().mockResolvedValue(false),
        });

        await expect(
          build(kyc, vendorRepo(), undefined, auditWriter).execute({
            principal: principalOf(),
            kycId,
            command: { decision: 'APPROVE' },
          }),
        ).rejects.toBeInstanceOf(KycAlreadyDecidedError);
        expect(auditWriter.entries).toHaveLength(0);
      });

      it('rolls back both the decision and the vendor transition when the audit write fails', async () => {
        let rolledBack = false;
        const vendor = vendorRepo();
        const vendorUpdate = vi.spyOn(vendor, 'update');

        await expect(
          build(
            undefined,
            vendor,
            () => {
              rolledBack = true;
            },
            new FailingAuditWriter(),
          ).execute({
            principal: principalOf(),
            kycId,
            command: { decision: 'APPROVE' },
          }),
        ).rejects.toThrow(/audit log unavailable/);

        // The write itself happened (it is what the audit failure must undo);
        // `rolledBack` proves the surrounding transaction unwound it.
        expect(vendorUpdate).toHaveBeenCalledTimes(1);
        expect(rolledBack).toBe(true);
      });
    });

    describe('rejection', () => {
      it('records exactly one audit event', async () => {
        const auditWriter = new RecordingAuditWriter();

        await build(undefined, undefined, undefined, auditWriter).execute({
          principal: principalOf(),
          kycId,
          command: { decision: 'REJECT', reason: 'DOCUMENT_UNCLEAR' },
        });

        expect(auditWriter.entries).toHaveLength(1);
      });

      it('records the rejected action, kyc id and deciding admin', async () => {
        const auditWriter = new RecordingAuditWriter();

        await build(undefined, undefined, undefined, auditWriter).execute({
          principal: principalOf(reviewer),
          kycId,
          command: { decision: 'REJECT', reason: 'DOCUMENT_UNCLEAR' },
        });

        const entry = entryOf(auditWriter);
        expect(entry.action).toBe(VENDOR_AUDIT_ACTIONS.KYC_REJECTED);
        expect(entry.entityType).toBe('VendorKyc');
        expect(entry.entityId).toBe(kycId);
        expect(entry.actorId).toBe(reviewer);
      });

      it('records the coded rejection reason and nothing else about the rejection', async () => {
        const auditWriter = new RecordingAuditWriter();

        await build(undefined, undefined, undefined, auditWriter).execute({
          principal: principalOf(),
          kycId,
          command: { decision: 'REJECT', reason: 'BANK_DETAILS_MISMATCH' },
        });

        expect(entryOf(auditWriter).reason).toBe('BANK_DETAILS_MISMATCH');
      });

      it('never records the reviewer free-text note', async () => {
        const auditWriter = new RecordingAuditWriter();
        const note = 'Business name on the certificate does not match the application.';

        await build(undefined, undefined, undefined, auditWriter).execute({
          principal: principalOf(),
          kycId,
          command: { decision: 'REJECT', reason: 'OTHER', note },
        });

        const serialised = JSON.stringify(entryOf(auditWriter));
        expect(serialised).not.toContain(note);
        expect(entryOf(auditWriter).reason).toBe('OTHER');
      });

      it('writes no audit row when the decision write loses the race', async () => {
        const auditWriter = new RecordingAuditWriter();
        const kyc = kycRepo({
          findById: vi.fn().mockResolvedValue(claimed()),
          saveDecisionIfUndecided: vi.fn().mockResolvedValue(false),
        });

        await expect(
          build(kyc, vendorRepo(), undefined, auditWriter).execute({
            principal: principalOf(),
            kycId,
            command: { decision: 'REJECT', reason: 'DOCUMENT_UNCLEAR' },
          }),
        ).rejects.toBeInstanceOf(KycAlreadyDecidedError);
        expect(auditWriter.entries).toHaveLength(0);
      });

      it('rolls back both the decision and the vendor transition when the audit write fails', async () => {
        let rolledBack = false;

        await expect(
          build(
            undefined,
            undefined,
            () => {
              rolledBack = true;
            },
            new FailingAuditWriter(),
          ).execute({
            principal: principalOf(),
            kycId,
            command: { decision: 'REJECT', reason: 'DOCUMENT_UNCLEAR' },
          }),
        ).rejects.toThrow(/audit log unavailable/);

        expect(rolledBack).toBe(true);
      });
    });
  });
});
