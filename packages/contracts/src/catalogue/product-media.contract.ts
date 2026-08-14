import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

/**
 * S2-6a D-S2-6-I, a project decision — the SDD names none of these values
 * (only "declared type in allowlist, size ≤ cap", SDD 12.2). Mirrors
 * `KYC_DOCUMENT_MAX_BYTES`/`kycDocumentContentTypeSchema`'s own precedent of
 * living in this package as the wire-level copy, separate from (but matching)
 * the API's own `S3ObjectStore` config for the same bucket.
 */
export const PRODUCT_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** jpeg/png/webp — SVG is never offered (SDD 12.2 5b: "REJECT SVG entirely, stored-XSS vector"); video is out of scope (S2-6 D-S2-6-J). */
export const productMediaContentTypeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp']);

/** Product media count limit (S2-6a D-S2-6-I). Enforced server-side under a lock; echoed here only for client-side UX. */
export const MAX_IMAGES_PER_PRODUCT = 8;

/**
 * The upload/processing lifecycle (S2-6a, SDD 12.2), as far as this
 * milestone builds it. `READY`/`FAILED` arrive with S2-6b (the async
 * worker).
 */
export const productMediaStatusSchema = z.enum(['AWAITING_UPLOAD', 'PROCESSING']);

/**
 * Requests a presigned upload URL for one product image (SDD 12.2 steps 1–2).
 *
 * `contentType`/`sizeBytes` are validated here and bound into the signed URL
 * itself by `S3ObjectStore.presignPut` — a client that sends anything else at
 * PUT time is refused by the store, not by this schema.
 */
export const createProductMediaUploadIntentRequestSchema = z
  .object({
    contentType: productMediaContentTypeSchema,
    sizeBytes: z.number().int().positive().max(PRODUCT_MEDIA_MAX_BYTES),
  })
  .strict();

/**
 * What the vendor gets back: a URL good for one PUT, bound to exactly the
 * declared type and length, plus the pending row's id for the `/complete`
 * call that follows. No object key — never accepted from a caller and never
 * useful to one, the same restraint `AdminKycDocumentAccessResponse` applies
 * to KYC's storage paths.
 */
export const createProductMediaUploadIntentResponseSchema = z
  .object({
    mediaId: uuidSchema,
    uploadUrl: z.string().url(),
    expiresAt: isoDateTimeSchema,
    contentType: productMediaContentTypeSchema,
    sizeBytes: z.number().int().positive(),
    status: productMediaStatusSchema,
  })
  .strict();

/** One media item as its owning vendor sees it. `objectKey`/`vendorId`/`deletedAt` are absent by construction. */
export const vendorProductMediaSchema = z
  .object({
    id: uuidSchema,
    productId: uuidSchema,
    contentType: z.string(),
    sizeBytes: z.number().int().positive(),
    status: productMediaStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Completing an upload carries no body — the id in the path names it, and nothing the client claims is trusted over `ObjectStore.head()`. */
export const completeProductMediaUploadRequestSchema = z.object({}).strict();

export const vendorProductMediaListResponseSchema = z.array(vendorProductMediaSchema);

export type ProductMediaContentType = z.infer<typeof productMediaContentTypeSchema>;
export type ProductMediaStatusDto = z.infer<typeof productMediaStatusSchema>;
export type CreateProductMediaUploadIntentRequest = z.infer<
  typeof createProductMediaUploadIntentRequestSchema
>;
export type CreateProductMediaUploadIntentResponse = z.infer<
  typeof createProductMediaUploadIntentResponseSchema
>;
export type CompleteProductMediaUploadRequest = z.infer<
  typeof completeProductMediaUploadRequestSchema
>;
export type VendorProductMedia = z.infer<typeof vendorProductMediaSchema>;
export type VendorProductMediaListResponse = z.infer<typeof vendorProductMediaListResponseSchema>;
