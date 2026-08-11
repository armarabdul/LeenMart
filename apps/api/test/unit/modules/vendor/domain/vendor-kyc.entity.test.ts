import { describe, expect, it } from 'vitest';
import { toUserId, toVendorId } from '../../../../../src/modules/identity/index.js';
import { KycDocument } from '../../../../../src/modules/vendor/domain/entities/kyc-document.entity.js';
import {
  VendorKyc,
  type KycIdentifiers,
} from '../../../../../src/modules/vendor/domain/entities/vendor-kyc.entity.js';
import { KycDocumentType } from '../../../../../src/modules/vendor/domain/value-objects/kyc-document-type.value-object.js';
import { KycRejectionReason } from '../../../../../src/modules/vendor/domain/value-objects/kyc-rejection-reason.value-object.js';
import { toKycDocumentId } from '../../../../../src/modules/vendor/domain/value-objects/kyc-document-id.value-object.js';
import { toKycId } from '../../../../../src/modules/vendor/domain/value-objects/kyc-id.value-object.js';
import type { SensitiveFingerprint } from '../../../../../src/modules/vendor/domain/value-objects/sensitive-fingerprint.value-object.js';

/**
 * Domain-rule messages are deliberately uniform; what tells a caller *which*
 * rule was broken is `details`, exactly as `InvalidVendorStatusTransitionError`
 * already works.
 */
const issueFor = (act: () => unknown): string => {
  try {
    act();
    return 'did not throw';
  } catch (error) {
    const failure = error as { details?: { field: string; issue: string }[] };
    return failure.details?.[0]?.issue ?? 'no detail';
  }
};

const NOW = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-01-02T00:00:00.000Z');

const kycId = toKycId('00000000-0000-7000-8000-00000000b001');
const vendorId = toVendorId('00000000-0000-7000-8000-00000000b002');
const reviewer = toUserId('00000000-0000-7000-8000-00000000b003');
/** A second administrator, for the cases where the decider is not the claimer. */
const decider = toUserId('00000000-0000-7000-8000-00000000b004');

const PAN_FINGERPRINT = 'fp-pan-aaaa' as SensitiveFingerprint;
const BANK_FINGERPRINT = 'fp-bank-bbbb' as SensitiveFingerprint;

const identifiers: KycIdentifiers = {
  panFingerprint: PAN_FINGERPRINT,
  panLast4: '234F',
  gstin: '27ABCDE1234F1Z0',
  bankFingerprint: BANK_FINGERPRINT,
  bankAccountLast4: '9012',
  ifsc: 'HDFC0001234',
};

let documentSeq = 0;
const uploadedDocument = (type: KycDocumentType): KycDocument => {
  documentSeq += 1;
  return KycDocument.awaitUpload({
    id: toKycDocumentId(
      `00000000-0000-7000-8000-0000000c${(1000 + documentSeq).toString().slice(-4)}`,
    ),
    type,
    objectKey: `vendor/${vendorId}/${type.name}.enc`,
    wrappedDataKey: Buffer.from('wrapped-key-material'),
    contentType: 'application/pdf',
    sizeBytes: 2048,
    now: NOW,
  }).markUploaded(NOW);
};

const completeDocuments = (): KycDocument[] =>
  KycDocumentType.REQUIRED.map((type) => uploadedDocument(type));

const submit = (documents = completeDocuments()): VendorKyc =>
  VendorKyc.submit({ id: kycId, vendorId, identifiers, documents, now: NOW });

describe('VendorKyc', () => {
  describe('submission', () => {
    it('records the vendor, identifiers and documents', () => {
      const kyc = submit();

      expect(kyc.vendorId).toBe(vendorId);
      expect(kyc.identifiers).toEqual(identifiers);
      expect(kyc.documents).toHaveLength(3);
      expect(kyc.submittedAt).toEqual(NOW);
    });

    it('starts with no review — nobody has claimed it yet', () => {
      const kyc = submit();

      expect(kyc.review).toBeNull();
      expect(kyc.isUnderReview()).toBe(false);
      expect(kyc.isDecided()).toBe(false);
    });

    it.each(KycDocumentType.REQUIRED.map((type) => type.name))(
      'refuses a submission missing the %s document',
      (missing) => {
        const documents = completeDocuments().filter((document) => document.type.name !== missing);

        expect(() => submit(documents)).toThrow(/incomplete/i);
      },
    );

    it('refuses the same document type supplied twice', () => {
      const documents = [...completeDocuments(), uploadedDocument(KycDocumentType.PAN)];

      expect(issueFor(() => submit(documents))).toMatch(/only once/);
    });

    it('refuses a submission whose documents have not finished uploading', () => {
      // A reserved object key is not a document; reviewing one would mean
      // opening an object that was never written.
      const pending = KycDocument.awaitUpload({
        id: toKycDocumentId('00000000-0000-7000-8000-00000000c999'),
        type: KycDocumentType.PAN,
        objectKey: 'vendor/pending.enc',
        wrappedDataKey: Buffer.from('wrapped'),
        contentType: 'application/pdf',
        sizeBytes: 1024,
        now: NOW,
      });
      const documents = [
        pending,
        uploadedDocument(KycDocumentType.BANK_ACCOUNT_PROOF),
        uploadedDocument(KycDocumentType.GSTIN),
      ];

      expect(issueFor(() => submit(documents))).toMatch(/finish uploading/);
    });
  });

  describe('review start', () => {
    it('records the reviewer and the time they claimed it (SDD 15.1)', () => {
      const claimed = submit().startReview(reviewer, LATER);

      expect(claimed.review?.reviewedBy).toBe(reviewer);
      expect(claimed.review?.startedAt).toEqual(LATER);
      expect(claimed.review?.decidedAt).toBeNull();
      expect(claimed.isUnderReview()).toBe(true);
    });

    it('records no decision-maker until a decision is actually made', () => {
      // `decidedBy` and `decidedAt` move together. A claimed-but-undecided
      // review naming someone as the decider would put a name in the audit
      // trail against a decision nobody has taken.
      const claimed = submit().startReview(reviewer, LATER);

      expect(claimed.review?.decidedBy).toBeNull();
      expect(claimed.review?.decidedAt).toBeNull();
      expect(claimed.isDecided()).toBe(false);
    });

    it('never mutates the submission it was called on', () => {
      const kyc = submit();

      kyc.startReview(reviewer, LATER);

      expect(kyc.review).toBeNull();
    });

    it('refuses a second claim while one reviewer already holds it', () => {
      const claimed = submit().startReview(reviewer, LATER);

      expect(issueFor(() => claimed.startReview(reviewer, LATER))).toMatch(/already under review/);
    });

    it('refuses a claim on a submission already decided', () => {
      const decided = submit().startReview(reviewer, LATER).approve(reviewer, LATER);

      expect(issueFor(() => decided.startReview(reviewer, LATER))).toMatch(/already been decided/);
    });
  });

  describe('approval', () => {
    it('records the decision time', () => {
      const approved = submit().startReview(reviewer, NOW).approve(reviewer, LATER);

      expect(approved.review?.decidedAt).toEqual(LATER);
      expect(approved.isApproved()).toBe(true);
      expect(approved.isRejected()).toBe(false);
      expect(approved.isUnderReview()).toBe(false);
    });

    it('keeps the reviewer who claimed it', () => {
      const approved = submit().startReview(reviewer, NOW).approve(reviewer, LATER);

      expect(approved.review?.reviewedBy).toBe(reviewer);
    });

    it('refuses an approval on a submission nobody claimed', () => {
      expect(issueFor(() => submit().approve(reviewer, LATER))).toMatch(/not been claimed/);
    });

    it('refuses to approve twice', () => {
      const approved = submit().startReview(reviewer, NOW).approve(reviewer, LATER);

      expect(issueFor(() => approved.approve(reviewer, LATER))).toMatch(/already been decided/);
    });

    it('refuses to reject a submission that was approved', () => {
      // A decision is final. Reversing one would rewrite history that SDD 18.4
      // requires to be auditable.
      const approved = submit().startReview(reviewer, NOW).approve(reviewer, LATER);

      expect(
        issueFor(() => approved.reject(reviewer, KycRejectionReason.DOCUMENT_UNCLEAR, null, LATER)),
      ).toMatch(/already been decided/);
    });
  });

  describe('rejection', () => {
    it('records the reason and the decision time', () => {
      const rejected = submit()
        .startReview(reviewer, NOW)
        .reject(reviewer, KycRejectionReason.DOCUMENT_UNCLEAR, null, LATER);

      expect(rejected.review?.rejectionReason?.name).toBe('DOCUMENT_UNCLEAR');
      expect(rejected.review?.decidedAt).toEqual(LATER);
      expect(rejected.isRejected()).toBe(true);
      expect(rejected.isApproved()).toBe(false);
    });

    it('accepts an optional explanation', () => {
      const rejected = submit()
        .startReview(reviewer, NOW)
        .reject(reviewer, KycRejectionReason.DETAILS_MISMATCH, '  Name on PAN differs.  ', LATER);

      expect(rejected.review?.rejectionNote).toBe('Name on PAN differs.');
    });

    it('treats a blank explanation as none at all', () => {
      const rejected = submit()
        .startReview(reviewer, NOW)
        .reject(reviewer, KycRejectionReason.DOCUMENT_UNCLEAR, '   ', LATER);

      expect(rejected.review?.rejectionNote).toBeNull();
    });

    it('requires an explanation when the reason is OTHER', () => {
      // OTHER says nothing a vendor can act on, and a rejection they cannot
      // act on is a vendor who resubmits the same thing.
      const claimed = submit().startReview(reviewer, NOW);

      expect(
        issueFor(() => claimed.reject(reviewer, KycRejectionReason.OTHER, null, LATER)),
      ).toMatch(/must carry an explanation/);
      expect(
        issueFor(() => claimed.reject(reviewer, KycRejectionReason.OTHER, '  ', LATER)),
      ).toMatch(/must carry an explanation/);
    });

    it('accepts OTHER when explained', () => {
      const rejected = submit()
        .startReview(reviewer, NOW)
        .reject(
          reviewer,
          KycRejectionReason.OTHER,
          'Business name does not match the shop.',
          LATER,
        );

      expect(rejected.review?.rejectionNote).toBe('Business name does not match the shop.');
    });

    it('refuses a rejection on a submission nobody claimed', () => {
      expect(
        issueFor(() => submit().reject(reviewer, KycRejectionReason.DOCUMENT_UNCLEAR, null, LATER)),
      ).toMatch(/not been claimed/);
    });

    it('refuses to approve a submission that was rejected', () => {
      const rejected = submit()
        .startReview(reviewer, NOW)
        .reject(reviewer, KycRejectionReason.DOCUMENT_UNCLEAR, null, LATER);

      expect(issueFor(() => rejected.approve(reviewer, LATER))).toMatch(/already been decided/);
    });

    it('is not edited into an approval — a resubmission is a new submission', () => {
      // SDD 15.1 sends a rejected vendor back through `(resubmit)`, which
      // keeps the rejected attempt intact rather than overwriting it.
      const rejected = submit()
        .startReview(reviewer, NOW)
        .reject(reviewer, KycRejectionReason.DOCUMENT_UNCLEAR, null, LATER);

      const resubmission = VendorKyc.submit({
        id: toKycId('00000000-0000-7000-8000-00000000b009'),
        vendorId,
        identifiers,
        documents: completeDocuments(),
        now: LATER,
      });

      expect(rejected.isRejected()).toBe(true);
      expect(resubmission.id).not.toBe(rejected.id);
      expect(resubmission.review).toBeNull();
    });
  });

  describe('decision identity (SDD 15.1)', () => {
    it('records who approved, not merely who claimed it', () => {
      const approved = submit().startReview(reviewer, NOW).approve(decider, LATER);

      expect(approved.review?.decidedBy).toBe(decider);
      expect(approved.review?.decidedAt).toEqual(LATER);
    });

    it('records who rejected, not merely who claimed it', () => {
      const rejected = submit()
        .startReview(reviewer, NOW)
        .reject(decider, KycRejectionReason.DOCUMENT_UNCLEAR, null, LATER);

      expect(rejected.review?.decidedBy).toBe(decider);
      expect(rejected.review?.decidedAt).toEqual(LATER);
    });

    it('allows the decider to differ from the reviewer, keeping both', () => {
      // Requiring them to match would strand a submission behind whoever
      // claimed it and then went on leave, and reassignment is a workflow the
      // SDD does not define. Recording both keeps the trail truthful without
      // inventing one.
      const approved = submit().startReview(reviewer, NOW).approve(decider, LATER);

      expect(approved.review?.reviewedBy).toBe(reviewer);
      expect(approved.review?.decidedBy).toBe(decider);
      expect(approved.review?.reviewedBy).not.toBe(approved.review?.decidedBy);
    });

    it('will not let a second decider overwrite the first', () => {
      // The immutability that matters: not only is the outcome final, so is
      // the name attached to it.
      const approved = submit().startReview(reviewer, NOW).approve(decider, LATER);

      expect(issueFor(() => approved.approve(reviewer, LATER))).toMatch(/already been decided/);
      expect(
        issueFor(() =>
          approved.reject(reviewer, KycRejectionReason.OTHER, 'changed my mind', LATER),
        ),
      ).toMatch(/already been decided/);
      expect(approved.review?.decidedBy).toBe(decider);
    });

    it('records no decider when a decision is refused for want of a review', () => {
      const unclaimed = submit();

      expect(issueFor(() => unclaimed.approve(decider, LATER))).toMatch(/not been claimed/);
      expect(unclaimed.review).toBeNull();
    });

    it('records no decider when a rejection is refused for want of an explanation', () => {
      const claimed = submit().startReview(reviewer, NOW);

      expect(
        issueFor(() => claimed.reject(decider, KycRejectionReason.OTHER, null, LATER)),
      ).toMatch(/must carry an explanation/);
      expect(claimed.review?.decidedBy).toBeNull();
      expect(claimed.review?.decidedAt).toBeNull();
    });
  });

  describe('reconstitution', () => {
    it('rehydrates a persisted decision without re-validating it', () => {
      const decided = submit().startReview(reviewer, NOW).approve(decider, LATER);

      const rehydrated = VendorKyc.reconstitute({
        id: decided.id,
        vendorId: decided.vendorId,
        identifiers: decided.identifiers,
        documents: decided.documents,
        review: decided.review,
        submittedAt: decided.submittedAt,
        createdAt: decided.createdAt,
        updatedAt: decided.updatedAt,
      });

      expect(rehydrated.isApproved()).toBe(true);
      expect(rehydrated.review?.reviewedBy).toBe(reviewer);
      expect(rehydrated.review?.decidedBy).toBe(decider);
    });
  });

  describe('security', () => {
    it('carries no standalone plaintext PAN field and no account number', () => {
      const serialised = JSON.stringify(submit());
      const { identifiers: rendered } = JSON.parse(serialised) as {
        identifiers: Record<string, unknown>;
      };

      expect(Object.keys(rendered)).not.toContain('pan');
      expect(Object.keys(rendered)).not.toContain('accountNumber');
      expect(serialised).not.toContain('123456789012');
    });

    it('discloses the PAN only through the GSTIN, which contains it by construction', () => {
      // Worth stating plainly rather than leaving as a surprise: characters
      // 3–12 of every GSTIN *are* the holder's PAN. BR-13 requires the GSTIN
      // stored in full — it is filed in GSTR-8 and printed on tax invoices —
      // so for a GST-registered vendor the PAN is disclosed to anyone who can
      // read the row. Fingerprinting the PAN still protects vendors with no
      // GSTIN and still keeps it out of logs and errors, but it is not
      // confidentiality against a database compromise here.
      const serialised = JSON.stringify(submit());

      expect(serialised).toContain('27ABCDE1234F1Z0');
      expect('27ABCDE1234F1Z0'.slice(2, 12)).toBe('ABCDE1234F');
    });

    it('redacts the fingerprints, which are the SEC-17 correlation keys', () => {
      const serialised = JSON.stringify(submit());

      expect(serialised).not.toContain(PAN_FINGERPRINT);
      expect(serialised).not.toContain(BANK_FINGERPRINT);
      expect(serialised).toContain('[REDACTED]');
    });

    it('redacts every wrapped data key carried by its documents', () => {
      const serialised = JSON.stringify(submit());

      expect(serialised).not.toContain('wrapped-key-material');
    });

    it('still shows the masked identifiers SDD 12.3 displays by default', () => {
      const serialised = JSON.stringify(submit());

      expect(serialised).toContain('234F');
      expect(serialised).toContain('9012');
      expect(serialised).toContain('27ABCDE1234F1Z0');
    });

    it('leaks nothing through a rejection error', () => {
      try {
        submit().reject(reviewer, KycRejectionReason.OTHER, null, LATER);
        expect.unreachable('an unclaimed rejection should not succeed');
      } catch (error) {
        const serialised = JSON.stringify(error as Error);
        expect(serialised).not.toContain(PAN_FINGERPRINT);
        expect(serialised).not.toContain('wrapped-key-material');
      }
    });
  });
});
