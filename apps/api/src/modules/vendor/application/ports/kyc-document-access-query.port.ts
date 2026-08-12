import type { VendorId } from '../../../identity/index.js';
import type { KycDocumentId } from '../../domain/value-objects/kyc-document-id.value-object.js';
import type { KycDocumentStatusName } from '../../domain/entities/kyc-document.entity.js';
import type { KycId } from '../../domain/value-objects/kyc-id.value-object.js';

/**
 * The one row a document-access use case needs to address a document, check
 * whether it is actually there to serve, and (in a future chunk) unwrap its
 * data key — nothing else.
 *
 * A separate port from `KycReviewQueryPort` on purpose: that one's shape is
 * the read-only queue/detail contract's own, and `KycReviewDocument` is
 * deliberately missing `objectKey`, `wrappedDataKey` and the document `id` —
 * a comment there names exactly why. Adding those fields to a port with no
 * other reader keeps that omission real: nothing that already consumes
 * `KycReviewQueryPort` gains a path to this data merely by this port
 * existing beside it.
 */
export interface KycDocumentAccessRecord {
  readonly id: KycDocumentId;
  readonly kycId: KycId;
  readonly vendorId: VendorId;
  /** The document type name — part of the encryption context `unwrap` must reproduce. */
  readonly type: string;
  readonly objectKey: string;
  readonly wrappedDataKey: Buffer;
  /** `AWAITING_UPLOAD` names a row with no completed object at `objectKey` yet. */
  readonly status: KycDocumentStatusName;
  /** The original upload's declared type — carried onto the temporary delivery object so it downloads correctly. */
  readonly contentType: string;
}

/**
 * The administrator's read path to one document's location and wrapped key,
 * across every vendor.
 *
 * Cross-tenant and read-only for the same reason `KycReviewQueryPort` is: it
 * must run on `leenmart_admin`, never the tenant-scoped client, and it has no
 * write method — nothing here ever changes a document once uploaded (KYC-1).
 */
export interface KycDocumentAccessQueryPort {
  /**
   * The one row identified by `(kycId, documentId)`, or `null` if no document
   * with that id belongs to that submission — including the case where the
   * id exists but names a *different* submission entirely.
   */
  findForAccess(kycId: KycId, documentId: KycDocumentId): Promise<KycDocumentAccessRecord | null>;
}
