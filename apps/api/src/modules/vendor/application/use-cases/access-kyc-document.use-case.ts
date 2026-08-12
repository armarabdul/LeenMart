import { toUuid, type Logger } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import { VENDOR_AUDIT_ACTIONS, VENDOR_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import {
  InvalidKycOperationError,
  KycDocumentNotFoundError,
} from '../../domain/errors/kyc-errors.js';
import type { KycDocumentId } from '../../domain/value-objects/kyc-document-id.value-object.js';
import type { KycId } from '../../domain/value-objects/kyc-id.value-object.js';
import type { DataKeyCipher } from '../ports/data-key-cipher.port.js';
import type { DocumentCipher } from '../ports/document-cipher.port.js';
import type { ObjectStore } from '../ports/object-store.port.js';
import type { KycDocumentAccessQueryPort } from '../ports/kyc-document-access-query.port.js';

export interface AccessKycDocumentInput {
  readonly principal: Principal;
  readonly kycId: KycId;
  readonly documentId: KycDocumentId;
}

export interface AccessKycDocumentResult {
  readonly kycId: KycId;
  readonly documentId: KycDocumentId;
  readonly type: string;
  readonly url: string;
  readonly expiresAt: Date;
}

export interface AccessKycDocumentDeps {
  readonly documentAccessQuery: KycDocumentAccessQueryPort;
  readonly objectStore: ObjectStore;
  readonly dataKeyCipher: DataKeyCipher;
  readonly documentCipher: DocumentCipher;
  readonly auditWriter: AuditWriter;
  readonly logger: Logger;
}

/**
 * An administrator's access to one uploaded KYC document (SDD 12.1/12.3):
 * "Presigned GET ≤ 60 s, admin-role only, every access audited."
 *
 * The full flow this chunk defines: load the document by `(kycId,
 * documentId)` → require it `UPLOADED` → read the permanent ciphertext
 * (`ObjectStore.getObject`) → unwrap its data key
 * (`DataKeyCipher.unwrap()`, bound to the same `{vendorId, kycId,
 * documentType}` context KYC-4a wrapped it under) → decrypt the file
 * (`DocumentCipher.decrypt()`, the same context again) → write the
 * plaintext to a fresh, server-generated **temporary** object
 * (`ObjectStore.writeTemporaryObject`) → presign *that* object → audit →
 * return.
 *
 * **The permanent object is never written to.** Every write this use case
 * makes lands on the key `writeTemporaryObject` generates, never on
 * `document.objectKey` — there is no code path here that could touch the
 * permanent ciphertext at all beyond reading it.
 *
 * **Audited before the URL is returned, not after.** A rejection from
 * `auditWriter.record()` propagates, and the caller never sees a URL for an
 * access nobody can prove happened — the same fail-closed shape KYC-6 uses
 * for a written decision, applied here to a read. No transaction wraps this:
 * a read has no other database write to be atomic with.
 *
 * **Cleanup is best-effort and never hides the real failure.** Once
 * `writeTemporaryObject` has succeeded, every following step (presigning,
 * auditing) that fails triggers a `delete()` of that temporary object before
 * the original error is rethrown. If the delete itself fails, that failure
 * is logged — safely, carrying only the temporary object's own opaque key,
 * never plaintext or key material — and swallowed, so a cleanup problem
 * never replaces or buries the error the caller actually needs to see.
 */
export class AccessKycDocumentUseCase {
  constructor(private readonly deps: AccessKycDocumentDeps) {}

  async execute(input: AccessKycDocumentInput): Promise<AccessKycDocumentResult> {
    const { documentAccessQuery, objectStore, dataKeyCipher, documentCipher, auditWriter, logger } =
      this.deps;

    const document = await documentAccessQuery.findForAccess(input.kycId, input.documentId);
    if (!document) {
      throw new KycDocumentNotFoundError();
    }
    if (document.status !== 'UPLOADED') {
      throw new InvalidKycOperationError('document-access', 'the document has not been uploaded');
    }

    const ciphertext = await objectStore.getObject(document.objectKey);
    if (!ciphertext) {
      // The row says UPLOADED but the object itself is gone — a storage
      // inconsistency, not a caller mistake. Reported the same way a missing
      // row is: this caller has no way to distinguish the two, and no reason
      // to be able to.
      throw new KycDocumentNotFoundError();
    }

    const context = {
      vendorId: document.vendorId,
      kycId: document.kycId,
      documentType: document.type,
    };

    const dataKey = await dataKeyCipher.unwrap(document.wrappedDataKey, context);
    let plaintext: Buffer;
    try {
      plaintext = documentCipher.decrypt(ciphertext, dataKey, context);
    } finally {
      // Zeroed the moment decryption is done with it, whether or not it
      // succeeded — the same discipline `CreateKycUploadIntentUseCase` uses
      // for the same key, at the other end of its lifecycle.
      dataKeyCipher.shred(dataKey);
    }

    const temporary = await objectStore.writeTemporaryObject(plaintext, document.contentType);

    try {
      const presigned = await objectStore.presignGet(temporary.key);

      await auditWriter.record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: VENDOR_AUDIT_ACTIONS.KYC_DOCUMENT_ACCESSED,
        entityType: VENDOR_AUDIT_ENTITY_TYPES.KYC,
        entityId: toUuid(document.kycId),
        after: { vendorId: document.vendorId, documentId: document.id },
      });

      return {
        kycId: document.kycId,
        documentId: document.id,
        type: document.type,
        url: presigned.url,
        expiresAt: presigned.expiresAt,
      };
    } catch (error) {
      await deleteTemporaryObjectSafely(objectStore, temporary.key, logger);
      throw error;
    }
  }
}

/**
 * Best-effort cleanup of a temporary delivery object, for the failure path
 * only. Deliberately swallows its own failure: the caller already has a real
 * error to propagate, and a cleanup problem must never replace or hide it.
 */
const deleteTemporaryObjectSafely = async (
  objectStore: ObjectStore,
  key: string,
  logger: Logger,
): Promise<void> => {
  try {
    await objectStore.delete(key);
  } catch (cleanupError) {
    // `key` is the temporary object's own opaque, random identifier — never
    // a permanent object's key, and never plaintext, key material, or
    // document contents.
    logger.error(
      { key, cleanupError },
      'Failed to clean up a temporary KYC document delivery object after a failed access',
    );
  }
};
