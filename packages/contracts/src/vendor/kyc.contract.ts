import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/primitives.js';
import { vendorStatusSchema } from './vendor.contract.js';

/** Mirrors the domain `KycDocumentType` value object and the Prisma enum exactly. */
export const kycDocumentTypeSchema = z.enum(['PAN', 'GSTIN', 'BANK_ACCOUNT_PROOF']);

/**
 * The upload constraints SDD 12.2 requires ("declared type in allowlist, size
 * ≤ cap"), restated at the wire boundary.
 *
 * Restated, not owned: `S3ObjectStore` bakes both into the presigned
 * signature, so the store rejects a violating upload whatever this schema
 * says. Declaring them here only turns a refusal the client would otherwise
 * meet at the storage layer, after minting a useless URL, into a 400 with a
 * field name on it.
 */
export const KYC_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const kycDocumentContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'application/pdf']);

/**
 * What the client declares about one document it is about to upload.
 *
 * `contentType` and `sizeBytes` are required because they are bound into the
 * presigned URL's signature — the URL authorises exactly one type and one
 * byte length, so they must be known before it can be minted.
 *
 * Note what a client may **not** send: no `objectKey`, no `kycId`, no
 * `wrappedDataKey`. All three are server-generated, and `.strict()` is what
 * makes that a rejection rather than a silently ignored field — a client that
 * could name the object key could name someone else's.
 */
export const kycUploadIntentDocumentSchema = z
  .object({
    type: kycDocumentTypeSchema,
    contentType: kycDocumentContentTypeSchema,
    sizeBytes: z.number().int().positive().max(KYC_DOCUMENT_MAX_BYTES),
  })
  .strict();

/**
 * One request mints the whole document set (SDD 15.1's required documents).
 *
 * Deliberately not one call per document: the object key embeds the
 * submission id, the client may not choose it, and nothing is persisted
 * between the two phases — so per-document calls would each mint a *different*
 * submission id and scatter one submission across three prefixes that could
 * never be reassembled. Exactly three, one per required type, is enforced
 * here and again in the use case against `KycDocumentType.REQUIRED`.
 */
export const createKycUploadIntentRequestSchema = z
  .object({
    documents: z.array(kycUploadIntentDocumentSchema).length(3),
  })
  .strict();

/**
 * One document's upload capability.
 *
 * Two pieces of key material travel here, and both are deliberate:
 *
 *  * `dataKey` is the **plaintext** AES-256 key, base64-encoded. SDD 12.3 puts
 *    encryption client-side, so the browser needs it to encrypt the file
 *    before upload. It is never persisted and never logged, and the server
 *    zeroes its copy as soon as this response is built.
 *  * `wrappedDataKey` is the same key wrapped by the KMS CMK. It comes back in
 *    the submission request so the server can rebuild the document without a
 *    staging table. It is bound to `{vendorId, kycId, documentType}`, so one
 *    lifted from another document or another vendor simply fails to unwrap.
 */
export const kycUploadIntentSchema = z
  .object({
    type: kycDocumentTypeSchema,
    /** Server-derived: `vendor/{vendorId}/{kycId}/{TYPE}.enc`. Echoed so the client can send it back at submission. */
    objectKey: z.string().min(1),
    uploadUrl: z.string().url(),
    contentType: kycDocumentContentTypeSchema,
    sizeBytes: z.number().int().positive(),
    dataKey: z.string().min(1),
    wrappedDataKey: z.string().min(1),
  })
  .strict();

export const createKycUploadIntentResponseSchema = z
  .object({
    /** Generated server-side, shared by every intent in this response. */
    kycId: uuidSchema,
    /** When every URL above stops working (SDD 12.2's 5-minute PUT window). */
    expiresAt: isoDateTimeSchema,
    documents: z.array(kycUploadIntentSchema),
  })
  .strict();

/**
 * One uploaded document, as the client reports it back at submission.
 *
 * `objectKey` is **absent on purpose**, even though the upload-intent response
 * carried one. The server derives it again from the authenticated vendor, the
 * `kycId` below and the type — so a client cannot name a key at all, let alone
 * one belonging to another vendor. Accepting it would mean trusting the one
 * field that decides *which object* becomes this vendor's evidence.
 *
 * `wrappedDataKey` does travel back, because nothing persisted it between the
 * two phases (there is no staging table by design). It is useless without the
 * CMK, and it is bound to `{vendorId, kycId, documentType}` — a key from
 * another document or vendor fails to unwrap when review comes to read it.
 */
export const kycSubmissionDocumentSchema = z
  .object({
    type: kycDocumentTypeSchema,
    wrappedDataKey: z.string().min(1),
    contentType: kycDocumentContentTypeSchema,
    sizeBytes: z.number().int().positive().max(KYC_DOCUMENT_MAX_BYTES),
  })
  .strict();

/**
 * A vendor's KYC submission (SDD 15.1).
 *
 * Identifiers arrive in full and leave immediately: PAN and the account number
 * are reduced to a fingerprint plus last four before anything is persisted
 * (SDD 12.3), while GSTIN is stored whole because BR-13 requires it whole.
 * None of the three is ever logged.
 *
 * `vendorId` is **not** a field here and never will be — it comes from the
 * authenticated tenant context. A submission that let the client name its
 * vendor would be a cross-tenant write waiting to happen.
 */
export const submitVendorKycRequestSchema = z
  .object({
    /** The submission id minted by the upload-intent call; the objects live under it. */
    kycId: uuidSchema,
    pan: z.string().min(1).max(10),
    gstin: z.string().min(1).max(15),
    bankAccount: z
      .object({
        accountNumber: z.string().min(1).max(34),
        ifsc: z.string().min(1).max(11),
      })
      .strict(),
    documents: z.array(kycSubmissionDocumentSchema).length(3),
  })
  .strict();

/**
 * What comes back is deliberately thin: an id, the vendor's new lifecycle
 * state, and when it was submitted. No identifiers, no fingerprints, no
 * object keys and no key material — a submission response that echoed a PAN
 * back would put it in every client log and error report that captured it.
 */
export const submitVendorKycResponseSchema = z
  .object({
    kycId: uuidSchema,
    vendorStatus: vendorStatusSchema,
    submittedAt: isoDateTimeSchema,
  })
  .strict();

export type KycDocumentTypeDto = z.infer<typeof kycDocumentTypeSchema>;
export type KycUploadIntentDocument = z.infer<typeof kycUploadIntentDocumentSchema>;
export type CreateKycUploadIntentRequest = z.infer<typeof createKycUploadIntentRequestSchema>;
export type KycUploadIntent = z.infer<typeof kycUploadIntentSchema>;
export type CreateKycUploadIntentResponse = z.infer<typeof createKycUploadIntentResponseSchema>;
export type KycSubmissionDocument = z.infer<typeof kycSubmissionDocumentSchema>;
export type SubmitVendorKycRequest = z.infer<typeof submitVendorKycRequestSchema>;
export type SubmitVendorKycResponse = z.infer<typeof submitVendorKycResponseSchema>;
