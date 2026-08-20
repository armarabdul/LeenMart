import { z } from 'zod';
import { isoDateTimeSchema, moneySchema, uuidSchema } from '../common/primitives.js';
import { addressResponseSchema } from '../customer/address.contract.js';

/**
 * Mirrors the domain `OrderStatus` value object (S3-3A, decision D-S3-06;
 * widened S3-6, S4-QR) — shared by `Order` and `SubOrder`. `SHIPPED`/
 * `DELIVERED` are `DELIVERY`-mode-only, vendor-initiated (S3-6);
 * `READY_FOR_PICKUP`/`COMPLETED` are `PICKUP`-mode-only (S4-QR) —
 * `COMPLETED` is reachable only through QR/token redemption, never a direct
 * request (locked decision #10).
 */
export const orderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'READY_FOR_PICKUP',
  'COMPLETED',
  'CANCELLED',
]);

/** Mirrors the domain `FulfilmentMode` value object (S4-QR, locked decision #4) — chosen once at checkout, carried on `SubOrder`, never `Order`. */
export const fulfilmentModeSchema = z.enum(['DELIVERY', 'PICKUP']);

/**
 * The fulfilment window chosen from one vendor (S4-SLOTS).
 *
 * Only the date and the start minute: the window's end and its capacity are
 * read from the vendor's own template server-side, so a client cannot widen a
 * window or inflate a capacity by sending different numbers.
 */
export const slotSelectionSchema = z
  .object({
    vendorId: uuidSchema,
    /** `YYYY-MM-DD`, IST. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a YYYY-MM-DD date'),
    startMinute: z.number().int().min(0).max(1439),
  })
  .strict();

/**
 * POST /api/v1/orders. `paymentMethod` is narrowed to the literal `'ONLINE'`
 * — COD is not accepted in S3-3A (approved decision: "verified customer
 * address" is undefined and trust-score infrastructure is Stage 6, so COD
 * eligibility cannot be evaluated honestly).
 *
 * `pickupVendorIds` (S4-QR, locked decision #24): the vendors, among those
 * actually present in the cart, the customer wants `PICKUP` from — every
 * other vendor defaults to `DELIVERY`. Omitted or empty means "deliver
 * everything," so existing checkout calls need no change.
 */
export const placeOrderRequestSchema = z
  .object({
    addressId: uuidSchema,
    paymentMethod: z.literal('ONLINE'),
    pickupVendorIds: z.array(uuidSchema).optional(),
    /**
     * S4-SLOTS. One entry per vendor that offers windows, `PICKUP` and
     * `DELIVERY` alike (locked decision S4). A vendor that offers windows and
     * appears here with none fails the whole placement rather than being
     * assigned one; a vendor that offers none and appears here anyway is
     * refused rather than silently ignored.
     */
    slotSelections: z.array(slotSelectionSchema).max(50).optional(),
  })
  .strict();

/**
 * GET /api/v1/orders/slot-availability query (S4-SLOTS).
 *
 * `days` is bounded rather than open, per PERF-08's "mandatory limit with a
 * hard ceiling": the availability view expands templates across dates, so an
 * unbounded horizon would be an unbounded response.
 */
export const slotAvailabilityQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(14).optional(),
  })
  .strict();

/** One dated window a customer can choose, with how much room is left. */
export const availableSlotSchema = z.object({
  /** `YYYY-MM-DD`, IST. */
  date: z.string(),
  startMinute: z.number().int(),
  endMinute: z.number().int(),
  capacity: z.number().int(),
  booked: z.number().int(),
  /**
   * `capacity - booked`, never below zero. **A snapshot, not a promise**: a
   * window shown with room may be full by the time the order is placed, which
   * is why placement re-resolves and consumes atomically rather than trusting
   * this number.
   */
  remaining: z.number().int(),
});

/**
 * GET /api/v1/orders/slot-availability (S4-SLOTS).
 *
 * Scoped to the caller's own cart — the request names no vendor, so there is
 * no id to substitute and no way to enumerate another shop's operating
 * pattern. An empty `slots` array means that vendor offers no windows, and so
 * needs none chosen; it never means the vendor is unavailable.
 */
export const slotAvailabilityResponseSchema = z.object({
  vendors: z.array(
    z.object({
      vendorId: uuidSchema,
      shopName: z.string().nullable(),
      slots: z.array(availableSlotSchema),
    }),
  ),
});

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

/**
 * Where the customer collects, as it stood when the order was placed
 * (S4-ADDR). Carries no `recipientName`/`phone`/`label` — this is the shop's
 * premises, not a delivery address.
 */
export const pickupLocationSnapshotSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
});

export const subOrderResponseSchema = z.object({
  id: uuidSchema,
  vendorShopName: z.string(),
  status: orderStatusSchema,
  fulfilmentMode: fulfilmentModeSchema,
  /**
   * S4-ADDR. Non-null only on a `PICKUP` sub-order placed once its vendor had
   * set a shop address — `null` for every DELIVERY sub-order and for any
   * pickup order placed before this milestone. Read from the sub-order's own
   * snapshot columns, never re-resolved from the vendor profile, so a vendor
   * who later moves premises cannot change where an existing order says to
   * collect from.
   */
  pickupLocation: pickupLocationSnapshotSchema.nullable(),
  /**
   * S4-SLOTS. The window this sub-order was booked into, read from the
   * sub-order's own snapshot columns and never re-resolved from the vendor's
   * templates — so a vendor who later re-times or withdraws a window cannot
   * change when an existing order says to arrive. `null` where the vendor
   * offered no windows, and for every order placed before this milestone.
   */
  slot: z
    .object({
      date: z.string(),
      startMinute: z.number().int(),
      endMinute: z.number().int(),
    })
    .nullable(),
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
  fulfilmentMode: fulfilmentModeSchema,
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
  fulfilmentMode: fulfilmentModeSchema,
  totalAmount: moneySchema,
  address: orderAddressSnapshotSchema,
  items: z.array(orderItemResponseSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/**
 * GET .../pickup-token (S4-QR, customer-facing): the current QR credential
 * for one `PICKUP` sub-order. `token` is the opaque compact-JWS string the
 * QR code encodes; `expiresAt` lets the customer PWA schedule its own
 * re-poll ahead of expiry rather than guessing the server's TTL. `manualCode`
 * (S4-QR-FALLBACK) is the 4-digit scanner-broken fallback, rotated in
 * lockstep with `token` — shown to the customer to read aloud if the
 * vendor's scanner is down.
 */
export const pickupTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: isoDateTimeSchema,
  manualCode: z.string().length(4),
});

/**
 * POST /vendor/orders/pickup/redeem (S4-QR): the vendor scans a customer's
 * QR code and submits its raw payload here. No sub-order id in the request —
 * the token itself, once verified, is what names the sub-order (locked
 * decision #10: no direct public endpoint may mark a pickup complete).
 *
 * `queuedOffline` (S4-QR-FALLBACK, optional, defaults to unset/false): set by
 * the vendor portal only when resubmitting an attempt that was verified
 * locally while the device had no connectivity — see
 * `RedeemPickupTokenUseCase`'s own doc comment for what this changes
 * (an audit record on conflict, never the response itself).
 */
export const redeemPickupTokenRequestSchema = z
  .object({
    token: z.string().min(1),
    queuedOffline: z.boolean().optional(),
  })
  .strict();

/**
 * POST /vendor/orders/:id/pickup/manual-complete (S4-QR-FALLBACK): the
 * scanner-broken fallback — the vendor reads a 4-digit code off the
 * customer's screen instead of scanning the QR.
 */
export const completePickupManuallyRequestSchema = z
  .object({
    code: z.string().length(4),
  })
  .strict();

export type OrderStatusDto = z.infer<typeof orderStatusSchema>;
export type FulfilmentModeDto = z.infer<typeof fulfilmentModeSchema>;
export type PlaceOrderRequest = z.infer<typeof placeOrderRequestSchema>;
export type SlotSelectionDto = z.infer<typeof slotSelectionSchema>;
export type SlotAvailabilityQuery = z.infer<typeof slotAvailabilityQuerySchema>;
export type AvailableSlotDto = z.infer<typeof availableSlotSchema>;
export type SlotAvailabilityResponse = z.infer<typeof slotAvailabilityResponseSchema>;
export type OrderAddressSnapshotDto = z.infer<typeof orderAddressSnapshotSchema>;
export type OrderItemTaxDto = z.infer<typeof orderItemTaxSchema>;
export type OrderItemResponse = z.infer<typeof orderItemResponseSchema>;
export type PickupLocationSnapshotDto = z.infer<typeof pickupLocationSnapshotSchema>;
export type SubOrderResponse = z.infer<typeof subOrderResponseSchema>;
export type OrderResponse = z.infer<typeof orderResponseSchema>;
export type OrderSummaryResponse = z.infer<typeof orderSummaryResponseSchema>;
export type VendorSubOrderSummaryResponse = z.infer<typeof vendorSubOrderSummaryResponseSchema>;
export type VendorSubOrderResponse = z.infer<typeof vendorSubOrderResponseSchema>;
export type PaymentInitiationResponse = z.infer<typeof paymentInitiationResponseSchema>;
export type ConfirmPaymentRequest = z.infer<typeof confirmPaymentRequestSchema>;
export type PickupTokenResponse = z.infer<typeof pickupTokenResponseSchema>;
export type RedeemPickupTokenRequest = z.infer<typeof redeemPickupTokenRequestSchema>;
export type CompletePickupManuallyRequest = z.infer<typeof completePickupManuallyRequestSchema>;
