import { z } from 'zod';
import {
  cursorPaginationSchema,
  isoDateTimeSchema,
  moneySchema,
  uuidSchema,
} from '../common/primitives.js';

/** Mirrors the domain `CampaignStatus` value object — SDD §14.2's exact lifecycle. */
export const preorderCampaignStatusSchema = z.enum([
  'DRAFT',
  'SCHEDULED',
  'OPEN',
  'SOLD_OUT',
  'CLOSED',
  'CANCELLED',
  'FULFILLING',
  'COMPLETED',
  'PARTIALLY_FULFILLED',
]);

/** Mirrors the domain `ReservationStatus` value object — the discovery report's own approved, isolated 5-state machine. */
export const preorderReservationStatusSchema = z.enum([
  'PENDING',
  'CONFIRMED',
  'EXPIRED',
  'PAYMENT_FAILED',
  'CANCELLED',
]);

/** Mirrors the domain `CampaignFulfilmentMode` value object — deliberately a distinct name from `order.contract.ts`'s own `fulfilmentModeSchema` (that one has no `BOTH`). */
export const preorderCampaignFulfilmentModeSchema = z.enum(['DELIVERY', 'PICKUP', 'BOTH']);

/**
 * POST /api/v1/vendor/preorder-campaigns. `variantId` names an existing,
 * vendor-owned product variant — eligibility is re-verified server-side
 * (`publicPrisma`), never trusted from the request. No price field: SDD
 * §14.1 names none, the variant's own price is resolved fresh at reservation
 * time (`CreateReservationUseCase`'s own doc comment).
 */
export const createCampaignRequestSchema = z
  .object({
    variantId: uuidSchema,
    opensAt: isoDateTimeSchema,
    orderCutoffAt: isoDateTimeSchema,
    fulfilmentWindowStart: isoDateTimeSchema,
    fulfilmentWindowEnd: isoDateTimeSchema,
    totalQuantity: z.number().int().positive(),
    advancePercent: z.number().int().min(0).max(100),
    maxPerCustomer: z.number().int().positive(),
    fulfilmentMode: preorderCampaignFulfilmentModeSchema,
  })
  .strict();

/**
 * PATCH /api/v1/vendor/preorder-campaigns/:campaignId. Every field optional —
 * the domain entity's own `update()` enforces the SDD §14.6 freeze rule
 * (quantity may only increase, cutoff/window immovable) once the first
 * reservation is confirmed; this contract imposes no rule of its own.
 */
export const updateCampaignRequestSchema = z
  .object({
    opensAt: isoDateTimeSchema.optional(),
    orderCutoffAt: isoDateTimeSchema.optional(),
    fulfilmentWindowStart: isoDateTimeSchema.optional(),
    fulfilmentWindowEnd: isoDateTimeSchema.optional(),
    totalQuantity: z.number().int().positive().optional(),
    advancePercent: z.number().int().min(0).max(100).optional(),
    maxPerCustomer: z.number().int().positive().optional(),
    fulfilmentMode: preorderCampaignFulfilmentModeSchema.optional(),
  })
  .strict();

/** POST /api/v1/vendor/preorder-campaigns/:campaignId/cancel. `reason` is required — the same audit-trail discipline every other vendor cancel action in this codebase already applies. */
export const cancelCampaignRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

/** GET /api/v1/vendor/preorder-campaigns query — the platform's existing cursor convention (SDD 9.2), nothing else. */
export const vendorCampaignListQuerySchema = cursorPaginationSchema.strict();

/** GET /api/v1/preorders query — same cursor convention, public surface. */
export const publicCampaignListQuerySchema = cursorPaginationSchema.strict();

/**
 * The vendor's own view of their campaign — every field, including
 * `remainingQuantity` and `firstReservationConfirmedAt` (the freeze marker).
 */
export const vendorCampaignResponseSchema = z.object({
  id: uuidSchema,
  variantId: uuidSchema,
  status: preorderCampaignStatusSchema,
  opensAt: isoDateTimeSchema,
  orderCutoffAt: isoDateTimeSchema,
  fulfilmentWindowStart: isoDateTimeSchema,
  fulfilmentWindowEnd: isoDateTimeSchema,
  totalQuantity: z.number().int(),
  remainingQuantity: z.number().int(),
  advancePercent: z.number().int(),
  maxPerCustomer: z.number().int(),
  fulfilmentMode: preorderCampaignFulfilmentModeSchema,
  firstReservationConfirmedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/**
 * The public/customer view of a campaign (`GET /api/v1/preorders`,
 * `GET /api/v1/preorders/:campaignId`) — never `DRAFT` (RLS's own
 * `preorder_campaigns_public_read` policy), and deliberately omits
 * `firstReservationConfirmedAt`: an internal freeze marker, not something a
 * shopper needs told back to them.
 */
export const publicCampaignResponseSchema = z.object({
  id: uuidSchema,
  vendorId: uuidSchema,
  variantId: uuidSchema,
  status: preorderCampaignStatusSchema,
  opensAt: isoDateTimeSchema,
  orderCutoffAt: isoDateTimeSchema,
  fulfilmentWindowStart: isoDateTimeSchema,
  fulfilmentWindowEnd: isoDateTimeSchema,
  totalQuantity: z.number().int(),
  remainingQuantity: z.number().int(),
  advancePercent: z.number().int(),
  maxPerCustomer: z.number().int(),
  fulfilmentMode: preorderCampaignFulfilmentModeSchema,
});

/**
 * GET /api/v1/vendor/preorder-campaigns/:campaignId/demand-summary. Real
 * aggregates read fresh off `preorder_reservations` at request time — never
 * faked or derived client-side (the implementation brief's own explicit
 * instruction).
 */
export const campaignDemandSummaryResponseSchema = z.object({
  reservationCount: z.number().int(),
  confirmedCount: z.number().int(),
  totalUnitsCommitted: z.number().int(),
});

/**
 * POST /api/v1/preorder-reservations. `campaignId` names the campaign to
 * reserve against; `quantity` is the only other input the server trusts from
 * the client — price, advance/balance split, and eligibility are all
 * resolved server-side (SEC-02), the same discipline `placeOrderRequestSchema`
 * already applies.
 */
/** Mirrors `order.contract.ts`'s own `fulfilmentModeSchema` — never `BOTH`, which only ever describes what a campaign permits. */
export const reservationFulfilmentModeSchema = z.enum(['DELIVERY', 'PICKUP']);

export const createReservationRequestSchema = z
  .object({
    campaignId: uuidSchema,
    quantity: z.number().int().positive(),
    fulfilmentMode: reservationFulfilmentModeSchema,
    /** Ownership re-verified server-side (SEC-02) — never trusted from the request beyond naming which of the caller's own addresses to use. */
    addressId: uuidSchema,
  })
  .strict();

/**
 * POST .../advance-payment/confirm and .../balance-payment/confirm.
 * `testScenario` selects which deterministic outcome the mock gateway
 * returns — mirrors `confirmPaymentRequestSchema` exactly, including its own
 * reasoning: this exists only because the adapter is a mock.
 */
export const confirmReservationPaymentRequestSchema = z
  .object({
    testScenario: z.enum(['SUCCEEDED', 'FAILED']),
  })
  .strict();

/** Mirrors `paymentInitiationResponseSchema` (order.contract.ts) — starting a payment attempt tells the caller nothing beyond "which reservation, still pending" until confirmation. */
export const reservationPaymentInitiationResponseSchema = z.object({
  reservationId: uuidSchema,
  status: z.literal('PAYMENT_PENDING'),
});

/**
 * The customer's own view of their reservation. `unitPrice`/`advanceAmount`/
 * `balanceAmount` are the immutable snapshot taken at creation time (SDD
 * §14.6's price-freeze, automatically satisfied by construction — see
 * `CreateReservationUseCase`'s own doc comment).
 */
export const reservationResponseSchema = z.object({
  id: uuidSchema,
  campaignId: uuidSchema,
  quantity: z.number().int(),
  fulfilmentMode: reservationFulfilmentModeSchema,
  addressId: uuidSchema,
  status: preorderReservationStatusSchema,
  unitPrice: moneySchema,
  advanceAmount: moneySchema,
  balanceAmount: moneySchema,
  expiresAt: isoDateTimeSchema,
  confirmedAt: isoDateTimeSchema.nullable(),
  balancePaidAt: isoDateTimeSchema.nullable(),
  convertedOrderId: uuidSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type PreorderCampaignStatusDto = z.infer<typeof preorderCampaignStatusSchema>;
export type PreorderReservationStatusDto = z.infer<typeof preorderReservationStatusSchema>;
export type PreorderCampaignFulfilmentModeDto = z.infer<
  typeof preorderCampaignFulfilmentModeSchema
>;
export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;
export type UpdateCampaignRequest = z.infer<typeof updateCampaignRequestSchema>;
export type CancelCampaignRequest = z.infer<typeof cancelCampaignRequestSchema>;
export type VendorCampaignListQuery = z.infer<typeof vendorCampaignListQuerySchema>;
export type PublicCampaignListQuery = z.infer<typeof publicCampaignListQuerySchema>;
export type VendorCampaignResponse = z.infer<typeof vendorCampaignResponseSchema>;
export type PublicCampaignResponse = z.infer<typeof publicCampaignResponseSchema>;
export type CampaignDemandSummaryResponse = z.infer<typeof campaignDemandSummaryResponseSchema>;
export type ReservationFulfilmentModeDto = z.infer<typeof reservationFulfilmentModeSchema>;
export type CreateReservationRequest = z.infer<typeof createReservationRequestSchema>;
export type ConfirmReservationPaymentRequest = z.infer<
  typeof confirmReservationPaymentRequestSchema
>;
export type ReservationPaymentInitiationResponse = z.infer<
  typeof reservationPaymentInitiationResponseSchema
>;
export type ReservationResponse = z.infer<typeof reservationResponseSchema>;
