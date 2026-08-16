import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from '../common/primitives.js';
import { addressResponseSchema } from '../customer/address.contract.js';

/**
 * Mirrors the domain `OrderStatus` value object (S3-3A, decision D-S3-06;
 * widened S3-6, locked decision #2) — shared by `Order` and `SubOrder`.
 * `SHIPPED`/`DELIVERED` are delivery-mode-only, vendor-initiated, S3-6.
 */
export const orderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
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
 * GET /api/v1/orders (S3-4, "My Orders"). Deliberately narrower than
 * `orderResponseSchema` — no address, no sub-orders, no items — the same
 * "enough to list, nothing more" discipline the admin KYC queue row already
 * applies (`adminKycQueueItemSchema`). A list row exists to let the customer
 * pick which order to open next; `GET /orders/:id` is still the only place
 * the full snapshot is ever returned.
 */
export const orderSummaryResponseSchema = z.object({
  id: uuidSchema,
  status: orderStatusSchema,
  totalAmount: moneySchema,
  createdAt: isoDateTimeSchema,
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

/**
 * "Vendor Orders" (S3-5, `VIEW_VENDOR_ORDERS`). List row — deliberately as
 * narrow as `orderSummaryResponseSchema` (S3-4), the same "enough to list,
 * nothing more" discipline.
 */
export const vendorSubOrderSummaryResponseSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  status: orderStatusSchema,
  totalAmount: moneySchema,
  createdAt: isoDateTimeSchema,
});

/**
 * Vendor-facing sub-order detail (S3-5). Reuses `orderItemResponseSchema`
 * and `orderAddressSnapshotSchema` as-is rather than duplicating them —
 * `orderItemResponseSchema` already excludes commission (see its own
 * comment), and the address snapshot already carries only the delivery
 * contact (`recipientName`/`phone`), never the customer's account identity —
 * both already satisfy locked decision #6 with no changes.
 *
 * No other vendor's items and no other vendor's sub-orders ever reach this
 * shape: it describes exactly one `SubOrder`, never the parent multi-vendor
 * `Order`.
 */
export const vendorSubOrderResponseSchema = z.object({
  id: uuidSchema,
  orderId: uuidSchema,
  status: orderStatusSchema,
  totalAmount: moneySchema,
  address: orderAddressSnapshotSchema,
  items: z.array(orderItemResponseSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type OrderStatusDto = z.infer<typeof orderStatusSchema>;
export type PlaceOrderRequest = z.infer<typeof placeOrderRequestSchema>;
export type OrderAddressSnapshotDto = z.infer<typeof orderAddressSnapshotSchema>;
export type OrderItemTaxDto = z.infer<typeof orderItemTaxSchema>;
export type OrderItemResponse = z.infer<typeof orderItemResponseSchema>;
export type SubOrderResponse = z.infer<typeof subOrderResponseSchema>;
export type OrderResponse = z.infer<typeof orderResponseSchema>;
export type OrderSummaryResponse = z.infer<typeof orderSummaryResponseSchema>;
export type VendorSubOrderSummaryResponse = z.infer<typeof vendorSubOrderSummaryResponseSchema>;
export type VendorSubOrderResponse = z.infer<typeof vendorSubOrderResponseSchema>;
export type PaymentInitiationResponse = z.infer<typeof paymentInitiationResponseSchema>;
export type ConfirmPaymentRequest = z.infer<typeof confirmPaymentRequestSchema>;
