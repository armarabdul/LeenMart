import { z } from 'zod';
import { pincodeSchema, uuidSchema } from '../common/primitives.js';

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
 * PUT /vendors/me/serviceable-pincodes (S4-SERV, locked decision D1 —
 * vendor-declared serviceability).
 *
 * A whole-set replace, the same reasoning `setVendorShopAddressRequestSchema`
 * gives: the set is only meaningful as a whole, and a partial patch would need
 * add/remove semantics this milestone has no requirement for.
 *
 * Duplicates are accepted on the wire and collapsed server-side rather than
 * rejected — `["560001","560001"]` states a coherent intention, and the
 * table's composite primary key makes the stored result identical either way.
 *
 * An **empty array is legal and meaningful**: it clears the vendor's set,
 * which under locked decision D7 returns them to serving everywhere.
 */
export const setVendorServiceablePincodesRequestSchema = z
  .object({
    pincodes: z.array(pincodeSchema).max(2000),
  })
  .strict();

/** GET/PUT /vendors/me/serviceable-pincodes. Always sorted, always de-duplicated. */
export const vendorServiceablePincodesResponseSchema = z.object({
  id: uuidSchema,
  /**
   * S4-SERV / D7. `false` means this vendor has declared nothing and therefore
   * currently delivers everywhere — surfaced explicitly so the vendor portal
   * can say so rather than showing an empty list that looks like "nowhere".
   */
  configured: z.boolean(),
  pincodes: z.array(pincodeSchema),
});

/**
 * One trading interval (S4-HOURS). Minutes since local midnight, IST — an
 * integer carries no timezone, which is why the wire format uses one rather
 * than a timestamp that a client could reinterpret.
 *
 * `closeMinute` may reach 1440 (midnight); `openMinute` may not, since a
 * zero-length interval is not an opening. No overnight spans: no authoritative
 * requirement asks for one, so `open < close` is enforced rather than wrapped.
 */
export const businessHourIntervalSchema = z
  .object({
    /** 0 = Sunday … 6 = Saturday. */
    weekday: z.number().int().min(0).max(6),
    openMinute: z.number().int().min(0).max(1439),
    closeMinute: z.number().int().min(1).max(1440),
  })
  .strict()
  .refine((interval) => interval.openMinute < interval.closeMinute, {
    message: 'openMinute must be before closeMinute',
    path: ['closeMinute'],
  });

/**
 * A day the vendor does not trade (S4-HOURS, FR-27's "holidays"). Exactly one
 * of the two is supplied: `weekday` for a recurring weekly holiday, `date` for
 * a one-off dated closure.
 *
 * Closures only — no "open override" exists, because no authoritative source
 * distinguishes one.
 */
export const businessHourClosureSchema = z
  .object({
    weekday: z.number().int().min(0).max(6).nullable(),
    /** `YYYY-MM-DD`, interpreted as an IST calendar day. */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD date')
      .nullable(),
  })
  .strict()
  .refine((closure) => (closure.weekday === null) !== (closure.date === null), {
    message: 'Provide exactly one of weekday (recurring holiday) or date (one-off closure)',
    path: ['weekday'],
  });

/**
 * PUT /vendors/me/business-hours (S4-HOURS). A whole-schedule replace, the
 * same reasoning `setVendorShopAddressRequestSchema` gives: the schedule is
 * only meaningful as a whole, and a partial patch would need add/remove
 * semantics nothing here requires.
 *
 * An **empty schedule is legal and meaningful**: it clears the configuration,
 * which under locked decision H4-A returns the vendor to accepting delivery at
 * any time.
 */
export const setVendorBusinessHoursRequestSchema = z
  .object({
    intervals: z.array(businessHourIntervalSchema).max(100),
    closures: z.array(businessHourClosureSchema).max(365),
  })
  .strict();

/** GET/PUT /vendors/me/business-hours. */
export const vendorBusinessHoursResponseSchema = z.object({
  id: uuidSchema,
  /**
   * S4-HOURS / H4-A. `false` means the vendor has declared no intervals and
   * therefore currently accepts delivery at any time — surfaced explicitly so
   * the portal can say so rather than showing an empty schedule that reads as
   * "never open".
   */
  configured: z.boolean(),
  intervals: z.array(businessHourIntervalSchema),
  closures: z.array(businessHourClosureSchema),
});

/**
 * One recurring fulfilment window a vendor offers (S4-SLOTS, locked decisions
 * S1 and S3).
 *
 * Minutes since IST midnight, for the same reason `businessHourIntervalSchema`
 * uses them: an integer carries no timezone, and a client cannot reinterpret
 * it. `endMinute` may reach 1440 (midnight); `startMinute` may not, since a
 * zero-length window admits nobody. No overnight windows.
 *
 * `capacity` is the vendor-declared limit on how many sub-orders fit in the
 * window (S1). One sub-order consumes exactly one unit (S2) — never items,
 * weight or volume. The minimum is 1: zero would be indistinguishable from
 * "not offered", which the absence of the window already expresses.
 */
export const deliverySlotSchema = z
  .object({
    /** 0 = Sunday … 6 = Saturday. */
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    capacity: z.number().int().min(1).max(10_000),
  })
  .strict()
  .refine((slot) => slot.startMinute < slot.endMinute, {
    message: 'startMinute must be before endMinute',
    path: ['endMinute'],
  });

/** How full one dated window already is, for the vendor's own view. */
export const slotBookingSchema = z
  .object({
    /** `YYYY-MM-DD`, IST. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD date'),
    startMinute: z.number().int().min(0).max(1439),
    booked: z.number().int().min(0),
  })
  .strict();

/**
 * PUT /vendors/me/delivery-slots (S4-SLOTS). A whole-offer replace, the same
 * reasoning `setVendorBusinessHoursRequestSchema` gives.
 *
 * An **empty offer is legal and meaningful**: it clears the configuration,
 * returning the vendor to taking orders without a slot — the
 * backward-compatible default `serviceable_pincodes` (D7) and `business_hours`
 * (H4-A) each already established.
 *
 * Replacing the offer never rewrites bookings already taken: `slot_capacity`
 * rows carry their own snapshotted capacity.
 */
export const setVendorDeliverySlotsRequestSchema = z
  .object({
    slots: z.array(deliverySlotSchema).max(100),
  })
  .strict();

/** GET/PUT /vendors/me/delivery-slots. */
export const vendorDeliverySlotsResponseSchema = z.object({
  id: uuidSchema,
  /**
   * S4-SLOTS. `false` means the vendor offers no windows and therefore takes
   * orders without one — surfaced explicitly so the portal can say so rather
   * than showing an empty list that reads as "never available".
   */
  configured: z.boolean(),
  slots: z.array(deliverySlotSchema),
  /** Bookings already taken across the next few days, so capacity is not set blind. */
  bookings: z.array(slotBookingSchema),
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

/**
 * POST /admin/vendors/:vendorId/suspend (SDD §15.1/§16.1, Phase L.4).
 * `reason` is required — §16.1: "no automatic suspension... every suspension
 * requires a human decision... recorded with a reason" — and bounded the same
 * way `decideVendorKycRequestSchema`'s rejection `note` is (free text, up to
 * 1000 characters). It is never persisted on `VendorProfile`, which has no
 * column for one; it travels straight to the audit record.
 */
export const suspendVendorRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

/**
 * POST /admin/vendors/:vendorId/reinstate (SDD §15.1, Phase L.4). `reason` is
 * optional — §16.1 requires one for suspending a vendor, not for reinstating
 * one — but bounded identically to `suspendVendorRequestSchema`'s when
 * supplied.
 */
export const reinstateVendorRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();

/**
 * Both suspend and reinstate report only the vendor's identity and resulting
 * lifecycle state — the same minimal shape `activateVendorResponseSchema`
 * already uses for the same class of admin lifecycle transition, reused
 * rather than duplicated.
 */
export const vendorStatusChangeResponseSchema = activateVendorResponseSchema;

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
export type SetVendorServiceablePincodesRequest = z.infer<
  typeof setVendorServiceablePincodesRequestSchema
>;
export type VendorServiceablePincodesResponse = z.infer<
  typeof vendorServiceablePincodesResponseSchema
>;
export type BusinessHourInterval = z.infer<typeof businessHourIntervalSchema>;
export type BusinessHourClosureDto = z.infer<typeof businessHourClosureSchema>;
export type SetVendorBusinessHoursRequest = z.infer<typeof setVendorBusinessHoursRequestSchema>;
export type VendorBusinessHoursResponse = z.infer<typeof vendorBusinessHoursResponseSchema>;
export type DeliverySlotDto = z.infer<typeof deliverySlotSchema>;
export type SlotBookingDto = z.infer<typeof slotBookingSchema>;
export type SetVendorDeliverySlotsRequest = z.infer<typeof setVendorDeliverySlotsRequestSchema>;
export type VendorDeliverySlotsResponse = z.infer<typeof vendorDeliverySlotsResponseSchema>;
export type ActivateVendorRequest = z.infer<typeof activateVendorRequestSchema>;
export type ActivateVendorResponse = z.infer<typeof activateVendorResponseSchema>;
export type SuspendVendorRequest = z.infer<typeof suspendVendorRequestSchema>;
export type ReinstateVendorRequest = z.infer<typeof reinstateVendorRequestSchema>;
export type VendorStatusChangeResponse = z.infer<typeof vendorStatusChangeResponseSchema>;
