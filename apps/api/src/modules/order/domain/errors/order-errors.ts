import { type AppErrorOptions, DomainRuleError, NotFoundError } from '@leen-mart/domain-kit';
import type { OrderStatusName } from '../value-objects/order-status.value-object.js';

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
