import { z } from 'zod';
import { cursorPaginationSchema, isoDateTimeSchema, uuidSchema } from '../common/primitives.js';
import { kycDocumentContentTypeSchema, kycDocumentTypeSchema } from './kyc.contract.js';
import { vendorStatusSchema } from './vendor.contract.js';

/**
 * The lifecycle states an administrator may filter the review queue by.
 *
 * A strict subset of `vendorStatusSchema`: the KYC phase of SDD 15.1's
 * lifecycle and nothing else. `REGISTERED` has no submission to review,
 * `ACTIVE`/`SUSPENDED`/`TERMINATED` are post-KYC concerns, and offering them
 * here would invite a query that returns rows this queue has no business
 * showing.
 */
export const adminKycQueueStatusSchema = z.enum([
  'KYC_SUBMITTED',
  'KYC_UNDER_REVIEW',
  'KYC_APPROVED',
  'KYC_REJECTED',
]);

/**
 * The default queue: everything still awaiting a decision.
 *
 * `KYC_UNDER_REVIEW` is included deliberately. A claimed submission stays
 * visible so a second reviewer can see it is already being worked — hiding it
 * would make "claimed" indistinguishable from "gone", and two reviewers would
 * duplicate each other's work on the next item instead.
 */
export const ADMIN_KYC_QUEUE_DEFAULT_STATUSES = [
  'KYC_SUBMITTED',
  'KYC_UNDER_REVIEW',
] as const satisfies readonly z.infer<typeof adminKycQueueStatusSchema>[];

/**
 * Query parameters for the review queue.
 *
 * Extends the platform's existing cursor convention (SDD 9.2) rather than
 * declaring its own — `limit` 1–100 defaulting to 20, plus an opaque `cursor`.
 * `status` may be repeated; omitting it yields the pending queue above, so the
 * default can never be a page of already-decided submissions.
 */
export const adminKycQueueQuerySchema = cursorPaginationSchema
  .extend({
    status: z
      .union([adminKycQueueStatusSchema, z.array(adminKycQueueStatusSchema).nonempty()])
      .optional()
      .transform((value) => {
        if (!value) return undefined;
        return Array.isArray(value) ? value : [value];
      }),
  })
  .strict();

/**
 * One row of the queue.
 *
 * Enough to triage — who submitted, how long ago, whether someone already has
 * it — and nothing more. The masked identifier fragments are the same last-4
 * forms SDD 12.3 displays by default, which the database already stores in
 * place of the full values.
 */
export const adminKycQueueItemSchema = z
  .object({
    kycId: uuidSchema,
    vendorId: uuidSchema,
    vendorStatus: vendorStatusSchema,
    panLast4: z.string(),
    gstin: z.string(),
    submittedAt: isoDateTimeSchema,
    /** Present once a reviewer has claimed it; `null` while unclaimed. */
    reviewedBy: uuidSchema.nullable(),
    startedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

export const adminKycQueueResponseSchema = z.array(adminKycQueueItemSchema);

/** Document metadata only — never a key, a URL, or a byte. */
export const adminKycDocumentSchema = z
  .object({
    type: kycDocumentTypeSchema,
    contentType: kycDocumentContentTypeSchema,
    sizeBytes: z.number().int().positive(),
    status: z.enum(['AWAITING_UPLOAD', 'UPLOADED']),
    uploadedAt: isoDateTimeSchema.nullable(),
  })
  .strict();

/**
 * One submission in full, as an administrator sees it.
 *
 * `.strict()` on every object here is doing security work, not tidiness: it is
 * what makes a field added to the read model fail loudly at the boundary
 * instead of being published. What must never appear — `wrappedDataKey`, any
 * plaintext data key, `panFingerprint`/`bankFingerprint`, `objectKey`, or any
 * presigned URL — is absent by construction rather than by filtering.
 *
 * `objectKey` is omitted on purpose even though it is not itself a secret:
 * document access is KYC-7's, and publishing storage paths before there is an
 * authorised way to use them only widens what a compromised admin session
 * learns.
 */
export const adminKycSubmissionDetailSchema = z
  .object({
    kycId: uuidSchema,
    vendorId: uuidSchema,
    vendorStatus: vendorStatusSchema,
    panLast4: z.string(),
    gstin: z.string(),
    bankAccountLast4: z.string(),
    ifsc: z.string(),
    submittedAt: isoDateTimeSchema,
    reviewedBy: uuidSchema.nullable(),
    startedAt: isoDateTimeSchema.nullable(),
    decidedBy: uuidSchema.nullable(),
    decidedAt: isoDateTimeSchema.nullable(),
    rejectionReason: z
      .enum([
        'DOCUMENT_UNCLEAR',
        'DOCUMENT_INVALID',
        'DETAILS_MISMATCH',
        'BANK_DETAILS_MISMATCH',
        'DUPLICATE_IDENTITY',
        'OTHER',
      ])
      .nullable(),
    rejectionNote: z.string().nullable(),
    documents: z.array(adminKycDocumentSchema),
  })
  .strict();

/**
 * Claiming carries no body. The reviewer's identity comes from the verified
 * access token, never from the request — accepting it here would let one
 * administrator record a decision under a colleague's name.
 */
export const startKycReviewRequestSchema = z.object({}).strict();

/** The closed rejection vocabulary, mirroring the domain's `KycRejectionReason`. */
export const kycRejectionReasonSchema = z.enum([
  'DOCUMENT_UNCLEAR',
  'DOCUMENT_INVALID',
  'DETAILS_MISMATCH',
  'BANK_DETAILS_MISMATCH',
  'DUPLICATE_IDENTITY',
  'OTHER',
]);

/**
 * One endpoint, two shapes, discriminated on `decision`.
 *
 * A discriminated union rather than optional fields so `reason` is impossible
 * to supply with an approval and impossible to omit from a rejection — the
 * wire shape refuses what the domain would refuse anyway, one layer earlier.
 *
 * `note` is optional here even for `OTHER`: whether it is *required* is
 * `KycRejectionReason.requiresExplanation()`'s decision, and duplicating that
 * rule in the schema would give two places to change it and one to forget.
 */
export const decideVendorKycRequestSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVE') }).strict(),
  z
    .object({
      decision: z.literal('REJECT'),
      reason: kycRejectionReasonSchema,
      note: z.string().trim().min(1).max(1000).optional(),
    })
    .strict(),
]);

/** What a reviewer sees after claiming: the review state, and nothing else. */
export const startKycReviewResponseSchema = z
  .object({
    kycId: uuidSchema,
    vendorStatus: vendorStatusSchema,
    reviewedBy: uuidSchema,
    startedAt: isoDateTimeSchema,
  })
  .strict();

/** What a reviewer sees after deciding: the recorded outcome. */
export const decideVendorKycResponseSchema = z
  .object({
    kycId: uuidSchema,
    vendorStatus: vendorStatusSchema,
    decidedBy: uuidSchema,
    decidedAt: isoDateTimeSchema,
    rejectionReason: kycRejectionReasonSchema.nullable(),
    rejectionNote: z.string().nullable(),
  })
  .strict();

export type AdminKycQueueStatus = z.infer<typeof adminKycQueueStatusSchema>;
export type KycRejectionReasonDto = z.infer<typeof kycRejectionReasonSchema>;
export type StartKycReviewRequest = z.infer<typeof startKycReviewRequestSchema>;
export type StartKycReviewResponse = z.infer<typeof startKycReviewResponseSchema>;
export type DecideVendorKycRequest = z.infer<typeof decideVendorKycRequestSchema>;
export type DecideVendorKycResponse = z.infer<typeof decideVendorKycResponseSchema>;
export type AdminKycQueueQuery = z.infer<typeof adminKycQueueQuerySchema>;
export type AdminKycQueueItem = z.infer<typeof adminKycQueueItemSchema>;
export type AdminKycQueueResponse = z.infer<typeof adminKycQueueResponseSchema>;
export type AdminKycDocument = z.infer<typeof adminKycDocumentSchema>;
export type AdminKycSubmissionDetail = z.infer<typeof adminKycSubmissionDetailSchema>;
