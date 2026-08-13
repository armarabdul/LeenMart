import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import { NotFoundError, ValidationError } from '@leen-mart/domain-kit';
import type { Principal, VendorId } from '../../../identity/index.js';
import type { ObjectStore } from '../../../media/index.js';
import { KycDocumentType } from '../../domain/value-objects/kyc-document-type.value-object.js';
import { toKycId, type KycId } from '../../domain/value-objects/kyc-id.value-object.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';
import type { DataKeyCipher } from '../ports/data-key-cipher.port.js';

/** What the client declares about one document. Never a key, never an id. */
export interface RequestedKycDocument {
  readonly type: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface CreateKycUploadIntentInput {
  readonly principal: Principal;
  readonly documents: readonly RequestedKycDocument[];
}

export interface MintedKycUploadIntent {
  readonly type: string;
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** Base64. Plaintext AES-256 key for client-side encryption (SDD 12.3). */
  readonly dataKey: string;
  /** Base64. Wrapped by the CMK; returned so submission can rebuild the document. */
  readonly wrappedDataKey: string;
}

export interface CreateKycUploadIntentResult {
  readonly kycId: KycId;
  readonly expiresAt: Date;
  readonly documents: readonly MintedKycUploadIntent[];
}

export interface CreateKycUploadIntentDeps {
  readonly vendorRepository: VendorRepository;
  readonly objectStore: ObjectStore;
  readonly dataKeyCipher: DataKeyCipher;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * The permanent object-key convention, applied in exactly one place.
 *
 * Every component is server-controlled: `vendorId` comes from the
 * authenticated caller's own profile, `kycId` was generated moments ago, and
 * the type is one of three constants. Nothing a client sends reaches this
 * string, which is what makes it impossible to aim an upload at another
 * vendor's prefix.
 */
const objectKeyFor = (vendorId: VendorId, kycId: KycId, type: KycDocumentType): string =>
  `vendor/${vendorId}/${kycId}/${type.name}.enc`;

/**
 * Phase 1 of KYC submission: mint one upload capability per required document
 * (SDD 12.2's upload pipeline, SDD 12.3's client-side envelope encryption).
 *
 * **This use case persists nothing.** No submission row, no document row, no
 * staging table. The two phases are joined by what the client carries between
 * them — the submission id, the object keys and the wrapped keys — and by the
 * objects themselves, which Phase 2 verifies with `head()` before writing
 * anything. That is a deliberate consequence of `kyc_documents` requiring a
 * parent submission that cannot exist until the document set is complete and
 * uploaded, which `VendorKyc.submit()` enforces.
 *
 * One call mints the whole set so that all three intents share one `kycId`.
 * Per-document calls would each generate a different one, and three documents
 * under three submission ids are not a submission.
 *
 * Files never pass through here (SDD 12.2): the bytes go straight from the
 * browser to object storage under a URL that authorises exactly one content
 * type, one byte length, and five minutes.
 */
export class CreateKycUploadIntentUseCase {
  constructor(private readonly deps: CreateKycUploadIntentDeps) {}

  async execute(input: CreateKycUploadIntentInput): Promise<CreateKycUploadIntentResult> {
    const { vendorRepository, objectStore, dataKeyCipher, idGenerator, clock, logger } = this.deps;

    const vendor = await vendorRepository.findByUserId(input.principal.userId);
    if (!vendor) {
      // Holding SUBMIT_OR_EDIT_KYC without a profile is an inconsistent state
      // rather than a forbidden one; either way nothing is minted.
      throw new NotFoundError('This account has no vendor profile.', {
        code: 'VENDOR_PROFILE_NOT_FOUND',
      });
    }

    const now = clock.now();

    // The transition guard, and deliberately nothing more: the result is
    // discarded and never persisted. Minting a presigned PUT grants write
    // access to the private KYC bucket, and a vendor whose submission would be
    // refused should not be handed that capability. Asking `VendorProfile` is
    // reuse of the single source of truth for the lifecycle — restating the
    // legal source states here would be a second copy free to drift from
    // SDD 15.1's transition table.
    vendor.submitKyc(now);

    const requested = this.assertRequestedSetMatchesRequired(input.documents);

    const documents: MintedKycUploadIntent[] = [];
    const expiries: Date[] = [];
    const kycId = toKycId(idGenerator.generate());

    for (const type of KycDocumentType.REQUIRED) {
      const declared = requested.get(type.name);
      /* c8 ignore next */
      if (!declared) continue; // unreachable: the assertion above proved every required type is present
      const objectKey = objectKeyFor(vendor.id, kycId, type);

      // Bound to the object this key protects (SDD 12.3). A wrapped key lifted
      // from another document, another submission or another vendor fails to
      // unwrap rather than silently decrypting the wrong thing.
      const dataKey = await dataKeyCipher.generateDataKey({
        vendorId: vendor.id,
        kycId,
        documentType: type.name,
      });

      try {
        const upload = await objectStore.presignPut({
          key: objectKey,
          contentType: declared.contentType,
          contentLength: declared.sizeBytes,
        });

        documents.push({
          type: type.name,
          objectKey,
          uploadUrl: upload.url,
          contentType: upload.contentType,
          sizeBytes: upload.contentLength,
          dataKey: dataKey.plaintext.toString('base64'),
          wrappedDataKey: dataKey.wrapped.toString('base64'),
        });

        expiries.push(upload.expiresAt);
      } finally {
        // Zeroed whether or not presigning succeeded: a rejected content type
        // must not leave a live key sitting in process memory.
        dataKeyCipher.shred(dataKey.plaintext);
      }
    }

    // Ids and types only. A data key — plaintext or wrapped — must never reach
    // a log line, and neither must a vendor's identifiers.
    logger.info(
      { vendorId: vendor.id, kycId, documentTypes: documents.map((document) => document.type) },
      'KYC upload intents minted',
    );

    // The earliest of the three, not the latest: one deadline the client can
    // rely on for the whole set, and reporting the latest would promise time
    // on a URL that had already stopped working.
    const expiresAt = expiries.reduce(
      (earliest, candidate) => (candidate < earliest ? candidate : earliest),
      expiries[0] ?? now,
    );

    return { kycId, expiresAt, documents };
  }

  /**
   * Exactly the required set, once each.
   *
   * The wire schema already fixes the array at three entries; this is the
   * check that those three are the three that matter, and it reads
   * `KycDocumentType.REQUIRED` rather than a list of its own so that adding a
   * required document type cannot leave this behind.
   */
  private assertRequestedSetMatchesRequired(
    documents: readonly RequestedKycDocument[],
  ): Map<string, RequestedKycDocument> {
    const byType = new Map<string, RequestedKycDocument>();
    for (const document of documents) {
      // Rejects an unknown type name with the domain's own error.
      const type = KycDocumentType.fromName(document.type);
      if (byType.has(type.name)) {
        throw requestedSetError(`${type.name} was supplied more than once`);
      }
      byType.set(type.name, document);
    }

    for (const required of KycDocumentType.REQUIRED) {
      if (!byType.has(required.name)) {
        throw requestedSetError(`a ${required.name} document is required`);
      }
    }
    return byType;
  }
}

/**
 * A malformed *request*, not an incomplete submission — nothing has been
 * submitted yet. `IncompleteKycSubmissionError` is a 422 about an aggregate
 * that exists; this is a 400 about a body that does not describe one, which is
 * what `ValidationError` already means everywhere else here.
 */
const requestedSetError = (issue: string): ValidationError =>
  new ValidationError('The requested document set is not valid.', {
    code: 'INVALID_KYC_DOCUMENT_SET',
    details: [{ field: 'documents', issue }],
  });
