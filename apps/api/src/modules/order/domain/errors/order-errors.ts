import {
  type AppErrorOptions,
  ConflictError,
  DomainRuleError,
  NotFoundError,
} from '@leen-mart/domain-kit';
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
