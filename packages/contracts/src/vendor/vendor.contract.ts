import { z } from 'zod';
import { uuidSchema } from '../common/primitives.js';

/** Mirrors the domain `VendorStatus` value object's SDD 15.1 lifecycle states. */
export const vendorStatusSchema = z.enum([
  'REGISTERED',
  'KYC_SUBMITTED',
  'KYC_UNDER_REVIEW',
  'KYC_REJECTED',
  'KYC_APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'TERMINATED',
]);

/**
 * Registration collects no business fields: the profile is created for the
 * authenticated caller, and everything SDD 15.1 describes (KYC documents,
 * bank proof, GSTIN) belongs to submission and approval, not registration.
 * `.strict()` still applies — an empty schema that rejects every supplied
 * field is what closes the mass-assignment hole here (SEC-12).
 */
export const registerVendorRequestSchema = z.object({}).strict();

/** POST /vendors returns only the created profile's identity and lifecycle state. */
export const registerVendorResponseSchema = z.object({
  id: uuidSchema,
  status: vendorStatusSchema,
});

/**
 * PATCH /vendors/me/shop-profile (S3-3A, decision D-S3-03). A single field
 * because that is the entire approved scope — this is not a general shop
 * profile editor.
 */
export const setVendorShopNameRequestSchema = z
  .object({
    shopName: z.string().trim().min(1).max(120),
  })
  .strict();

export const vendorShopProfileResponseSchema = z.object({
  id: uuidSchema,
  status: vendorStatusSchema,
  shopName: z.string().nullable(),
});

/**
 * A vendor's shop address (S4-ADDR). Field-for-field the shape
 * `orderAddressSnapshotSchema` and the customer address book already use,
 * minus the parts that belong to a *delivery* address rather than to premises:
 * no `recipientName`/`phone` (the shop is identified by its own name and the
 * vendor's account), no `label` (there is one address, so nothing to
 * distinguish), and no `landmark`.
 *
 * No country field: `addressRequestSchema` has none either — the platform is
 * India-only (ASM-01). No latitude/longitude: geocoding, PostGIS and delivery
 * radius are separate Stage 4 capabilities, and speculative columns are
 * exactly what this codebase's schema conventions refuse.
 */
export const vendorShopAddressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().min(1).max(200).nullable(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, 'Must be a valid 6-digit Indian pincode'),
});

/**
 * PUT /vendors/me/shop-address (S4-ADDR). A whole-address replace rather than
 * a partial patch: the parts are only meaningful as a set, and a partial
 * update could otherwise leave a half-changed address — a new line1 against
 * the old city — which is worse than no address at all.
 */
export const setVendorShopAddressRequestSchema = vendorShopAddressSchema.strict();

/**
 * GET/PUT /vendors/me/shop-address. `shopAddress` is `null` until the vendor
 * sets one; it is never partially populated.
 */
export const vendorShopAddressResponseSchema = z.object({
  id: uuidSchema,
  status: vendorStatusSchema,
  shopName: z.string().nullable(),
  supportsPickup: z.boolean(),
  shopAddress: vendorShopAddressSchema.nullable(),
});

/**
 * PATCH /vendors/me/pickup-capability (S4-QR, locked decision #25). A single
 * field, the same "not a general shop profile editor" shape
 * `setVendorShopNameRequestSchema` already uses — `PlaceOrderUseCase` checks
 * this exact flag before accepting a `PICKUP` request for this vendor and
 * never silently downgrades an unsupported one to `DELIVERY`.
 */
export const setVendorPickupCapabilityRequestSchema = z
  .object({
    supportsPickup: z.boolean(),
  })
  .strict();

export const vendorPickupCapabilityResponseSchema = z.object({
  id: uuidSchema,
  status: vendorStatusSchema,
  supportsPickup: z.boolean(),
});

/**
 * POST /admin/kyc/vendors/:vendorId/activate (S3-3A, decision D-S3-04).
 * Empty body — activation names no new fact beyond "this KYC-approved
 * vendor may now trade," which the URL's own `vendorId` already states.
 */
export const activateVendorRequestSchema = z.object({}).strict();

export const activateVendorResponseSchema = z.object({
  id: uuidSchema,
  status: vendorStatusSchema,
});

export type VendorStatusDto = z.infer<typeof vendorStatusSchema>;
export type RegisterVendorRequest = z.infer<typeof registerVendorRequestSchema>;
export type RegisterVendorResponse = z.infer<typeof registerVendorResponseSchema>;
export type SetVendorShopNameRequest = z.infer<typeof setVendorShopNameRequestSchema>;
export type VendorShopProfileResponse = z.infer<typeof vendorShopProfileResponseSchema>;
export type VendorShopAddress = z.infer<typeof vendorShopAddressSchema>;
export type SetVendorShopAddressRequest = z.infer<typeof setVendorShopAddressRequestSchema>;
export type VendorShopAddressResponse = z.infer<typeof vendorShopAddressResponseSchema>;
export type SetVendorPickupCapabilityRequest = z.infer<
  typeof setVendorPickupCapabilityRequestSchema
>;
export type VendorPickupCapabilityResponse = z.infer<typeof vendorPickupCapabilityResponseSchema>;
export type ActivateVendorRequest = z.infer<typeof activateVendorRequestSchema>;
export type ActivateVendorResponse = z.infer<typeof activateVendorResponseSchema>;
