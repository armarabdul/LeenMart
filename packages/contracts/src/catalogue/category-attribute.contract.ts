import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

/** The closed vocabulary (S2-2b). Four types; anything richer becomes a schema language. */
export const categoryAttributeTypeSchema = z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'ENUM']);

/**
 * A stable machine identifier, not a display string — the same expression
 * `chk_category_attributes_key_format` enforces in PostgreSQL and
 * `CATEGORY_ATTRIBUTE_KEY_PATTERN` enforces in the domain.
 */
export const categoryAttributeKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Must start with a lowercase letter and contain only lowercase letters, digits and underscores',
  );

export const categoryAttributeLabelSchema = z.string().trim().min(1).max(120);
export const categoryAttributeUnitSchema = z.string().trim().min(1).max(20);
export const categoryAttributeOptionSchema = z.string().trim().min(1).max(80);

/**
 * A caller-supplied ordering hint. Ties are permitted, which is why reads sort
 * by `(position, key)` — the secondary key is what makes the order total.
 */
export const categoryAttributePositionSchema = z.number().int().min(0).max(32_767);

const common = {
  key: categoryAttributeKeySchema,
  label: categoryAttributeLabelSchema,
  isRequired: z.boolean().default(false),
  position: categoryAttributePositionSchema,
};

/**
 * One endpoint, four shapes, discriminated on `dataType`.
 *
 * A discriminated union rather than optional fields, exactly as
 * `decideVendorKycRequestSchema` is: `unit` is impossible to supply on
 * anything but a NUMBER, `options` impossible on anything but an ENUM, and
 * impossible to *omit* from one. `.strict()` on each member is what turns each
 * of those into a 400 at the boundary rather than a constraint violation three
 * layers down.
 *
 * The same rules are enforced again by the aggregate and again by two `CHECK`
 * constraints. That is defence in depth on a rule the database cannot recover
 * from being wrong about, not redundancy.
 *
 * No cap on how many options an ENUM may carry: nothing in the SDD sets one,
 * and the platform's existing request body limit is the control that already
 * bounds it.
 */
export const createCategoryAttributeRequestSchema = z.discriminatedUnion('dataType', [
  z.object({ ...common, dataType: z.literal('STRING') }).strict(),
  z.object({ ...common, dataType: z.literal('BOOLEAN') }).strict(),
  z
    .object({
      ...common,
      dataType: z.literal('NUMBER'),
      unit: categoryAttributeUnitSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...common,
      dataType: z.literal('ENUM'),
      options: z.array(categoryAttributeOptionSchema).nonempty(),
    })
    .strict(),
]);

/**
 * A partial edit. Every field optional; supplying none is a no-op.
 *
 * **`key` and `dataType` are absent by design** — neither can change, and
 * `.strict()` turns an attempt at either into a 400 rather than a silent
 * ignore.
 *
 * That immutability is also why this cannot be a discriminated union: the
 * discriminator is not on the wire. Whether `unit` or `options` is legal
 * depends on the *stored* type, so the aggregate checks them against it and
 * answers 422 — the same division of labour `note`/`OTHER` uses in the KYC
 * decision contract, where duplicating a domain rule in the schema would give
 * two places to change it and one to forget.
 *
 * `unit: null` clears a NUMBER's unit; omitting the key leaves it alone.
 */
export const updateCategoryAttributeRequestSchema = z
  .object({
    label: categoryAttributeLabelSchema.optional(),
    isRequired: z.boolean().optional(),
    position: categoryAttributePositionSchema.optional(),
    unit: categoryAttributeUnitSchema.nullable().optional(),
    options: z.array(categoryAttributeOptionSchema).optional(),
  })
  .strict();

/**
 * One attribute definition as an administrator sees it.
 *
 * `.strict()` does the same work it does on `adminCategorySchema`: a column
 * added to the row later fails loudly here instead of being published by a
 * spread. `deletedAt` is absent by construction.
 */
export const adminCategoryAttributeSchema = z
  .object({
    id: uuidSchema,
    categoryId: uuidSchema,
    key: categoryAttributeKeySchema,
    label: z.string(),
    dataType: categoryAttributeTypeSchema,
    isRequired: z.boolean(),
    /** Present for NUMBER only. */
    unit: z.string().nullable(),
    /** Non-empty for ENUM only. */
    options: z.array(z.string()),
    position: z.number().int().min(0),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Ordered `position ASC, key ASC`. Deliberately not paginated — see the list use case. */
export const adminCategoryAttributeListResponseSchema = z.array(adminCategoryAttributeSchema);

export type CategoryAttributeTypeDto = z.infer<typeof categoryAttributeTypeSchema>;
export type CreateCategoryAttributeRequest = z.infer<typeof createCategoryAttributeRequestSchema>;
export type UpdateCategoryAttributeRequest = z.infer<typeof updateCategoryAttributeRequestSchema>;
export type AdminCategoryAttribute = z.infer<typeof adminCategoryAttributeSchema>;
export type AdminCategoryAttributeListResponse = z.infer<
  typeof adminCategoryAttributeListResponseSchema
>;
