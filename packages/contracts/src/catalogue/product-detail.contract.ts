import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from '../common/primitives.js';
import { productAttributeValuesSchema } from './product.contract.js';

/**
 * One variant as an anonymous product-detail caller sees it (S3-3 discovery
 * milestone).
 *
 * `price` is the vendor's own stored selling price (`ProductVariant.price`),
 * echoed as-is through the platform's `moneySchema` convention — the same
 * field `vendorProductVariantSchema.price` already carries for the owning
 * vendor, not a new calculation. No GST/commission/TCS/TDS math happens here
 * or anywhere in this contract.
 *
 * `available` is `Inventory.available` only — `reserved` and `version` are
 * internal fields (concurrent-checkout state and an optimistic-concurrency
 * token respectively) that stay off this surface, the same restraint
 * `publicProductSearchResultSchema` already applies to `status`/`vendorId`.
 *
 * No `sku`: no established customer-facing purpose for it exists yet in this
 * codebase, and nothing here invents one.
 */
export const publicProductVariantSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    price: moneySchema,
    unitOfMeasure: z.string(),
    quantityStep: z.number().int().positive(),
    available: z.number().int().nonnegative(),
  })
  .strict();

/**
 * One product as an anonymous product-detail caller sees it (S3-3 discovery
 * milestone, `GET /api/v1/catalogue/products/:id`).
 *
 * Every product-level field mirrors `publicProductSearchResultSchema` exactly
 * — same fields, same omissions (`status`, `rejectionReason`,
 * `rejectionNote`, `vendorId` stay off both). `variants` is the one thing
 * this surface adds over search: the commercial detail
 * `publicProductSearchResultSchema`'s own comment named as still out of
 * scope until "a public product-detail/pricing endpoint is designed" — this
 * is that endpoint.
 *
 * No media URLs: product media has no delivery mechanism yet (S2-6c is still
 * deferred) — `mediaCount` is the only media signal, identical to search.
 */
export const publicProductDetailSchema = z
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
    variants: z.array(publicProductVariantSchema),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export type PublicProductVariant = z.infer<typeof publicProductVariantSchema>;
export type PublicProductDetail = z.infer<typeof publicProductDetailSchema>;
