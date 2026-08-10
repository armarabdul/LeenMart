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

export type VendorStatusDto = z.infer<typeof vendorStatusSchema>;
export type RegisterVendorRequest = z.infer<typeof registerVendorRequestSchema>;
export type RegisterVendorResponse = z.infer<typeof registerVendorResponseSchema>;
