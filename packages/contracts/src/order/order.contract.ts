import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from '../common/primitives.js';
import { addressResponseSchema } from '../customer/address.contract.js';

/** Mirrors the domain `OrderStatus` value object (S3-3A, decision D-S3-06) — shared by `Order` and `SubOrder`. */
export const orderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PROCESSING',
  'CANCELLED',
]);

/**
 * POST /api/v1/orders. `paymentMethod` is narrowed to the literal `'ONLINE'`
 * — COD is not accepted in S3-3A (approved decision: "verified customer
 * address" is undefined and trust-score infrastructure is Stage 6, so COD
 * eligibility cannot be evaluated honestly).
 */
export const placeOrderRequestSchema = z
  .object({
    addressId: uuidSchema,
    paymentMethod: z.literal('ONLINE'),
  })
  .strict();

/**
 * The order's address snapshot — reuses `addressResponseSchema` (no
 * duplicate field definitions) narrowed to what a *snapshot* actually is:
 * no `id`/`isDefault`/timestamps, since those describe the live, editable
 * address book entry, not the immutable copy an order carries (SDD 6.3).
 */
export const orderAddressSnapshotSchema = addressResponseSchema.omit({
  id: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Resolved-or-not, never defaulted to ₹0 (decision D-S3-02). A missing
 * `rateBasisPoints`/`amount` when `resolved: false` is the honest shape —
 * the frontend renders "GST to be confirmed", never a fabricated zero.
 */
export const orderItemTaxSchema = z.discriminatedUnion('resolved', [
  z.object({ resolved: z.literal(true), rateBasisPoints: z.number().int(), amount: moneySchema }),
  z.object({ resolved: z.literal(false) }),
]);

/**
 * Deliberately excludes commission: an internal, vendor-payout figure
 * (SDD 10.3), never returned to the customer who placed the order. No
 * approved contract requires exposing it, so it stays server-side only —
 * the same "deliberately narrow" DTO-mapping discipline this codebase
 * already applies to KYC responses.
 */
export const orderItemResponseSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  variantId: uuidSchema,
  productName: z.string(),
  variantName: z.string(),
  vendorShopName: z.string(),
  unitOfMeasure: z.string(),
  quantity: z.number().int(),
  unitPrice: moneySchema,
  lineAmount: moneySchema,
  hsnCode: z.string().nullable(),
  tax: orderItemTaxSchema,
});

export const subOrderResponseSchema = z.object({
  id: uuidSchema,
  vendorShopName: z.string(),
  status: orderStatusSchema,
  totalAmount: moneySchema,
  items: z.array(orderItemResponseSchema),
});

export const orderResponseSchema = z.object({
  id: uuidSchema,
  status: orderStatusSchema,
  totalAmount: moneySchema,
  address: orderAddressSnapshotSchema,
  subOrders: z.array(subOrderResponseSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/**
 * S3-3A defined this ahead of its first caller, exactly for S3-3B: the
 * response of `POST /api/v1/orders/:id/payment/initiate`. Unchanged from
 * its original shape — starting a payment attempt tells the caller nothing
 * beyond "which order, still pending" until the attempt actually resolves
 * (`POST .../payment/confirm`, which returns the full `OrderResponse`).
 */
export const paymentInitiationResponseSchema = z.object({
  orderId: uuidSchema,
  status: z.literal('PAYMENT_PENDING'),
});

/**
 * POST /api/v1/orders/:id/payment/confirm (S3-3B). `testScenario` selects
 * which deterministic outcome the mock gateway returns — present only
 * because this milestone's adapter is a mock (see `PaymentGateway`'s own
 * doc comment). It is never an amount, a status, or anything else the
 * backend would otherwise have to trust from the client (SEC-02): the order
 * that gets confirmed, and the total it gets confirmed for, are always
 * whatever the database already has on file.
 */
export const confirmPaymentRequestSchema = z
  .object({
    testScenario: z.enum(['SUCCEEDED', 'FAILED']),
  })
  .strict();

export type OrderStatusDto = z.infer<typeof orderStatusSchema>;
export type PlaceOrderRequest = z.infer<typeof placeOrderRequestSchema>;
export type OrderAddressSnapshotDto = z.infer<typeof orderAddressSnapshotSchema>;
export type OrderItemTaxDto = z.infer<typeof orderItemTaxSchema>;
export type OrderItemResponse = z.infer<typeof orderItemResponseSchema>;
export type SubOrderResponse = z.infer<typeof subOrderResponseSchema>;
export type OrderResponse = z.infer<typeof orderResponseSchema>;
export type PaymentInitiationResponse = z.infer<typeof paymentInitiationResponseSchema>;
export type ConfirmPaymentRequest = z.infer<typeof confirmPaymentRequestSchema>;
