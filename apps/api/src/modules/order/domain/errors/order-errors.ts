import {
  type AppErrorOptions,
  ConflictError,
  DomainRuleError,
  NotFoundError,
} from '@leen-mart/domain-kit';
import type { FulfilmentModeName } from '../value-objects/fulfilment-mode.value-object.js';
import type { OrderStatusName } from '../value-objects/order-status.value-object.js';
import type { PaymentAttemptStatusName } from '../value-objects/payment-attempt-status.value-object.js';

/**
 * A move `Order`/`SubOrder`'s shared transition table does not draw — valid
 * input, disallowed outcome (SDD 17.1: `DomainRuleError`, HTTP 422). One
 * error for every illegal edge, mirroring `InvalidVendorStatusTransitionError`'s
 * own reasoning.
 */
export class InvalidOrderStatusTransitionError extends DomainRuleError {
  constructor(from: OrderStatusName, to: OrderStatusName, options: AppErrorOptions = {}) {
    super('ORDER_INVALID_STATUS_TRANSITION', `An order cannot move from ${from} to ${to}.`, {
      ...options,
      details: options.details ?? [
        { field: 'status', issue: `${from} → ${to} is not a permitted transition` },
      ],
    });
  }
}

/** Ownership-scoped lookup miss — never distinguishes "no such order" from "not yours" (SEC-06). */
export class OrderNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('The requested order was not found.', { ...options, code: 'ORDER_NOT_FOUND' });
  }
}

/** Approved decision: "customer cancellation is permitted only while the order has not reached PROCESSING." */
export class OrderCancellationNotAllowedError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'ORDER_CANCELLATION_NOT_ALLOWED',
      'This order can no longer be cancelled — at least one vendor has started processing it.',
      options,
    );
  }
}

/** PlaceOrderUseCase's own precondition: nothing to check out. */
export class EmptyCartError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super('ORDER_EMPTY_CART', 'Your cart is empty — add an item before checking out.', options);
  }
}

/** Mirrors `ProductNotEligibleForCartError` at checkout time: a `findById` under `publicPrisma` came back null. */
export class ProductNotEligibleForOrderError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'ORDER_PRODUCT_NOT_ELIGIBLE',
      'One or more items in your cart are no longer available for purchase.',
      options,
    );
  }
}

/** Mirrors `InsufficientInventoryError` at checkout time — the atomic decrement affected zero rows. */
export class InsufficientStockError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'ORDER_INSUFFICIENT_STOCK',
      'One or more items in your cart no longer have enough stock.',
      options,
    );
  }
}

/**
 * A vendor in the cart cannot be sold from right now — not `ACTIVE`
 * (S3-3A decision D-S3-04), or has not set a `shopName` yet (D-S3-03, SDD
 * 6.3's required order-item snapshot field). Deliberately one error for
 * both reasons: the customer-facing consequence is identical ("this seller
 * cannot be checked out from"), and `details` carries which.
 */
export class VendorNotEligibleForOrderError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'ORDER_VENDOR_NOT_ELIGIBLE',
      'One or more sellers in your cart cannot be checked out from right now.',
      options,
    );
  }
}

/** Ownership-scoped address lookup miss (never distinguishes "no such address" from "not yours"). */
export class OrderAddressNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('The selected address was not found.', {
      ...options,
      code: 'ORDER_ADDRESS_NOT_FOUND',
    });
  }
}

/** S3-3B: `InitiatePaymentUseCase`'s own precondition — only a `PENDING_PAYMENT` order can start a payment attempt. */
export class OrderNotPendingPaymentError extends DomainRuleError {
  constructor(status: OrderStatusName, options: AppErrorOptions = {}) {
    super('ORDER_NOT_PENDING_PAYMENT', 'This order is not awaiting payment.', {
      ...options,
      details: options.details ?? [
        { field: 'status', issue: `Order is ${status}, not PENDING_PAYMENT` },
      ],
    });
  }
}

/**
 * `InitiatePaymentUseCase`'s own precondition: an order may have at most one
 * `INITIATED` attempt at a time (`uq_payment_attempts_order_initiated`).
 * Mirrors `AddCartItemUseCase`'s own "read-then-write, the unique index is
 * the actual arbiter" reasoning for the ordinary (non-racing) path — a
 * second, concurrent `initiate` call is out of scope for this check to
 * gracefully handle, the same acceptance that codebase precedent already
 * makes for `uq_cart_items_cart_variant`.
 */
export class PaymentAlreadyInitiatedError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('A payment is already awaiting confirmation for this order.', {
      ...options,
      code: 'ORDER_PAYMENT_ALREADY_INITIATED',
    });
  }
}

/** `PaymentAttempt`'s own transition table refuses the edge — mirrors `InvalidOrderStatusTransitionError`'s own reasoning. */
export class InvalidPaymentAttemptTransitionError extends DomainRuleError {
  constructor(
    from: PaymentAttemptStatusName,
    to: PaymentAttemptStatusName,
    options: AppErrorOptions = {},
  ) {
    super(
      'PAYMENT_ATTEMPT_INVALID_TRANSITION',
      `A payment attempt cannot move from ${from} to ${to}.`,
      {
        ...options,
        details: options.details ?? [
          { field: 'status', issue: `${from} → ${to} is not a permitted transition` },
        ],
      },
    );
  }
}

/** Ownership-scoped lookup miss — `ConfirmPaymentUseCase` needs an `INITIATED` attempt for the order and finds none (never initiated, or already resolved). */
export class PaymentAttemptNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('No payment is currently awaiting confirmation for this order.', {
      ...options,
      code: 'PAYMENT_ATTEMPT_NOT_FOUND',
    });
  }
}

/**
 * The mock gateway reported failure for this attempt (S3-3B). The order
 * itself is untouched — it stays `PENDING_PAYMENT` so the customer can
 * initiate a fresh attempt (SDD 10.4's own "unresolved payments" precedent,
 * narrowed to a synchronous decision instead of a reconciliation job).
 */
export class PaymentFailedError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super('PAYMENT_FAILED', 'The payment could not be completed. Please try again.', options);
  }
}

/**
 * Ownership-scoped lookup miss for the vendor-facing surface (S3-5) — never
 * distinguishes "no such sub-order" from "not yours" (SEC-06), the same
 * discipline `OrderNotFoundError` already applies to the customer surface.
 */
export class SubOrderNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('The requested order was not found.', { ...options, code: 'SUB_ORDER_NOT_FOUND' });
  }
}

/**
 * S3-5's own concurrency guard: `SubOrder.version` no longer matched what the
 * repository's conditional `UPDATE ... WHERE version = :expected` expected,
 * meaning another writer — a customer cancelling, or the vendor's own retried
 * request — already moved this row. A 409, not a 422: the request was valid
 * when sent, and simply lost a race it could not have observed.
 */
export class SubOrderConcurrentlyModifiedError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This order was just updated elsewhere. Please refresh and try again.', {
      ...options,
      code: 'SUB_ORDER_CONCURRENTLY_MODIFIED',
    });
  }
}

/**
 * S3-5's vendor-order ACTIVE gate: `VendorProfile.status !== 'ACTIVE'`.
 * Mirrors `VendorNotEligibleForOrderError`'s reasoning but scoped to the
 * *requesting* vendor acting on their own orders, not a vendor being sold
 * from — a distinct check with no existing caller before this milestone (see
 * S3-5 discovery §A.3: no route previously gated on the acting vendor's own
 * status).
 */
export class VendorNotActiveForOrdersError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'VENDOR_NOT_ACTIVE',
      'Your vendor account is not active yet, so you cannot manage orders.',
      options,
    );
  }
}

/**
 * S4-QR: a fulfilment transition was attempted on a `SubOrder` whose
 * `fulfilmentMode` does not match — `ship()`/`deliver()` called on a
 * `PICKUP` sub-order, or `markReadyForPickup()`/`completePickup()` called on
 * a `DELIVERY` one. A distinct error from `InvalidOrderStatusTransitionError`
 * on purpose: the *status* transition would otherwise be perfectly legal
 * (e.g. `PROCESSING` is a valid predecessor for both `SHIP` and
 * `MARK_READY_FOR_PICKUP`), so collapsing this into "invalid transition"
 * would misreport *why* the request was refused.
 */
export class FulfilmentModeMismatchError extends DomainRuleError {
  constructor(action: string, mode: FulfilmentModeName, options: AppErrorOptions = {}) {
    super(
      'ORDER_FULFILMENT_MODE_MISMATCH',
      `${action} is not valid for a ${mode} sub-order.`,
      options,
    );
  }
}

/**
 * `PlaceOrderUseCase`'s own precondition (S4-QR): the customer asked for
 * `PICKUP` from a vendor whose `VendorProfile.supportsPickup` is `false`.
 * Refused outright rather than silently downgraded to `DELIVERY` — the
 * locked decision this milestone is built on explicitly forbids inventing
 * that fallback.
 */
export class PickupNotSupportedByVendorError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'ORDER_PICKUP_NOT_SUPPORTED',
      'One or more sellers in your cart do not offer pickup.',
      options,
    );
  }
}

/**
 * `PlaceOrderUseCase`'s serviceability precondition (S4-SERV, SDD 4.2 step 4b,
 * ASM-17): at least one vendor with a `DELIVERY` sub-order does not deliver to
 * the chosen address's pincode.
 *
 * The whole order is refused rather than partially placed (locked decision
 * D4), and the fulfilment mode is never quietly switched to `PICKUP` to make
 * the order fit — the same "never silently downgrade" rule
 * `PickupNotSupportedByVendorError` above already states, applied in the
 * opposite direction.
 *
 * The message names no vendor, no pincode and no count. It mirrors the
 * deliberately non-specific wording of its sibling above: the customer needs
 * to know the order cannot proceed and why in general terms, and enumerating
 * which sellers refuse which postcodes would publish a vendor's delivery
 * footprint to anyone willing to iterate over addresses.
 */
export class AddressNotServiceableError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'ORDER_ADDRESS_NOT_SERVICEABLE',
      'One or more sellers in your cart do not deliver to this address.',
      options,
    );
  }
}

/**
 * `PlaceOrderUseCase`'s business-hours precondition (S4-HOURS, SDD 4.2 step
 * 4c, FR-27): at least one vendor with a `DELIVERY` sub-order is closed at the
 * moment of placement — outside its configured hours, on a recurring weekly
 * holiday, or on a dated closure.
 *
 * The whole order is refused rather than partially placed or deferred (locked
 * decision H1-A), and the fulfilment mode is never quietly switched to
 * `PICKUP` to make the order fit — the same "never silently downgrade" rule
 * `PickupNotSupportedByVendorError` states, applied again.
 *
 * `PICKUP` sub-orders never reach this error: business hours govern delivery
 * only (H2-A).
 *
 * The message names no vendor, no weekday and no opening time, matching the
 * deliberately non-specific wording of its siblings — a customer needs to know
 * the order cannot proceed now, and publishing each seller's trading pattern to
 * anyone willing to retry hourly is not required for that.
 */
export class VendorClosedForDeliveryError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'ORDER_VENDOR_CLOSED',
      'One or more sellers in your cart are closed for delivery right now.',
      options,
    );
  }
}

/**
 * `GetOrIssuePickupTokenUseCase`'s own precondition (S4-QR): a pickup
 * credential only means anything once the vendor has actually marked the
 * sub-order `READY_FOR_PICKUP` — issuing one earlier (or after `COMPLETED`)
 * would hand the customer a QR code for a pickup that either isn't ready yet
 * or already happened. Distinct from `InvalidOrderStatusTransitionError`
 * because no status transition is attempted here at all.
 */
export class PickupTokenNotAvailableError extends DomainRuleError {
  constructor(status: OrderStatusName, options: AppErrorOptions = {}) {
    super(
      'PICKUP_TOKEN_NOT_AVAILABLE',
      'A pickup code is not available for this order right now.',
      {
        ...options,
        details: options.details ?? [
          { field: 'status', issue: `Sub-order is ${status}, not READY_FOR_PICKUP` },
        ],
      },
    );
  }
}

/**
 * `RedeemPickupTokenUseCase`'s catch-all refusal (S4-QR, SDD 13.3, SEC-15).
 * Deliberately the *one* error for every reason a token fails verification —
 * bad signature, wrong audience, expired, malformed, no matching row visible
 * under this vendor's own RLS scope, or a `sub_order_id` that belongs to
 * another vendor entirely. Collapsing all of these into one generic 422
 * (never "expired" vs "forged" vs "not yours") is exactly SEC-15's uniform-
 * response principle, already applied to `AccessTokenService.verify()` in
 * this codebase for the identical reason: a caller learning *why* a token
 * was refused learns the shape of the verification pipeline, which is
 * exactly the information an attacker probing for valid sub-order ids wants.
 */
export class PickupTokenInvalidError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super('PICKUP_TOKEN_INVALID', 'This pickup token is invalid or has expired.', options);
  }
}

/**
 * The atomic `status = 'ISSUED' -> 'REDEEMED'` compare-and-set (SDD 13.1)
 * affected zero rows: this exact token was already redeemed, by this same
 * request racing itself (a retry) or an earlier, successful scan. Distinct
 * from `PickupTokenInvalidError` because reaching this point already proves
 * the token verified and belongs to the caller's own vendor (RLS-scoped) —
 * telling the caller "already redeemed" here leaks nothing an attacker could
 * not already see, unlike the pre-verification failures above.
 */
export class PickupTokenAlreadyRedeemedError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This pickup has already been completed.', {
      ...options,
      code: 'PICKUP_TOKEN_ALREADY_REDEEMED',
    });
  }
}
