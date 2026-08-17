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
export type SetVendorPickupCapabilityRequest = z.infer<
  typeof setVendorPickupCapabilityRequestSchema
>;
export type VendorPickupCapabilityResponse = z.infer<typeof vendorPickupCapabilityResponseSchema>;
export type ActivateVendorRequest = z.infer<typeof activateVendorRequestSchema>;
export type ActivateVendorResponse = z.infer<typeof activateVendorResponseSchema>;
