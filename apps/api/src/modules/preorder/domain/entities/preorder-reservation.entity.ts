import type { Money } from '@leen-mart/domain-kit';
import type { AddressId } from '../../../customer/index.js';
import type { UserId, VendorId } from '../../../identity/index.js';
import {
  InvalidReservationQuantityError,
  InvalidReservationStatusTransitionError,
} from '../errors/preorder-errors.js';
import type { CampaignId } from '../value-objects/campaign-id.value-object.js';
import type { ReservationId } from '../value-objects/reservation-id.value-object.js';
import {
  ReservationStatus,
  type ReservationStatusName,
} from '../value-objects/reservation-status.value-object.js';

/** The two real `SubOrder`-level modes (never `BOTH`) — see `CampaignFulfilmentMode`'s own doc comment for why this lives on the reservation itself. */
export type ReservationFulfilmentMode = 'DELIVERY' | 'PICKUP';

export interface ReservationProps {
  readonly id: ReservationId;
  readonly campaignId: CampaignId;
  readonly customerId: UserId;
  readonly vendorId: VendorId;
  readonly quantity: number;
  readonly fulfilmentMode: ReservationFulfilmentMode;
  /** Resolved and snapshotted fresh at conversion time by `ConvertReservationToOrderUseCase` — this is only the reference, the same "reference now, snapshot at the moment the order comes into existence" split `PlaceOrderUseCase` already uses for `addressId` vs. the order's own address snapshot. */
  readonly addressId: AddressId;
  readonly status: ReservationStatus;
  readonly unitPrice: Money;
  readonly advanceAmount: Money;
  readonly balanceAmount: Money;
  readonly expiresAt: Date;
  readonly confirmedAt: Date | null;
  readonly balancePaidAt: Date | null;
  readonly releasedAt: Date | null;
  readonly convertedOrderId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Reservation states are the discovery report's own approved,
 * narrative-grounded inference (SDD §14.3 narrative, no formal enum) — kept
 * isolated to this entity so it can change later without touching anything
 * outside `preorder`.
 *
 * `CONFIRMED -> CANCELLED` covers SDD §14.6's "balance unpaid at window open
 * → auto-cancel" — the only way a reservation leaves `CONFIRMED`.
 */
const TRANSITIONS = {
  CONFIRM: { from: ['PENDING'], to: ReservationStatus.CONFIRMED },
  EXPIRE: { from: ['PENDING'], to: ReservationStatus.EXPIRED },
  FAIL_PAYMENT: { from: ['PENDING'], to: ReservationStatus.PAYMENT_FAILED },
  CANCEL_PENDING: { from: ['PENDING'], to: ReservationStatus.CANCELLED },
  CANCEL_CONFIRMED: { from: ['CONFIRMED'], to: ReservationStatus.CANCELLED },
} satisfies Record<string, { from: readonly ReservationStatusName[]; to: ReservationStatus }>;

type ReservationTransition = keyof typeof TRANSITIONS;

/**
 * One customer's hold against one campaign (SDD §14.3). `quantity` occupies
 * campaign capacity from the moment this entity is created (`PENDING`), not
 * from confirmation — a soft hold must itself hold the capacity it claims.
 */
export class PreorderReservation {
  private constructor(private readonly props: ReservationProps) {}

  static create(props: {
    id: ReservationId;
    campaignId: CampaignId;
    customerId: UserId;
    vendorId: VendorId;
    quantity: number;
    fulfilmentMode: ReservationFulfilmentMode;
    addressId: AddressId;
    unitPrice: Money;
    advanceAmount: Money;
    balanceAmount: Money;
    expiresAt: Date;
    now: Date;
  }): PreorderReservation {
    assertPositiveQuantity(props.quantity);
    return new PreorderReservation({
      id: props.id,
      campaignId: props.campaignId,
      customerId: props.customerId,
      vendorId: props.vendorId,
      quantity: props.quantity,
      fulfilmentMode: props.fulfilmentMode,
      addressId: props.addressId,
      status: ReservationStatus.PENDING,
      unitPrice: props.unitPrice,
      advanceAmount: props.advanceAmount,
      balanceAmount: props.balanceAmount,
      expiresAt: props.expiresAt,
      confirmedAt: null,
      balancePaidAt: null,
      releasedAt: null,
      convertedOrderId: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: ReservationProps): PreorderReservation {
    return new PreorderReservation(props);
  }

  get id(): ReservationId {
    return this.props.id;
  }

  get campaignId(): CampaignId {
    return this.props.campaignId;
  }

  get customerId(): UserId {
    return this.props.customerId;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get quantity(): number {
    return this.props.quantity;
  }

  get fulfilmentMode(): ReservationFulfilmentMode {
    return this.props.fulfilmentMode;
  }

  get addressId(): AddressId {
    return this.props.addressId;
  }

  get status(): ReservationStatus {
    return this.props.status;
  }

  get unitPrice(): Money {
    return this.props.unitPrice;
  }

  get advanceAmount(): Money {
    return this.props.advanceAmount;
  }

  get balanceAmount(): Money {
    return this.props.balanceAmount;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get confirmedAt(): Date | null {
    return this.props.confirmedAt;
  }

  get balancePaidAt(): Date | null {
    return this.props.balancePaidAt;
  }

  get releasedAt(): Date | null {
    return this.props.releasedAt;
  }

  get convertedOrderId(): string | null {
    return this.props.convertedOrderId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** Whether the balance still needs collecting before fulfilment (advancePercent < 100). */
  hasOutstandingBalance(): boolean {
    return !this.props.balanceAmount.isZero() && this.props.balancePaidAt === null;
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt.getTime() <= now.getTime();
  }

  private transition(name: ReservationTransition, now: Date): PreorderReservation {
    const { from, to } = TRANSITIONS[name];
    if (!(from as readonly ReservationStatusName[]).includes(this.props.status.name)) {
      throw new InvalidReservationStatusTransitionError(this.props.status.name, to.name);
    }
    return new PreorderReservation({ ...this.props, status: to, updatedAt: now });
  }

  /** Advance payment succeeded. Quantity was already decremented at `create()` time — this only flips status. */
  confirm(now: Date): PreorderReservation {
    const next = this.transition('CONFIRM', now);
    return new PreorderReservation({ ...next.props, confirmedAt: now });
  }

  /** Scheduler-initiated: TTL lapsed unpaid (`SweepReservationExpiryUseCase`). Releases the held quantity. */
  expire(now: Date): PreorderReservation {
    const next = this.transition('EXPIRE', now);
    return new PreorderReservation({ ...next.props, releasedAt: now });
  }

  /** The advance payment attempt failed. Releases the held quantity, same as `expire()`. */
  failPayment(now: Date): PreorderReservation {
    const next = this.transition('FAIL_PAYMENT', now);
    return new PreorderReservation({ ...next.props, releasedAt: now });
  }

  /**
   * Customer- or vendor-initiated cancel, from either `PENDING` or
   * `CONFIRMED`. No refund call anywhere in this method — BR-06/07 remain
   * unresolved (Phase Next scope boundary); this releases the held quantity
   * and stops there, the same boundary `CancelOrderUseCase` already
   * establishes for ordinary orders.
   */
  cancel(now: Date): PreorderReservation {
    const name: ReservationTransition =
      this.props.status.name === 'CONFIRMED' ? 'CANCEL_CONFIRMED' : 'CANCEL_PENDING';
    const next = this.transition(name, now);
    return new PreorderReservation({ ...next.props, releasedAt: now });
  }

  recordBalancePaid(now: Date): PreorderReservation {
    return new PreorderReservation({ ...this.props, balancePaidAt: now, updatedAt: now });
  }

  recordConvertedOrder(orderId: string, now: Date): PreorderReservation {
    return new PreorderReservation({ ...this.props, convertedOrderId: orderId, updatedAt: now });
  }
}

const assertPositiveQuantity = (quantity: number): void => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new InvalidReservationQuantityError('Must be a positive whole number.');
  }
};
