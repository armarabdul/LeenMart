import { z } from 'zod';
import { isoDateTimeSchema, phoneSchema, pincodeSchema, uuidSchema } from '../common/primitives.js';

const recipientNameSchema = z.string().trim().min(1).max(100);
const line1Schema = z.string().trim().min(1).max(200);
const line2Schema = z.string().trim().max(200);
const citySchema = z.string().trim().min(1).max(100);
const stateSchema = z.string().trim().min(1).max(100);
const landmarkSchema = z.string().trim().max(200);
const labelSchema = z.string().trim().min(1).max(50);

/** POST /api/v1/me/addresses — every field required; `line2`/`landmark` may be an empty string (normalised to "not set"). */
export const addAddressRequestSchema = z
  .object({
    recipientName: recipientNameSchema,
    phone: phoneSchema,
    line1: line1Schema,
    line2: line2Schema.optional(),
    city: citySchema,
    state: stateSchema,
    pincode: pincodeSchema,
    landmark: landmarkSchema.optional(),
    label: labelSchema,
  })
  .strict();

/** PATCH /api/v1/me/addresses/:id — every field optional (PATCH semantics: only supplied fields change). */
export const updateAddressRequestSchema = z
  .object({
    recipientName: recipientNameSchema.optional(),
    phone: phoneSchema.optional(),
    line1: line1Schema.optional(),
    line2: line2Schema.optional(),
    city: citySchema.optional(),
    state: stateSchema.optional(),
    pincode: pincodeSchema.optional(),
    landmark: landmarkSchema.optional(),
    label: labelSchema.optional(),
  })
  .strict();

export const addressResponseSchema = z.object({
  id: uuidSchema,
  recipientName: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
  landmark: z.string().nullable(),
  label: z.string(),
  isDefault: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const listAddressesResponseSchema = z.array(addressResponseSchema);

/** DELETE /api/v1/me/addresses/:id never returns the (now-gone) address — same uniform shape as `logoutResponseSchema`. */
export const removeAddressResponseSchema = z.object({
  success: z.literal(true),
});

export type AddAddressRequest = z.infer<typeof addAddressRequestSchema>;
export type UpdateAddressRequest = z.infer<typeof updateAddressRequestSchema>;
export type AddressResponse = z.infer<typeof addressResponseSchema>;
export type ListAddressesResponse = z.infer<typeof listAddressesResponseSchema>;
export type RemoveAddressResponse = z.infer<typeof removeAddressResponseSchema>;
