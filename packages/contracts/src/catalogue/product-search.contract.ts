import { z } from 'zod';
import { cursorPaginationSchema, isoDateTimeSchema, uuidSchema } from '../common/primitives.js';
import { productAttributeValuesSchema } from './product.contract.js';

/**
 * The public, unauthenticated search surface (S2-7, SDD 6.4/9.4).
 *
 * A standalone contract file rather than an extension of `product.contract.ts`
 * — the vendor-facing schemas there answer to the owning vendor and carry
 * fields (`status`, `rejectionReason`, `rejectionNote`) a stranger on the
 * internet must never see, even as `null`. Mirrors why
 * `product-media.contract.ts` exists next to it instead of folding in.
 *
 * `q`/`categoryId`/`vendorId` are exact/substring filters only (S2-7
 * decision D, narrow scope) — no price or availability filtering yet
 * (decision K, deferred with the variant/inventory surface it would need).
 */
export const publicProductSearchQuerySchema = cursorPaginationSchema
  .extend({
    q: z.string().trim().min(1).max(200).optional(),
    categoryId: uuidSchema.optional(),
    vendorId: uuidSchema.optional(),
  })
  .strict();

/**
 * One product as an anonymous searcher sees it.
 *
 * Deliberately narrower than `vendorProductSchema`: `status` is omitted
 * because RLS already guarantees every row here is `APPROVED`, so the field
 * would carry no information; `rejectionReason`/`rejectionNote` are
 * moderation detail no outside caller has standing to read. No variant,
 * price, or inventory data is included at this milestone (decision L,
 * product-level only) — the commercial surface stays out of scope until a
 * public product-detail/pricing endpoint is designed.
 *
 * `mediaCount` is the only media signal (decision I, leaning `mediaCount`
 * over a bare `hasMedia` boolean, since a count subsumes it) — never an
 * object key, bucket, or CDN URL (S2-6c is still deferred).
 */
export const publicProductSearchResultSchema = z
  .object({
    id: uuidSchema,
    categoryId: uuidSchema,
    name: z.string(),
    brand: z.string().nullable(),
    description: z.string().nullable(),
    hsnCode: z.string().nullable(),
    countryOfOrigin: z.string().nullable(),
    netQuantity: z.string().nullable(),
    attributeValues: productAttributeValuesSchema,
    mediaCount: z.number().int().nonnegative(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const publicProductSearchListResponseSchema = z.array(publicProductSearchResultSchema);

export type PublicProductSearchQuery = z.infer<typeof publicProductSearchQuerySchema>;
export type PublicProductSearchResult = z.infer<typeof publicProductSearchResultSchema>;
export type PublicProductSearchListResponse = z.infer<typeof publicProductSearchListResponseSchema>;
