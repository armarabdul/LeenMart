import { z } from 'zod';
import { cursorPaginationSchema, isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

/** SDD 15.2's category risk tiers. Assigned explicitly per category, never inherited. */
export const categoryRiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'RESTRICTED']);

/**
 * A category's stable public URL key.
 *
 * The same expression `chk_categories_slug_format` enforces in PostgreSQL and
 * `isCategorySlug` enforces in the domain — declared here too so a malformed
 * slug is refused at the boundary with a field-level message rather than
 * surfacing as a constraint violation.
 */
export const categorySlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(140)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    'Must be lowercase letters, digits and single hyphens, with no leading or trailing hyphen',
  );

export const categoryNameSchema = z.string().trim().min(1).max(120);

/**
 * SDD 15.2's mandatory-field completeness screen, made category-conditional
 * (HSN, country of origin, net quantity — BR-15/BR-21).
 *
 * Three fixed booleans rather than an open map: this is a closed statutory
 * set, and a map would invite a fourth key nobody implemented. **FSSAI
 * (BR-17) is deliberately absent** — no vendor licence record exists for a
 * food category to demand, so the flag would express a requirement nothing
 * could satisfy.
 */
export const categoryRequirementsSchema = z
  .object({
    requiresHsn: z.boolean(),
    requiresCountryOfOrigin: z.boolean(),
    requiresNetQuantity: z.boolean(),
  })
  .strict();

/**
 * `parentId: null` creates a root. The field is required rather than optional
 * so that "this is a root" is something the caller states, not something they
 * fall into by forgetting a key.
 */
export const createCategoryRequestSchema = z
  .object({
    parentId: uuidSchema.nullable(),
    name: categoryNameSchema,
    slug: categorySlugSchema,
    riskLevel: categoryRiskLevelSchema.default('LOW'),
    requirements: categoryRequirementsSchema.default({
      requiresHsn: false,
      requiresCountryOfOrigin: false,
      requiresNetQuantity: false,
    }),
  })
  .strict();

/**
 * A partial edit. Every field optional; supplying none is a no-op rather than
 * an error.
 *
 * **`slug` and `parentId` are absent by design.** A slug is immutable (a
 * changing slug is not a stable URL), and moving a category rewrites its whole
 * subtree — a sub-resource action under SDD 9.2's "non-CRUD actions" rule, not
 * a field edit. `.strict()` is what turns both omissions into a 400 rather
 * than a silent ignore.
 */
export const updateCategoryRequestSchema = z
  .object({
    name: categoryNameSchema.optional(),
    riskLevel: categoryRiskLevelSchema.optional(),
    requirements: categoryRequirementsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/** `parentId: null` moves the category to the root of the tree. */
export const reparentCategoryRequestSchema = z.object({ parentId: uuidSchema.nullable() }).strict();

/**
 * One category as an administrator sees it.
 *
 * `.strict()` is doing the same security work it does on
 * `adminKycSubmissionDetailSchema`: a column added to the row later fails
 * loudly at this boundary instead of being published by a spread.
 */
export const adminCategorySchema = z
  .object({
    id: uuidSchema,
    parentId: uuidSchema.nullable(),
    /** Ancestor ids, root-first, excluding self. Empty for a root. */
    path: z.array(uuidSchema),
    depth: z.number().int().positive(),
    name: z.string(),
    slug: categorySlugSchema,
    riskLevel: categoryRiskLevelSchema,
    requirements: categoryRequirementsSchema,
    isActive: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Extends the platform's cursor convention (SDD 9.2) rather than declaring its own. */
export const adminCategoryListQuerySchema = cursorPaginationSchema.strict();

export const adminCategoryListResponseSchema = z.array(adminCategorySchema);

export type CategoryRiskLevelDto = z.infer<typeof categoryRiskLevelSchema>;
export type CategoryRequirementsDto = z.infer<typeof categoryRequirementsSchema>;
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;
export type ReparentCategoryRequest = z.infer<typeof reparentCategoryRequestSchema>;
export type AdminCategory = z.infer<typeof adminCategorySchema>;
export type AdminCategoryListQuery = z.infer<typeof adminCategoryListQuerySchema>;
export type AdminCategoryListResponse = z.infer<typeof adminCategoryListResponseSchema>;
