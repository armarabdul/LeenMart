import { z } from 'zod';
import { cursorPaginationSchema, isoDateTimeSchema, uuidSchema } from '../common/primitives.js';
import { productAttributeValuesSchema, productRejectionReasonSchema } from './product.contract.js';

/**
 * The moderation phase an administrator may filter the review queue by
 * (SDD 15.2). `DRAFT` is excluded — a product that was never submitted has
 * nothing for a reviewer to do, mirroring `adminKycQueueStatusSchema`'s
 * exclusion of `REGISTERED`.
 */
export const adminProductQueueStatusSchema = z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED']);

/**
 * The default queue: everything still awaiting a decision.
 *
 * Unlike KYC's default (`KYC_SUBMITTED` + `KYC_UNDER_REVIEW`), this is a
 * single status — S2-5 builds no claim step (D-5-D), so "awaiting a
 * decision" is exactly `PENDING_REVIEW`.
 */
export const ADMIN_PRODUCT_QUEUE_DEFAULT_STATUSES = [
  'PENDING_REVIEW',
] as const satisfies readonly z.infer<typeof adminProductQueueStatusSchema>[];

/**
 * Query parameters for the review queue.
 *
 * Extends the platform's existing cursor convention (SDD 9.2), mirroring
 * `adminKycQueueQuerySchema` exactly: `status` may be repeated; omitting it
 * yields the pending queue above.
 */
export const adminProductQueueQuerySchema = cursorPaginationSchema
  .extend({
    status: z
      .union([adminProductQueueStatusSchema, z.array(adminProductQueueStatusSchema).nonempty()])
      .optional()
      .transform((value) => {
        if (!value) return undefined;
        return Array.isArray(value) ? value : [value];
      }),
  })
  .strict();

/** One row of the queue — enough to triage, nothing more. */
export const adminProductQueueItemSchema = z
  .object({
    productId: uuidSchema,
    vendorId: uuidSchema,
    categoryId: uuidSchema,
    name: z.string(),
    status: adminProductQueueStatusSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const adminProductQueueResponseSchema = z.array(adminProductQueueItemSchema);

/**
 * One product in full, as an administrator sees it.
 *
 * `.strict()` does the same security work it does on
 * `adminKycSubmissionDetailSchema`: a column added to `products` later fails
 * loudly here instead of being published by a spread.
 */
export const adminProductDetailSchema = z
  .object({
    productId: uuidSchema,
    vendorId: uuidSchema,
    categoryId: uuidSchema,
    name: z.string(),
    brand: z.string().nullable(),
    description: z.string().nullable(),
    hsnCode: z.string().nullable(),
    countryOfOrigin: z.string().nullable(),
    netQuantity: z.string().nullable(),
    attributeValues: productAttributeValuesSchema,
    status: adminProductQueueStatusSchema,
    rejectionReason: productRejectionReasonSchema.nullable(),
    rejectionNote: z.string().nullable(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/**
 * One endpoint, two shapes, discriminated on `decision` — mirrors
 * `decideVendorKycRequestSchema`, `note` included: SDD 15.2, verbatim, "a
 * structured reason code plus optional free text". `reason` is required;
 * `note` may be omitted entirely, and when supplied must be non-blank after
 * trimming and at most 1000 characters — the same shape rule an omitted note
 * is exempt from, not held to a laxer one.
 */
export const decideProductRequestSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE') }).strict(),
  z
    .object({
      decision: z.literal('REJECT'),
      reason: productRejectionReasonSchema,
      note: z.string().trim().min(1).max(1000).optional(),
    })
    .strict(),
]);

/** What a reviewer sees after deciding: the recorded outcome. */
export const decideProductResponseSchema = z
  .object({
    productId: uuidSchema,
    status: adminProductQueueStatusSchema,
    rejectionReason: productRejectionReasonSchema.nullable(),
    rejectionNote: z.string().nullable(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export type AdminProductQueueStatus = z.infer<typeof adminProductQueueStatusSchema>;
export type AdminProductQueueQuery = z.infer<typeof adminProductQueueQuerySchema>;
export type AdminProductQueueItem = z.infer<typeof adminProductQueueItemSchema>;
export type AdminProductQueueResponse = z.infer<typeof adminProductQueueResponseSchema>;
export type AdminProductDetail = z.infer<typeof adminProductDetailSchema>;
export type DecideProductRequest = z.infer<typeof decideProductRequestSchema>;
export type DecideProductResponse = z.infer<typeof decideProductResponseSchema>;
