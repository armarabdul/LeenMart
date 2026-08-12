import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator, type TransactionScope } from '@leen-mart/domain-kit';
import { PrismaVendorKycRepository } from '../../src/modules/vendor/infrastructure/persistence/prisma-vendor-kyc.repository.js';
import { runWithTenant } from '../../src/shared/infrastructure/persistence/tenant-context.js';
import { runInTenantTransaction } from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import { HmacIdentifierFingerprinter } from '../../src/modules/vendor/infrastructure/security/hmac-identifier-fingerprinter.js';
import { KycDocument } from '../../src/modules/vendor/domain/entities/kyc-document.entity.js';
import {
  VendorKyc,
  type KycIdentifiers,
} from '../../src/modules/vendor/domain/entities/vendor-kyc.entity.js';
import { VendorProfile } from '../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { KycDocumentType } from '../../src/modules/vendor/domain/value-objects/kyc-document-type.value-object.js';
import { KycRejectionReason } from '../../src/modules/vendor/domain/value-objects/kyc-rejection-reason.value-object.js';
import { toKycDocumentId } from '../../src/modules/vendor/domain/value-objects/kyc-document-id.value-object.js';
import { toKycId } from '../../src/modules/vendor/domain/value-objects/kyc-id.value-object.js';
import { Pan } from '../../src/modules/vendor/domain/value-objects/pan.value-object.js';
import { BankAccount } from '../../src/modules/vendor/domain/value-objects/bank-account.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

/**
 * Repository-level integration test against real PostgreSQL, following
 * `prisma-vendor.repository.test.ts`. Written at this level because no KYC use
 * case or route exists yet (KYC-4/KYC-5) — this is the smallest way to prove
 * the mapping round-trips and, more importantly, that the *database* enforces
 * the invariants rather than the application merely intending them.
 *
 * There are deliberately no RLS tests here. The application's database role is
 * SUPERUSER with BYPASSRLS, so any isolation assertion written today would
 * pass without proving anything. That work is KYC-2B.
 */
describe('PrismaVendorKycRepository', () => {
  const prisma = new PrismaClient();
  const repository = new PrismaVendorKycRepository(prisma);
  const ids = new UuidV7Generator();
  const fingerprinter = new HmacIdentifierFingerprinter('ab'.repeat(32));

  const NOW = new Date('2026-01-01T00:00:00.000Z');
  const LATER = new Date('2026-01-02T00:00:00.000Z');

  const userId = toUserId(ids.generate());
  const otherUserId = toUserId(ids.generate());
  const reviewerId = toUserId(ids.generate());
  const deciderId = toUserId(ids.generate());
  const vendorId = toVendorId(ids.generate());
  const otherVendorId = toVendorId(ids.generate());

  const identifiersFor = (pan: string, account: string): KycIdentifiers => {
    const panValue = Pan.create(pan);
    const bank = BankAccount.create({ accountNumber: account, ifsc: 'HDFC0001234' });
    return {
      panFingerprint: fingerprinter.fingerprint('PAN', panValue.canonical),
      panLast4: panValue.last4,
      gstin: '27ABCDE1234F1Z0',
      bankFingerprint: fingerprinter.fingerprint('BANK_ACCOUNT', bank.canonical),
      bankAccountLast4: bank.last4,
      ifsc: bank.ifsc,
    };
  };

  const identifiers = identifiersFor('ABCDE1234F', '123456789012');

  const documentsFor = (kycId: string): KycDocument[] =>
    KycDocumentType.REQUIRED.map((type) =>
      KycDocument.awaitUpload({
        id: toKycDocumentId(ids.generate()),
        type,
        objectKey: `vendor/${vendorId}/${kycId}/${type.name}.enc`,
        wrappedDataKey: Buffer.from(`wrapped-key-for-${type.name}`),
        contentType: 'application/pdf',
        sizeBytes: 2048,
        now: NOW,
      }).markUploaded(NOW),
    );

  /**
   * `create` opens a sanctioned tenant transaction (KYC-2B-2), which refuses to
   * run without a vendor context — so a caller has to supply one. That is the
   * boundary working, not a test workaround: a submission is always written on
   * behalf of the vendor it belongs to.
   */
  const create = (kyc: VendorKyc): Promise<void> =>
    runWithTenant(
      { userId: kyc.vendorId === vendorId ? userId : otherUserId, vendorId: kyc.vendorId },
      () => repository.create(kyc),
    );

  const newSubmission = (owner = vendorId, ident = identifiers): VendorKyc => {
    const kycId = toKycId(ids.generate());
    return VendorKyc.submit({
      id: kycId,
      vendorId: owner,
      identifiers: ident,
      documents: documentsFor(kycId),
      now: NOW,
    });
  };

  beforeAll(async () => {
    const stamp = Date.now();
    await prisma.user.createMany({
      data: [userId, otherUserId, reviewerId, deciderId].map((id, index) => ({
        id,
        email: `kyc-repo-${stamp}-${index}@example.com`,
        passwordHash: 'hashed:not-a-real-password-hash-value',
      })),
    });
    const vendorRepositoryRows = [
      VendorProfile.register({ id: vendorId, userId, now: NOW }),
      VendorProfile.register({ id: otherVendorId, userId: otherUserId, now: NOW }),
    ];
    await prisma.vendorProfile.createMany({
      data: vendorRepositoryRows.map((vendor) => ({
        id: vendor.id,
        userId: vendor.userId,
        status: vendor.status.name,
        createdAt: vendor.createdAt,
        updatedAt: vendor.updatedAt,
      })),
    });
  });

  afterAll(async () => {
    // `kyc_documents` cascades from the submission, and submissions cascade
    // from the vendor — but the reviewer/decider foreign keys are RESTRICT, so
    // submissions must go before users.
    await prisma.vendorKycSubmission.deleteMany({
      where: { vendorId: { in: [vendorId, otherVendorId] } },
    });
    await prisma.vendorProfile.deleteMany({ where: { id: { in: [vendorId, otherVendorId] } } });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, otherUserId, reviewerId, deciderId] } },
    });
    await prisma.$disconnect();
  });

  const clearSubmissions = async (): Promise<void> => {
    await prisma.vendorKycSubmission.deleteMany({
      where: { vendorId: { in: [vendorId, otherVendorId] } },
    });
  };

  describe('round trip', () => {
    it('persists a submission and reads back every identifier field', async () => {
      await clearSubmissions();
      const kyc = newSubmission();

      await create(kyc);
      const found = await repository.findById(kyc.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(kyc.id);
      expect(found?.vendorId).toBe(vendorId);
      expect(found?.identifiers).toEqual(identifiers);
      expect(found?.submittedAt).toEqual(NOW);
    });

    it('persists document metadata, wrapped key included, byte for byte', async () => {
      await clearSubmissions();
      const kyc = newSubmission();

      await create(kyc);
      const found = await repository.findById(kyc.id);

      expect(found?.documents).toHaveLength(3);
      const pan = found?.documents.find((document) => document.type.equals(KycDocumentType.PAN));
      expect(pan?.objectKey).toBe(`vendor/${vendorId}/${kyc.id}/PAN.enc`);
      expect(pan?.contentType).toBe('application/pdf');
      expect(pan?.sizeBytes).toBe(2048);
      expect(pan?.isUploaded()).toBe(true);
      expect(pan?.uploadedAt).toEqual(NOW);
      expect(pan?.wrappedDataKey.equals(Buffer.from('wrapped-key-for-PAN'))).toBe(true);
    });

    it('stores no review at all before one is claimed', async () => {
      await clearSubmissions();
      const kyc = newSubmission();

      await create(kyc);

      expect((await repository.findById(kyc.id))?.review).toBeNull();
    });

    it('round-trips a claimed but undecided review with null decision fields', async () => {
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      await repository.saveReview(kyc.startReview(reviewerId, LATER));
      const found = await repository.findById(kyc.id);

      expect(found?.review?.reviewedBy).toBe(reviewerId);
      expect(found?.review?.startedAt).toEqual(LATER);
      expect(found?.review?.decidedBy).toBeNull();
      expect(found?.review?.decidedAt).toBeNull();
      expect(found?.isDecided()).toBe(false);
    });

    it('preserves reviewer and decision-maker as different people', async () => {
      // The distinction KYC-1 went out of its way to make would be worth
      // nothing if persistence collapsed it back into one column.
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      await repository.saveReview(kyc.startReview(reviewerId, NOW).approve(deciderId, LATER));
      const found = await repository.findById(kyc.id);

      expect(found?.review?.reviewedBy).toBe(reviewerId);
      expect(found?.review?.decidedBy).toBe(deciderId);
      expect(found?.review?.decidedAt).toEqual(LATER);
      expect(found?.isApproved()).toBe(true);
    });

    it('round-trips a rejection with its reason and note', async () => {
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      await repository.saveReview(
        kyc
          .startReview(reviewerId, NOW)
          .reject(deciderId, KycRejectionReason.DETAILS_MISMATCH, 'Name on PAN differs.', LATER),
      );
      const found = await repository.findById(kyc.id);

      expect(found?.review?.rejectionReason?.name).toBe('DETAILS_MISMATCH');
      expect(found?.review?.rejectionNote).toBe('Name on PAN differs.');
      expect(found?.isRejected()).toBe(true);
    });

    it('preserves the fingerprints exactly, and stores no plaintext identifier', async () => {
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      const row = await prisma.vendorKycSubmission.findUniqueOrThrow({ where: { id: kyc.id } });

      expect(row.panFingerprint).toBe(identifiers.panFingerprint);
      expect(row.bankFingerprint).toBe(identifiers.bankFingerprint);
      // No column holds either value in the clear, which is the actual claim.
      expect(Object.keys(row)).not.toContain('pan');
      expect(Object.keys(row)).not.toContain('accountNumber');
      expect(JSON.stringify(row)).not.toContain('123456789012');
      expect(row.panLast4).toBe('234F');
      expect(row.bankAccountLast4).toBe('9012');
    });

    it('discloses the PAN through the GSTIN column, and only through it', async () => {
      // The row *does* contain the ten characters of the PAN — because
      // characters 3–12 of a GSTIN are the holder's PAN, and BR-13 requires
      // the GSTIN stored whole. Asserted here so the trade-off KYC-1
      // documented stays a checked fact at the persistence layer too, rather
      // than a claim that quietly stops being true.
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      const row = await prisma.vendorKycSubmission.findUniqueOrThrow({ where: { id: kyc.id } });

      expect(row.gstin.slice(2, 12)).toBe('ABCDE1234F');
      const withoutGstin = { ...row, gstin: '' };
      expect(JSON.stringify(withoutGstin)).not.toContain('ABCDE1234F');
    });
  });

  describe('one undecided attempt per vendor', () => {
    it('accepts the first undecided submission', async () => {
      await clearSubmissions();

      await expect(create(newSubmission())).resolves.toBeUndefined();
    });

    it('refuses a second undecided submission at the database', async () => {
      // The application cannot enforce this: two callers can both read "no
      // undecided attempt" and both proceed. Only the index can decide.
      await clearSubmissions();
      await create(newSubmission());

      await expect(create(newSubmission())).rejects.toThrow(
        /uq_vendor_kyc_one_undecided|Unique constraint/i,
      );
    });

    it('refuses the second of two concurrent submissions', async () => {
      await clearSubmissions();

      const results = await Promise.allSettled([create(newSubmission()), create(newSubmission())]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    });

    it('allows a new attempt once the previous one is rejected', async () => {
      await clearSubmissions();
      const first = newSubmission();
      await create(first);
      await repository.saveReview(
        first
          .startReview(reviewerId, NOW)
          .reject(deciderId, KycRejectionReason.DOCUMENT_UNCLEAR, null, LATER),
      );

      await expect(create(newSubmission())).resolves.toBeUndefined();
    });

    it('allows many decided attempts to coexist with one undecided attempt', async () => {
      await clearSubmissions();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const rejected = newSubmission();
        await create(rejected);
        await repository.saveReview(
          rejected
            .startReview(reviewerId, NOW)
            .reject(deciderId, KycRejectionReason.DOCUMENT_UNCLEAR, null, LATER),
        );
      }
      const current = newSubmission();
      await create(current);

      const all = await repository.listByVendorId(vendorId);
      expect(all).toHaveLength(4);
      expect(all.filter((kyc) => !kyc.isDecided())).toHaveLength(1);
      expect((await repository.findCurrentByVendorId(vendorId))?.id).toBe(current.id);
    });

    it('keeps rejected history queryable with its decision intact', async () => {
      await clearSubmissions();
      const rejected = newSubmission();
      await create(rejected);
      await repository.saveReview(
        rejected
          .startReview(reviewerId, NOW)
          .reject(deciderId, KycRejectionReason.DUPLICATE_IDENTITY, null, LATER),
      );

      const history = await repository.listByVendorId(vendorId);

      expect(history).toHaveLength(1);
      expect(history[0]?.review?.rejectionReason?.name).toBe('DUPLICATE_IDENTITY');
      expect(history[0]?.review?.decidedBy).toBe(deciderId);
    });

    it('reports no current attempt when every attempt is decided', async () => {
      await clearSubmissions();
      const decided = newSubmission();
      await create(decided);
      await repository.saveReview(decided.startReview(reviewerId, NOW).approve(deciderId, LATER));

      expect(await repository.findCurrentByVendorId(vendorId)).toBeNull();
    });

    it('scopes the invariant per vendor, not globally', async () => {
      await clearSubmissions();
      await create(newSubmission());

      await expect(create(newSubmission(otherVendorId))).resolves.toBeUndefined();
    });
  });

  describe('vendor/document integrity', () => {
    it('refuses a document whose vendor disagrees with its submission', async () => {
      // The composite foreign key is what makes the denormalised column safe.
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      await expect(
        prisma.kycDocument.create({
          data: {
            id: ids.generate(),
            kycId: kyc.id,
            vendorId: otherVendorId,
            type: 'PAN',
            objectKey: 'vendor/forged.enc',
            wrappedDataKey: Buffer.from('wrapped'),
            contentType: 'application/pdf',
            sizeBytes: 1024,
            status: 'UPLOADED',
            uploadedAt: NOW,
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a second document of the same type on one submission', async () => {
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      await expect(
        prisma.kycDocument.create({
          data: {
            id: ids.generate(),
            kycId: kyc.id,
            vendorId,
            type: 'PAN',
            objectKey: 'vendor/duplicate.enc',
            wrappedDataKey: Buffer.from('wrapped'),
            contentType: 'application/pdf',
            sizeBytes: 1024,
            status: 'UPLOADED',
            uploadedAt: NOW,
          },
        }),
      ).rejects.toThrow();
    });

    it('removes documents with their submission', async () => {
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      await prisma.vendorKycSubmission.delete({ where: { id: kyc.id } });

      expect(await prisma.kycDocument.count({ where: { kycId: kyc.id } })).toBe(0);
    });
  });

  describe('database-enforced review shape', () => {
    it('refuses a decision with no decider named', async () => {
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      await expect(
        prisma.vendorKycSubmission.update({
          where: { id: kyc.id },
          data: { reviewedBy: reviewerId, startedAt: NOW, decidedAt: LATER },
        }),
      ).rejects.toThrow(/ck_vendor_kyc_decision_pair/);
    });

    it('refuses a decision on a submission nobody claimed', async () => {
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      await expect(
        prisma.vendorKycSubmission.update({
          where: { id: kyc.id },
          data: { decidedBy: deciderId, decidedAt: LATER },
        }),
      ).rejects.toThrow(/ck_vendor_kyc_decision_needs_review/);
    });

    it('refuses an OTHER rejection with no explanation', async () => {
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      await expect(
        prisma.vendorKycSubmission.update({
          where: { id: kyc.id },
          data: {
            reviewedBy: reviewerId,
            startedAt: NOW,
            decidedBy: deciderId,
            decidedAt: LATER,
            rejectionReason: 'OTHER',
          },
        }),
      ).rejects.toThrow(/ck_vendor_kyc_rejection_shape/);
    });

    it('refuses a document sized outside the KYC-0 upload limits', async () => {
      await clearSubmissions();
      const kyc = newSubmission();
      await create(kyc);

      await expect(
        prisma.kycDocument.updateMany({ where: { kycId: kyc.id }, data: { sizeBytes: 0 } }),
      ).rejects.toThrow(/ck_kyc_documents_size/);
    });
  });

  describe('SEC-17 fingerprint lookup', () => {
    it('finds another vendor sharing a PAN fingerprint', async () => {
      await clearSubmissions();
      const mine = newSubmission();
      await create(mine);
      // Same PAN, different bank — the ban-evasion shape SEC-17 describes.
      const theirs = newSubmission(otherVendorId, identifiersFor('ABCDE1234F', '999988887777'));
      await create(theirs);

      const matches = await repository.findByIdentifierFingerprints({
        vendorId,
        panFingerprint: identifiers.panFingerprint,
        bankFingerprint: identifiers.bankFingerprint,
      });

      expect(matches).toHaveLength(1);
      expect(matches[0]?.vendorId).toBe(otherVendorId);
    });

    it('never matches the vendor against their own earlier attempts', async () => {
      // A rejected vendor resubmitting necessarily reuses their own PAN;
      // matching on it would make every legitimate resubmission look like ban
      // evasion.
      await clearSubmissions();
      const first = newSubmission();
      await create(first);
      await repository.saveReview(
        first
          .startReview(reviewerId, NOW)
          .reject(deciderId, KycRejectionReason.DOCUMENT_UNCLEAR, null, LATER),
      );
      await create(newSubmission());

      const matches = await repository.findByIdentifierFingerprints({
        vendorId,
        panFingerprint: identifiers.panFingerprint,
        bankFingerprint: identifiers.bankFingerprint,
      });

      expect(matches).toHaveLength(0);
    });

    it('finds a match on the bank fingerprint alone', async () => {
      await clearSubmissions();
      await create(newSubmission());
      await create(newSubmission(otherVendorId, identifiersFor('ZZZZZ9999Z', '123456789012')));

      const matches = await repository.findByIdentifierFingerprints({
        vendorId,
        panFingerprint: identifiers.panFingerprint,
        bankFingerprint: identifiers.bankFingerprint,
      });

      expect(matches).toHaveLength(1);
    });

    it('returns nothing when no other vendor shares either identifier', async () => {
      await clearSubmissions();
      await create(newSubmission());
      await create(newSubmission(otherVendorId, identifiersFor('ZZZZZ9999Z', '999988887777')));

      const matches = await repository.findByIdentifierFingerprints({
        vendorId,
        panFingerprint: identifiers.panFingerprint,
        bankFingerprint: identifiers.bankFingerprint,
      });

      expect(matches).toHaveLength(0);
    });

    it('allows the same fingerprint on many rows — it is a signal, not a constraint', async () => {
      // Global uniqueness would make resubmission impossible: attempt two
      // carries the same PAN as attempt one, by definition.
      await clearSubmissions();
      const first = newSubmission();
      await create(first);
      await repository.saveReview(
        first
          .startReview(reviewerId, NOW)
          .reject(deciderId, KycRejectionReason.DOCUMENT_UNCLEAR, null, LATER),
      );

      await expect(create(newSubmission())).resolves.toBeUndefined();
    });
  });
  /**
   * The transaction-participation path (the KYC-4b prerequisite).
   *
   * What matters here is not that `create` still works, but that the scoped
   * instance writes on the **caller's** connection. A nested transaction would
   * acquire a different one — without `app.vendor_id` — and RLS would answer
   * with zero rows instead of an error, so a test that only checked "the rows
   * are there" would pass on a broken implementation too. Hence the rollback
   * and GUC assertions below.
   */
  describe('withTransaction (joins a caller transaction)', () => {
    const runScoped = async (
      kyc: VendorKyc,
      andThen?: (tx: unknown) => Promise<void>,
    ): Promise<void> => {
      await runWithTenant({ userId, vendorId }, async () => {
        await runInTenantTransaction(prisma, async (tx) => {
          await repository.withTransaction(tx as unknown as TransactionScope).create(kyc);
          await andThen?.(tx);
        });
      });
    };

    it('persists the submission and its documents through the caller transaction', async () => {
      await clearSubmissions();
      const kyc = newSubmission();

      await runScoped(kyc);

      const row = await prisma.vendorKycSubmission.findUniqueOrThrow({
        where: { id: kyc.id },
        include: { documents: true },
      });
      expect(row.vendorId).toBe(vendorId);
      expect(row.documents).toHaveLength(KycDocumentType.REQUIRED.length);
    });

    it('rolls back the submission *and* its documents when the caller transaction fails', async () => {
      // The atomicity guarantee KYC-2A made must survive moving the boundary
      // out to the caller.
      await clearSubmissions();
      const kyc = newSubmission();

      await expect(
        runScoped(kyc, () => {
          throw new Error('caller failed after the KYC write');
        }),
      ).rejects.toThrow('caller failed after the KYC write');

      expect(await prisma.vendorKycSubmission.findUnique({ where: { id: kyc.id } })).toBeNull();
      expect(await prisma.kycDocument.count({ where: { kycId: kyc.id } })).toBe(0);
    });

    it('runs on the caller connection, which still carries the tenant GUCs', async () => {
      // If `create` had opened a nested transaction it would have used another
      // connection; reading the setting back on the caller's `tx` after the
      // write is what shows it did not.
      await clearSubmissions();
      const kyc = newSubmission();
      let observed: string | null = null;

      await runScoped(kyc, async (tx) => {
        const client = tx as {
          $queryRawUnsafe: (sql: string) => Promise<{ vendor: string | null }[]>;
        };
        const rows = await client.$queryRawUnsafe(
          "SELECT nullif(current_setting('app.vendor_id', true), '') AS vendor",
        );
        observed = rows[0]?.vendor ?? null;
      });

      expect(observed).toBe(vendorId);
    });

    it('lets a caller write another repository in the same transaction, atomically', async () => {
      // The shape KYC-4b will use: submission here, VendorProfile transition
      // next door, both or neither.
      await clearSubmissions();
      const kyc = newSubmission();

      await expect(
        runScoped(kyc, async (tx) => {
          const client = tx as {
            vendorProfile: { update: (args: unknown) => Promise<unknown> };
          };
          await client.vendorProfile.update({
            where: { id: vendorId },
            data: { status: 'KYC_SUBMITTED' },
          });
          throw new Error('rolled back on purpose');
        }),
      ).rejects.toThrow('rolled back on purpose');

      expect(await prisma.vendorKycSubmission.findUnique({ where: { id: kyc.id } })).toBeNull();
      const vendor = await prisma.vendorProfile.findUniqueOrThrow({ where: { id: vendorId } });
      expect(vendor.status).toBe('REGISTERED');
    });

    it('leaves the standalone path opening its own transaction', async () => {
      // Unscoped `create` must keep working with no caller transaction at all.
      await clearSubmissions();
      const kyc = newSubmission();

      await expect(create(kyc)).resolves.toBeUndefined();
      expect(await prisma.kycDocument.count({ where: { kycId: kyc.id } })).toBe(
        KycDocumentType.REQUIRED.length,
      );
    });
  });
});
