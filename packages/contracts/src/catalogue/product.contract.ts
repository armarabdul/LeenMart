import { z } from 'zod';
import {
  cursorPaginationSchema,
  isoDateTimeSchema,
  moneySchema,
  uuidSchema,
} from '../common/primitives.js';

/**
 * The moderation lifecycle (SDD 15.2), as far as it exists.
 *
 * `DRAFT` alone, because that is the only state the domain can currently
 * reach — a wider enum here would publish states nothing can produce and
 * clients could not act on.
 */
export const productStatusSchema = z.enum(['DRAFT']);

export const productNameSchema = z.string().trim().min(1).max(200);
export const productBrandSchema = z.string().trim().min(1).max(120);
/** HSN/SAC code (BR-13). Shape only — never checked against the category's requirement flags (S2-3 D-2). */
export const hsnCodeSchema = z.string().trim().min(1).max(8);
/** ISO 3166-1 alpha-2 (BR-15's "country of origin"). */
export const countryOfOriginSchema = z.string().trim().length(2);
export const netQuantitySchema = z.string().trim().min(1).max(40);

/**
 * Per-category attribute values (SDD 6.1's JSONB principle).
 *
 * Deliberately open-shaped: what a product may carry is whatever its
 * category's attribute definitions allow (S2-2b), and validating that here
 * would duplicate a rule the category owns and the submission flow will
 * eventually enforce.
 */
export const productAttributeValuesSchema = z.record(z.unknown());

export const skuSchema = z.string().trim().min(1).max(64);
export const variantNameSchema = z.string().trim().min(1).max(120);
/** Free text (S2-3 D-3): the SDD gives examples but never a closed vocabulary. */
export const unitOfMeasureSchema = z.string().trim().min(1).max(40);
export const quantityStepSchema = z.number().int().positive();

/** The one variant every new product must carry (S2-3 D-7). */
export const createProductVariantRequestSchema = z
  .object({
    sku: skuSchema,
    name: variantNameSchema,
    price: moneySchema,
    unitOfMeasure: unitOfMeasureSchema,
    quantityStep: quantityStepSchema,
  })
  .strict();

/**
 * Creating a product creates its first variant in the same request (S2-3 D-7).
 *
 * `variant` is required rather than optional: "every product has at least one
 * variant" (SDD 6.3) is not a rule a follow-up call can be trusted to honour,
 * and a two-step API would let a product exist, however briefly, with none.
 *
 * `vendorId` and `status` are absent by construction. Ownership comes from the
 * tenant context, never the body, and `status` moves only through a moderation
 * flow that does not exist yet — `.strict()` turns an attempt at either into a
 * 400 rather than a silent ignore.
 */
export const createProductRequestSchema = z
  .object({
    categoryId: uuidSchema,
    name: productNameSchema,
    brand: productBrandSchema.nullable().optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    hsnCode: hsnCodeSchema.nullable().optional(),
    countryOfOrigin: countryOfOriginSchema.nullable().optional(),
    netQuantity: netQuantitySchema.nullable().optional(),
    attributeValues: productAttributeValuesSchema.optional(),
    variant: createProductVariantRequestSchema,
  })
  .strict();

/**
 * A partial edit. Every field optional; supplying none is a no-op.
 *
 * **`id`, `vendorId`, `status` and the timestamps are absent by design.**
 * Ownership and lifecycle are not editable through a field, and `.strict()` is
 * what makes an attempt at any of them a 400 instead of a quietly dropped key.
 */
export const updateProductRequestSchema = z
  .object({
    categoryId: uuidSchema.optional(),
    name: productNameSchema.optional(),
    brand: productBrandSchema.nullable().optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    hsnCode: hsnCodeSchema.nullable().optional(),
    countryOfOrigin: countryOfOriginSchema.nullable().optional(),
    netQuantity: netQuantitySchema.nullable().optional(),
    attributeValues: productAttributeValuesSchema.optional(),
  })
  .strict();

/** Adding a variant to an existing product. Same shape as the first one. */
export const addProductVariantRequestSchema = createProductVariantRequestSchema;

/**
 * A partial edit of one variant.
 *
 * **`sku` is absent**, and that is S2-3a's decision preserved rather than a
 * new one: the entity was given no SKU mutator, and it is the identifier
 * `uq_product_variants_vendor_sku` arbitrates. `productId` and `vendorId` are
 * likewise absent — a variant does not move between products or vendors.
 */
export const updateProductVariantRequestSchema = z
  .object({
    name: variantNameSchema.optional(),
    price: moneySchema.optional(),
    unitOfMeasure: unitOfMeasureSchema.optional(),
    quantityStep: quantityStepSchema.optional(),
  })
  .strict();

/**
 * One variant as its owning vendor sees it.
 *
 * `.strict()` does the same security work it does on `adminCategorySchema`: a
 * column added to the row later fails loudly here instead of being published
 * by a spread. `deletedAt` is absent by construction.
 */
export const vendorProductVariantSchema = z
  .object({
    id: uuidSchema,
    productId: uuidSchema,
    sku: skuSchema,
    name: z.string(),
    price: moneySchema,
    unitOfMeasure: z.string(),
    quantityStep: z.number().int().positive(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** One product as its owning vendor sees it. `deletedAt` is absent by construction. */
export const vendorProductSchema = z
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
    status: productStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Creation answers with both rows, because both were created (S2-3 D-7). */
export const createProductResponseSchema = z
  .object({ product: vendorProductSchema, variant: vendorProductVariantSchema })
  .strict();

/** Extends the platform's cursor convention (SDD 9.2) rather than declaring its own. */
export const vendorProductListQuerySchema = cursorPaginationSchema.strict();

export const vendorProductListResponseSchema = z.array(vendorProductSchema);

/** Ordered oldest-first and deliberately not paginated — see `ListProductVariantsUseCase`. */
export const vendorProductVariantListResponseSchema = z.array(vendorProductVariantSchema);

export type ProductStatusDto = z.infer<typeof productStatusSchema>;
export type CreateProductVariantRequest = z.infer<typeof createProductVariantRequestSchema>;
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;
export type AddProductVariantRequest = z.infer<typeof addProductVariantRequestSchema>;
export type UpdateProductVariantRequest = z.infer<typeof updateProductVariantRequestSchema>;
export type VendorProduct = z.infer<typeof vendorProductSchema>;
export type VendorProductVariant = z.infer<typeof vendorProductVariantSchema>;
export type CreateProductResponse = z.infer<typeof createProductResponseSchema>;
export type VendorProductListQuery = z.infer<typeof vendorProductListQuerySchema>;
export type VendorProductListResponse = z.infer<typeof vendorProductListResponseSchema>;
export type VendorProductVariantListResponse = z.infer<
  typeof vendorProductVariantListResponseSchema
>;
