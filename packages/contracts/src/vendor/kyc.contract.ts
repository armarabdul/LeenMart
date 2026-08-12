import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

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

export type KycDocumentTypeDto = z.infer<typeof kycDocumentTypeSchema>;
export type KycUploadIntentDocument = z.infer<typeof kycUploadIntentDocumentSchema>;
export type CreateKycUploadIntentRequest = z.infer<typeof createKycUploadIntentRequestSchema>;
export type KycUploadIntent = z.infer<typeof kycUploadIntentSchema>;
export type CreateKycUploadIntentResponse = z.infer<typeof createKycUploadIntentResponseSchema>;
