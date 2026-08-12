import type { Clock, IdGenerator, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import { NotFoundError, toUuid, ValidationError } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal, VendorId } from '../../../identity/index.js';
import { VENDOR_AUDIT_ACTIONS, VENDOR_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import { KycDocument } from '../../domain/entities/kyc-document.entity.js';
import { VendorKyc, type KycIdentifiers } from '../../domain/entities/vendor-kyc.entity.js';
import type { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import type { IdentifierFingerprinter } from '../../domain/services/identifier-fingerprinter.service.js';
import type { VendorKycRepository } from '../../domain/repositories/vendor-kyc.repository.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';
import { BankAccount } from '../../domain/value-objects/bank-account.value-object.js';
import { Gstin } from '../../domain/value-objects/gstin.value-object.js';
import { KycDocumentType } from '../../domain/value-objects/kyc-document-type.value-object.js';
import { toKycDocumentId } from '../../domain/value-objects/kyc-document-id.value-object.js';
import { toKycId, type KycId } from '../../domain/value-objects/kyc-id.value-object.js';
import { Pan } from '../../domain/value-objects/pan.value-object.js';
import type { ObjectStore } from '../ports/object-store.port.js';

/** One uploaded document as the client reports it. Never an object key — the server derives that. */
export interface SubmittedKycDocument {
  readonly type: string;
  /** Base64, exactly as the upload-intent response returned it. */
  readonly wrappedDataKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface SubmitVendorKycInput {
  readonly principal: Principal;
  readonly kycId: string;
  readonly pan: string;
  readonly gstin: string;
  readonly bankAccount: { readonly accountNumber: string; readonly ifsc: string };
  readonly documents: readonly SubmittedKycDocument[];
}

export interface SubmitVendorKycResult {
  readonly kyc: VendorKyc;
  readonly vendor: VendorProfile;
}

export interface SubmitVendorKycDeps {
  readonly vendorRepository: VendorRepository;
  readonly vendorKycRepository: VendorKycRepository;
  readonly objectStore: ObjectStore;
  readonly fingerprinter: IdentifierFingerprinter;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * The same derivation the upload intent used, applied again rather than
 * trusted from the request.
 *
 * This is the security property of the whole endpoint. The vendor comes from
 * the authenticated tenant, the type from a three-value enum, and the
 * submission id from a field that cannot reach outside the caller's own
 * prefix — so a client has no way to point this at an object it does not own,
 * whatever it sends.
 */
const objectKeyFor = (vendorId: VendorId, kycId: KycId, type: KycDocumentType): string =>
  `vendor/${vendorId}/${kycId}/${type.name}.enc`;

const documentSetError = (issue: string): ValidationError =>
  new ValidationError('The submitted document set is not valid.', {
    code: 'INVALID_KYC_DOCUMENT_SET',
    details: [{ field: 'documents', issue }],
  });

/**
 * Phase 2 of KYC submission (SDD 15.1's `SUBMIT_KYC`).
 *
 * Reads the vendor from the authenticated principal, canonicalises and
 * fingerprints the identifiers, confirms every required object is actually in
 * the private bucket, and writes the submission and the vendor's lifecycle
 * transition **in one transaction**.
 *
 * Three things it deliberately does not do:
 *
 *  * **Move bytes.** `head()` is metadata only (SDD 12.2) — the ciphertext is
 *    never read here, and could not be understood if it were: the data key
 *    that decrypts it left with the client and only its wrapped form comes
 *    back.
 *  * **Look for duplicates.** The SEC-17 cross-vendor fingerprint lookup on
 *    `VendorKycRepository` searches across tenants and is refused by RLS on
 *    the vendor-scoped client by design. It belongs to review (KYC-5), behind
 *    its own authorisation and the admin credential. Deliberately not named
 *    here: a convention test scans production sources for that identifier and
 *    treats any mention as a caller, which is the strictness that keeps it
 *    unwired.
 *  * **Clean up on failure.** If persistence fails the uploaded objects stay
 *    where they are, because a retry may legitimately reuse them.
 */
export class SubmitVendorKycUseCase {
  constructor(private readonly deps: SubmitVendorKycDeps) {}

  async execute(input: SubmitVendorKycInput): Promise<SubmitVendorKycResult> {
    const { vendorRepository, transactionRunner, auditWriter, clock, logger } = this.deps;

    const vendor = await vendorRepository.findByUserId(input.principal.userId);
    if (!vendor) {
      throw new NotFoundError('This account has no vendor profile.', {
        code: 'VENDOR_PROFILE_NOT_FOUND',
      });
    }

    const now = clock.now();
    const kycId = toKycId(input.kycId);

    // Canonicalised by the value objects, which are also what validate them:
    // a malformed PAN, GSTIN checksum or IFSC throws `InvalidKycIdentifierError`
    // (400) from here, before anything is read or written.
    const identifiers = this.fingerprintIdentifiers(input);

    // Every object confirmed present, and matching what the client claims
    // about it, *before* the transaction opens — a submission whose evidence
    // is missing should never reach the database, and a `head()` inside the
    // transaction would hold a connection open across network calls.
    const documents = await this.verifyDocuments(vendor.id, kycId, input.documents, now);

    // `submit()` owns the completeness rules (all required types, no
    // duplicates, all uploaded); `submitKyc()` owns the lifecycle. Both are
    // called before the transaction so a rejection costs no database work.
    const kyc = VendorKyc.submit({
      id: kycId,
      vendorId: vendor.id,
      identifiers,
      documents,
      now,
    });
    const submitted = vendor.submitKyc(now);

    // One transaction over two repositories and the audit write. All three
    // land or none does: a submission without the transition strands the
    // vendor behind a unique index they cannot see, a transition without the
    // submission strands them in `KYC_SUBMITTED` with nothing to review and
    // no way back, and SDD 18.4 makes the audit entry as binding as either.
    await transactionRunner.run(async (scope) => {
      await this.deps.vendorKycRepository.withTransaction(scope).create(kyc);
      await vendorRepository.withTransaction(scope).update(submitted);
      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: VENDOR_AUDIT_ACTIONS.KYC_SUBMITTED,
        entityType: VENDOR_AUDIT_ENTITY_TYPES.KYC,
        entityId: toUuid(kyc.id),
        after: { vendorId: kyc.vendorId },
      });
    });

    // Ids and counts only — never an identifier, a fingerprint or key material.
    logger.info(
      {
        vendorId: vendor.id,
        kycId,
        documentCount: documents.length,
        vendorStatus: submitted.status.name,
      },
      'Vendor KYC submitted',
    );

    return { kyc, vendor: submitted };
  }

  /**
   * Full identifiers in, one-way fingerprints and masked tails out.
   *
   * The `Pan` and `BankAccount` instances are the only place the full values
   * exist in this process, and they never leave this method — `KycIdentifiers`
   * is what the aggregate and the database see (SDD 12.3). GSTIN is the stated
   * exception, stored whole for BR-13.
   */
  private fingerprintIdentifiers(input: SubmitVendorKycInput): KycIdentifiers {
    const { fingerprinter } = this.deps;

    const pan = Pan.create(input.pan);
    const gstin = Gstin.create(input.gstin);
    const bankAccount = BankAccount.create({
      accountNumber: input.bankAccount.accountNumber,
      ifsc: input.bankAccount.ifsc,
    });

    return {
      panFingerprint: fingerprinter.fingerprint('PAN', pan.canonical),
      panLast4: pan.last4,
      gstin: gstin.value,
      bankFingerprint: fingerprinter.fingerprint('BANK_ACCOUNT', bankAccount.canonical),
      bankAccountLast4: bankAccount.last4,
      ifsc: bankAccount.ifsc,
    };
  }

  /**
   * Confirms each required object exists and matches its declared metadata,
   * then rebuilds the document through the lifecycle KYC-1 defines.
   *
   * The size and content-type comparison is not belt-and-braces. The presigned
   * URL bound both, so a mismatch means the object in the bucket is not the one
   * this submission describes — a different upload under the same key, or a
   * request describing an object it did not create. Either way the metadata a
   * reviewer would be shown would be wrong about the evidence.
   */
  private async verifyDocuments(
    vendorId: VendorId,
    kycId: KycId,
    submitted: readonly SubmittedKycDocument[],
    now: Date,
  ): Promise<KycDocument[]> {
    const { objectStore, idGenerator } = this.deps;

    const byType = new Map<string, SubmittedKycDocument>();
    for (const document of submitted) {
      const type = KycDocumentType.fromName(document.type);
      if (byType.has(type.name)) {
        throw documentSetError(`${type.name} was supplied more than once`);
      }
      byType.set(type.name, document);
    }

    const documents: KycDocument[] = [];
    for (const type of KycDocumentType.REQUIRED) {
      const declared = byType.get(type.name);
      if (!declared) {
        throw documentSetError(`a ${type.name} document is required`);
      }

      const objectKey = objectKeyFor(vendorId, kycId, type);
      const stored = await objectStore.head(objectKey);
      if (!stored) {
        throw documentSetError(`the ${type.name} document has not been uploaded`);
      }
      if (stored.sizeBytes !== declared.sizeBytes) {
        throw documentSetError(`the uploaded ${type.name} document is a different size`);
      }
      if (stored.contentType !== declared.contentType) {
        throw documentSetError(`the uploaded ${type.name} document is a different type`);
      }

      const wrappedDataKey = Buffer.from(declared.wrappedDataKey, 'base64');
      documents.push(
        // `awaitUpload` validates the shape (non-empty key, non-empty wrapped
        // key, positive size); `markUploaded` is truthful only because
        // `head()` above just confirmed the object is really there.
        KycDocument.awaitUpload({
          id: toKycDocumentId(idGenerator.generate()),
          type,
          objectKey,
          wrappedDataKey,
          // The store's own answer, not the client's claim — they were just
          // proved equal, and preferring the store keeps the row describing
          // the object rather than the request.
          contentType: stored.contentType,
          sizeBytes: stored.sizeBytes,
          now,
        }).markUploaded(now),
      );
    }

    return documents;
  }
}
