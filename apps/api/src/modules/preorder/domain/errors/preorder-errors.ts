import {
  type AppErrorOptions,
  ConflictError,
  DomainRuleError,
  NotFoundError,
} from '@leen-mart/domain-kit';
import type { CampaignStatusName } from '../value-objects/campaign-status.value-object.js';
import type { ReservationStatusName } from '../value-objects/reservation-status.value-object.js';

export class CampaignNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('This preorder campaign does not exist.', {
      ...options,
      code: 'PREORDER_CAMPAIGN_NOT_FOUND',
    });
  }
}

export class InvalidCampaignStatusTransitionError extends DomainRuleError {
  constructor(from: CampaignStatusName, to: CampaignStatusName, options: AppErrorOptions = {}) {
    super(
      'PREORDER_CAMPAIGN_INVALID_STATUS_TRANSITION',
      `A preorder campaign cannot move from ${from} to ${to}.`,
      {
        ...options,
        details: options.details ?? [
          { field: 'status', issue: `${from} → ${to} is not a permitted transition` },
        ],
      },
    );
  }
}

/**
 * The SDD §14.6 freeze: once the first reservation is confirmed, quantity
 * may only increase and the cutoff/fulfilment window are frozen.
 */
export class CampaignFrozenAfterFirstReservationError extends DomainRuleError {
  constructor(field: string, options: AppErrorOptions = {}) {
    super(
      'PREORDER_CAMPAIGN_FROZEN',
      'This field can no longer be changed — a reservation has already been confirmed against this campaign.',
      {
        ...options,
        details: options.details ?? [{ field, issue: 'Frozen after first confirmed reservation.' }],
      },
    );
  }
}

export class InvalidCampaignQuantityError extends DomainRuleError {
  constructor(issue: string, options: AppErrorOptions = {}) {
    super('PREORDER_CAMPAIGN_INVALID_QUANTITY', 'This quantity is not valid for this campaign.', {
      ...options,
      details: [{ field: 'totalQuantity', issue }],
    });
  }
}

export class InvalidCampaignWindowError extends DomainRuleError {
  constructor(issue: string, options: AppErrorOptions = {}) {
    super('PREORDER_CAMPAIGN_INVALID_WINDOW', 'These campaign dates are not valid.', {
      ...options,
      details: [{ field: 'fulfilmentWindow', issue }],
    });
  }
}

export class ReservationNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('This reservation does not exist.', {
      ...options,
      code: 'PREORDER_RESERVATION_NOT_FOUND',
    });
  }
}

export class InvalidReservationStatusTransitionError extends DomainRuleError {
  constructor(
    from: ReservationStatusName,
    to: ReservationStatusName,
    options: AppErrorOptions = {},
  ) {
    super(
      'PREORDER_RESERVATION_INVALID_STATUS_TRANSITION',
      `A reservation cannot move from ${from} to ${to}.`,
      {
        ...options,
        details: options.details ?? [
          { field: 'status', issue: `${from} → ${to} is not a permitted transition` },
        ],
      },
    );
  }
}

/** The campaign is not `OPEN`, or `remaining_quantity` is less than requested — the two are collapsed into one error since both surface from the same atomic conditional write (SDD §14.4 layer 2). */
export class CampaignNotAvailableError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'PREORDER_CAMPAIGN_NOT_AVAILABLE',
      'This campaign is not open, or does not have enough remaining quantity.',
      {
        ...options,
        details: [{ field: 'quantity', issue: 'Requested quantity is not available.' }],
      },
    );
  }
}

export class MaxPerCustomerExceededError extends DomainRuleError {
  constructor(maxPerCustomer: number, options: AppErrorOptions = {}) {
    super(
      'PREORDER_MAX_PER_CUSTOMER_EXCEEDED',
      `This campaign allows at most ${maxPerCustomer} unit(s) per customer.`,
      {
        ...options,
        details: [
          { field: 'quantity', issue: `Exceeds the ${maxPerCustomer}-unit per-customer limit.` },
        ],
      },
    );
  }
}

export class InvalidReservationQuantityError extends DomainRuleError {
  constructor(issue: string, options: AppErrorOptions = {}) {
    super('PREORDER_RESERVATION_INVALID_QUANTITY', 'This quantity is not valid.', {
      ...options,
      details: [{ field: 'quantity', issue }],
    });
  }
}

/** Thrown when a conditional write (campaign decrement, reservation transition) loses a race — "database decides who wins", mirroring `CartWriteConflictError`. */
export class PreorderWriteConflictError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This changed concurrently. Please try again.', {
      ...options,
      code: 'PREORDER_WRITE_CONFLICT',
    });
  }
}

export class InvalidPaymentAttemptTransitionError extends DomainRuleError {
  constructor(from: string, to: string, options: AppErrorOptions = {}) {
    super(
      'PREORDER_PAYMENT_ATTEMPT_INVALID_TRANSITION',
      `A preorder payment attempt cannot move from ${from} to ${to}.`,
      {
        ...options,
        details: options.details ?? [
          { field: 'status', issue: `${from} → ${to} is not a permitted transition` },
        ],
      },
    );
  }
}

/** Mirrors `OrderAddressNotFoundError` (order module) — ownership-scoped, never distinguishes "no such address" from "not yours" (SEC-06). */
export class ReservationAddressNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('This address does not exist.', {
      ...options,
      code: 'PREORDER_RESERVATION_ADDRESS_NOT_FOUND',
    });
  }
}

export class FulfilmentModeNotOfferedError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'PREORDER_FULFILMENT_MODE_NOT_OFFERED',
      'This campaign does not offer the requested fulfilment mode.',
      {
        ...options,
        details: [{ field: 'fulfilmentMode', issue: 'Not permitted by this campaign.' }],
      },
    );
  }
}

export class VariantNotEligibleForCampaignError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'PREORDER_VARIANT_NOT_ELIGIBLE',
      'This product variant is not available for a preorder campaign.',
      {
        ...options,
        details: [{ field: 'variantId', issue: 'No eligible variant exists at this id.' }],
      },
    );
  }
}

/** Mirrors `OrderNotPendingPaymentError` — the advance-payment surface only accepts a `PENDING` reservation. */
export class ReservationNotPendingError extends DomainRuleError {
  constructor(status: ReservationStatusName, options: AppErrorOptions = {}) {
    super('PREORDER_RESERVATION_NOT_PENDING', 'This reservation is not awaiting advance payment.', {
      ...options,
      details: options.details ?? [
        { field: 'status', issue: `Reservation is ${status}, not PENDING` },
      ],
    });
  }
}

/** Mirrors `OrderNotPendingPaymentError`'s balance-side equivalent — the balance-payment surface only accepts a `CONFIRMED` reservation with an outstanding balance. */
export class ReservationBalanceNotDueError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'PREORDER_RESERVATION_BALANCE_NOT_DUE',
      'This reservation has no outstanding balance to pay.',
      {
        ...options,
        details: [
          {
            field: 'status',
            issue: 'Reservation is not CONFIRMED, or the balance is already paid.',
          },
        ],
      },
    );
  }
}

/** Mirrors `PaymentAlreadyInitiatedError`. */
export class ReservationPaymentAlreadyInitiatedError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('A payment is already awaiting confirmation for this reservation.', {
      ...options,
      code: 'PREORDER_PAYMENT_ALREADY_INITIATED',
    });
  }
}

/** Mirrors `PaymentAttemptNotFoundError`. */
export class ReservationPaymentAttemptNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('No payment is currently awaiting confirmation for this reservation.', {
      ...options,
      code: 'PREORDER_PAYMENT_ATTEMPT_NOT_FOUND',
    });
  }
}

/** Mirrors `PaymentFailedError`. */
export class ReservationPaymentFailedError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'PREORDER_PAYMENT_FAILED',
      'The payment could not be completed. Please try again.',
      options,
    );
  }
}

/**
 * A reservation with `convertedOrderId` set already has a real `Order`
 * downstream. The approved 5-state reservation machine (PENDING/CONFIRMED/
 * EXPIRED/PAYMENT_FAILED/CANCELLED) has no terminal "CONVERTED" state — this
 * is enforced as a field check rather than a status transition, per the
 * implementation brief's own instruction not to introduce a new state
 * without stopping to explain why first.
 */
export class ReservationNotReadyForConversionError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'PREORDER_RESERVATION_NOT_READY_FOR_CONVERSION',
      'This reservation is not CONFIRMED with its balance paid.',
      options,
    );
  }
}

/** The address the reservation named no longer exists (or was deleted) by conversion time — an ops-actionable failure, not a customer-facing one (conversion is scheduler-triggered). */
export class ConversionAddressNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('The address this reservation named no longer exists.', {
      ...options,
      code: 'PREORDER_CONVERSION_ADDRESS_NOT_FOUND',
    });
  }
}

/** The campaign's variant (or its product) is no longer eligible by conversion time — deleted, unpublished, or rejected since the reservation was created. */
export class ConversionProductNoLongerEligibleError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'PREORDER_CONVERSION_PRODUCT_NOT_ELIGIBLE',
      'The product behind this campaign is no longer eligible for conversion.',
      options,
    );
  }
}

/** Mirrors `VendorNotEligibleForOrderError` (order module) — the vendor is no longer ACTIVE or has no shop name set by conversion time. */
export class ConversionVendorNotEligibleError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'PREORDER_CONVERSION_VENDOR_NOT_ELIGIBLE',
      'This campaign’s vendor is not currently eligible to fulfil orders.',
      options,
    );
  }
}

export class ReservationAlreadyConvertedError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'PREORDER_RESERVATION_ALREADY_CONVERTED',
      'This reservation has already been converted to an order. Manage it through the order instead.',
      options,
    );
  }
}
