import { z } from 'zod';
import { cursorPaginationSchema, isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

/** Integer 1–5 only (S8-REVIEWS locked V1 scope) — anything else is refused before it reaches the domain. */
export const reviewRatingSchema = z.number().int().min(1).max(5);

export const reviewBodySchema = z.string().trim().min(1).max(2000);

/** Locked V1 states (S8-REVIEWS) — no `review_moderation` history, one column. */
export const reviewModerationStatusSchema = z.enum(['SUBMITTED', 'APPROVED', 'HIDDEN']);

/**
 * POST /api/v1/me/reviews — `orderItemId` is the only reference to the
 * purchase this review is about; the server derives `productId`/`variantId`/
 * `subOrderId`/`customerId` from the verified purchase it resolves to,
 * never from anything else the client sends.
 */
export const createReviewRequestSchema = z
  .object({
    orderItemId: uuidSchema,
    rating: reviewRatingSchema,
    body: reviewBodySchema,
  })
  .strict();

/** The caller's own review, every field they are entitled to see about their own submission. */
export const reviewResponseSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  variantId: uuidSchema,
  subOrderId: uuidSchema,
  orderItemId: uuidSchema,
  rating: reviewRatingSchema,
  body: z.string(),
  status: reviewModerationStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const listMyReviewsResponseSchema = z.array(reviewResponseSchema);

/**
 * One row of the public, approved-only listing — deliberately narrower than
 * `reviewResponseSchema`: no `customerId`, no `status` (every row here is
 * already `APPROVED` by construction), no purchase references. Locked
 * scope §4: never a reviewer identity beyond what the existing product UI
 * already supports, which today is none.
 */
export const publicReviewItemSchema = z.object({
  id: uuidSchema,
  rating: reviewRatingSchema,
  body: z.string(),
  createdAt: isoDateTimeSchema,
});

/** Simple average and count over `APPROVED` reviews only (locked V1 scope — no Bayesian weighting, no recency decay). `null` average, never `0`, when there are no approved reviews yet. */
export const productReviewSummarySchema = z.object({
  averageRating: z.number().min(1).max(5).nullable(),
  approvedReviewCount: z.number().int().min(0),
});

export const listProductReviewsQuerySchema = cursorPaginationSchema.strict();

/** GET /api/v1/catalogue/products/:productId/reviews — the summary and the approved list together, the natural place a product's own reviews belong. */
export const listProductReviewsResponseSchema = z.object({
  summary: productReviewSummarySchema,
  items: z.array(publicReviewItemSchema),
  nextCursor: z.string().nullable(),
});

/**
 * GET /api/v1/admin/reviews — mirrors `adminProductQueueQuerySchema` exactly:
 * `status` may be repeated; omitting it yields the queue awaiting a decision
 * (`SUBMITTED`).
 */
export const adminReviewQueueQuerySchema = cursorPaginationSchema
  .extend({
    status: z
      .union([reviewModerationStatusSchema, z.array(reviewModerationStatusSchema).nonempty()])
      .optional()
      .transform((value) => {
        if (!value) return undefined;
        return Array.isArray(value) ? value : [value];
      }),
  })
  .strict();

/** One row of the moderation queue — full detail, since a review has no separate "extra" fields the way a product's admin detail view does; there is no dedicated detail endpoint (locked scope §8: no endpoint the queue row cannot already serve). */
export const adminReviewQueueItemSchema = z.object({
  id: uuidSchema,
  customerId: uuidSchema,
  productId: uuidSchema,
  variantId: uuidSchema,
  rating: reviewRatingSchema,
  body: z.string(),
  status: reviewModerationStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const adminReviewQueueResponseSchema = z.array(adminReviewQueueItemSchema);

/**
 * POST /api/v1/admin/reviews/:reviewId/decision — two verbs, not three.
 * Restoring visibility on a `HIDDEN` review is `APPROVE` reapplied (locked
 * transitions: `SUBMITTED`→`APPROVED`, `HIDDEN`→`APPROVED` are one action),
 * not a separate `RESTORE` verb naming the same decision twice.
 */
export const decideReviewModerationRequestSchema = z
  .object({ decision: z.enum(['APPROVE', 'HIDE']) })
  .strict();

export const decideReviewModerationResponseSchema = z.object({
  id: uuidSchema,
  status: reviewModerationStatusSchema,
  updatedAt: isoDateTimeSchema,
});

export type ReviewModerationStatusDto = z.infer<typeof reviewModerationStatusSchema>;
export type CreateReviewRequest = z.infer<typeof createReviewRequestSchema>;
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;
export type ListMyReviewsResponse = z.infer<typeof listMyReviewsResponseSchema>;
export type PublicReviewItem = z.infer<typeof publicReviewItemSchema>;
export type ProductReviewSummary = z.infer<typeof productReviewSummarySchema>;
export type ListProductReviewsQuery = z.infer<typeof listProductReviewsQuerySchema>;
export type ListProductReviewsResponse = z.infer<typeof listProductReviewsResponseSchema>;
export type AdminReviewQueueQuery = z.infer<typeof adminReviewQueueQuerySchema>;
export type AdminReviewQueueItem = z.infer<typeof adminReviewQueueItemSchema>;
export type AdminReviewQueueResponse = z.infer<typeof adminReviewQueueResponseSchema>;
export type DecideReviewModerationRequest = z.infer<typeof decideReviewModerationRequestSchema>;
export type DecideReviewModerationResponse = z.infer<typeof decideReviewModerationResponseSchema>;
