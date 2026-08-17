import type { Money } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';
import {
  FulfilmentModeMismatchError,
  InvalidOrderStatusTransitionError,
} from '../errors/order-errors.js';
import type {
  FulfilmentMode,
  FulfilmentModeName,
} from '../value-objects/fulfilment-mode.value-object.js';
import { OrderStatus, type OrderStatusName } from '../value-objects/order-status.value-object.js';
import type { OrderId } from '../value-objects/order-id.value-object.js';
import type { SubOrderId } from '../value-objects/sub-order-id.value-object.js';
import type { OrderItem } from './order-item.entity.js';

/**
 * Where the customer collects, frozen at placement (S4-ADDR).
 *
 * A snapshot for the same reason `vendorShopNameSnapshot` and
 * `OrderAddressSnapshot` are: a vendor who later moves premises must not
 * retroactively change where an already-placed order said to go. Nothing on
 * this aggregate ever re-reads it from the vendor profile.
 */
export interface PickupLocationSnapshot {
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
}

export interface SubOrderProps {
  readonly id: SubOrderId;
  readonly orderId: OrderId;
  readonly vendorId: VendorId;
  readonly status: OrderStatus;
  /** S4-QR: chosen once at checkout, never changes afterward — see `FulfilmentMode`'s own doc comment for why this lives here rather than on `Order`. */
  readonly fulfilmentMode: FulfilmentMode;
  readonly vendorShopNameSnapshot: string;
  /**
   * S4-ADDR. Non-null only on a `PICKUP` sub-order whose vendor had a shop
   * address at placement — `null` for every `DELIVERY` sub-order, and for any
   * pickup order placed before this milestone existed.
   */
  readonly pickupLocationSnapshot: PickupLocationSnapshot | null;
  readonly totalAmount: Money;
  readonly items: readonly OrderItem[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /**
   * Optimistic-concurrency guard (S3-5), the same `Inventory.version`
   * pattern: the entity carries the version it was read with, a repository
   * write conditions on `WHERE version = :expectedVersion` and increments it
   * atomically, and a caller that lost the race gets `false`/a thrown
   * conflict rather than silently overwriting a concurrent change. Needed
   * from S3-5 onward because two independent actors — a customer cancelling
   * and a vendor starting processing — can now both write the same
   * `SubOrder` row; before this milestone only one writer (the customer's own
   * cancel/payment-confirmation path) ever touched it.
   */
  readonly version: number;
}

/**
 * Same shared state model as `Order` (S3-3A decision D-S3-06: "use the same
 * state model consistently for Order and SubOrder"; widened S3-6, widened
 * again S4-QR). Every transition here is a genuinely per-vendor fact (SDD
 * 6.3: "N independent fulfilment lifecycles") — `PROCESSING` is common to
 * both fulfilment modes; `SHIPPED`/`DELIVERED` are `DELIVERY`-mode-only,
 * vendor-initiated transitions (S3-6); `READY_FOR_PICKUP`/`COMPLETED` are
 * `PICKUP`-mode-only (S4-QR) — `READY_FOR_PICKUP` is vendor-initiated,
 * `COMPLETED` is reachable *only* through `RedeemPickupTokenUseCase`'s
 * atomic token redemption, never a direct public transition (locked
 * decision).
 *
 * Every transition only accepts its single immediate predecessor — S3-6
 * locked decision #11's "no skip-state transitions" rule, extended to the
 * pickup path: `PROCESSING -> COMPLETED` or `CONFIRMED -> READY_FOR_PICKUP`
 * are both refused the same way `CONFIRMED -> SHIPPED` already is.
 */
const TRANSITIONS = {
  CONFIRM: { from: ['PENDING_PAYMENT'], to: OrderStatus.CONFIRMED },
  START_PROCESSING: { from: ['CONFIRMED'], to: OrderStatus.PROCESSING },
  SHIP: { from: ['PROCESSING'], to: OrderStatus.SHIPPED },
  DELIVER: { from: ['SHIPPED'], to: OrderStatus.DELIVERED },
  MARK_READY_FOR_PICKUP: { from: ['PROCESSING'], to: OrderStatus.READY_FOR_PICKUP },
  COMPLETE_PICKUP: { from: ['READY_FOR_PICKUP'], to: OrderStatus.COMPLETED },
  CANCEL: { from: ['PENDING_PAYMENT', 'CONFIRMED'], to: OrderStatus.CANCELLED },
} satisfies Record<string, { from: readonly OrderStatusName[]; to: OrderStatus }>;

type SubOrderTransition = keyof typeof TRANSITIONS;

/** Which `FulfilmentMode` each mode-specific transition requires — checked before the status guard so a wrong-mode call always reports the real reason. */
const TRANSITION_MODE: Partial<Record<SubOrderTransition, FulfilmentModeName>> = {
  SHIP: 'DELIVERY',
  DELIVER: 'DELIVERY',
  MARK_READY_FOR_PICKUP: 'PICKUP',
  COMPLETE_PICKUP: 'PICKUP',
};

/**
 * One vendor's slice of a multi-vendor order (S3-3A, SDD 6.3). Always
 * constructed as part of an `Order` (via `PlaceOrderUseCase`), never
 * standalone — there is no public path to a `SubOrder` with no parent.
 */
export class SubOrder {
  private constructor(private readonly props: SubOrderProps) {}

  static open(props: {
    id: SubOrderId;
    orderId: OrderId;
    vendorId: VendorId;
    fulfilmentMode: FulfilmentMode;
    vendorShopNameSnapshot: string;
    /**
     * S4-ADDR. The caller passes this only for a `PICKUP` sub-order; the
     * guard below refuses a collection address on a `DELIVERY` one rather
     * than silently storing a contradiction.
     */
    pickupLocationSnapshot?: PickupLocationSnapshot | null;
    totalAmount: Money;
    items: readonly OrderItem[];
    now: Date;
  }): SubOrder {
    const pickupLocationSnapshot = props.pickupLocationSnapshot ?? null;
    if (pickupLocationSnapshot && props.fulfilmentMode.name !== 'PICKUP') {
      throw new FulfilmentModeMismatchError(
        'Recording a pickup location',
        props.fulfilmentMode.name,
      );
    }
    return new SubOrder({
      id: props.id,
      orderId: props.orderId,
      vendorId: props.vendorId,
      status: OrderStatus.PENDING_PAYMENT,
      fulfilmentMode: props.fulfilmentMode,
      vendorShopNameSnapshot: props.vendorShopNameSnapshot,
      pickupLocationSnapshot,
      totalAmount: props.totalAmount,
      items: props.items,
      createdAt: props.now,
      updatedAt: props.now,
      version: 1,
    });
  }

  static reconstitute(props: SubOrderProps): SubOrder {
    return new SubOrder(props);
  }

  get id(): SubOrderId {
    return this.props.id;
  }

  get orderId(): OrderId {
    return this.props.orderId;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get status(): OrderStatus {
    return this.props.status;
  }

  get fulfilmentMode(): FulfilmentMode {
    return this.props.fulfilmentMode;
  }

  get vendorShopNameSnapshot(): string {
    return this.props.vendorShopNameSnapshot;
  }

  get pickupLocationSnapshot(): PickupLocationSnapshot | null {
    return this.props.pickupLocationSnapshot;
  }

  get totalAmount(): Money {
    return this.props.totalAmount;
  }

  get items(): readonly OrderItem[] {
    return this.props.items;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get version(): number {
    return this.props.version;
  }

  private transition(name: SubOrderTransition, now: Date): SubOrder {
    const { from, to } = TRANSITIONS[name];
    const requiredMode = TRANSITION_MODE[name];
    if (requiredMode && this.props.fulfilmentMode.name !== requiredMode) {
      throw new FulfilmentModeMismatchError(name, this.props.fulfilmentMode.name);
    }
    if (!(from as readonly OrderStatusName[]).includes(this.props.status.name)) {
      throw new InvalidOrderStatusTransitionError(this.props.status.name, to.name);
    }
    return new SubOrder({ ...this.props, status: to, updatedAt: now });
  }

  /** No HTTP caller in S3-3A — the payment-confirmation transition arrives with S3-3B. */
  confirm(now: Date): SubOrder {
    return this.transition('CONFIRM', now);
  }

  /** Vendor-initiated (S3-5): `POST /api/v1/vendor/orders/:id/process`, via `StartProcessingUseCase`. */
  startProcessing(now: Date): SubOrder {
    return this.transition('START_PROCESSING', now);
  }

  /** Vendor-initiated (S3-6): `POST /api/v1/vendor/orders/:id/ship`, via `ShipSubOrderUseCase`. */
  ship(now: Date): SubOrder {
    return this.transition('SHIP', now);
  }

  /** Vendor-initiated (S3-6): `POST /api/v1/vendor/orders/:id/deliver`, via `DeliverSubOrderUseCase`. */
  deliver(now: Date): SubOrder {
    return this.transition('DELIVER', now);
  }

  cancel(now: Date): SubOrder {
    return this.transition('CANCEL', now);
  }

  /** Vendor-initiated (S4-QR): `POST /api/v1/vendor/orders/:id/ready-for-pickup`, via `MarkReadyForPickupUseCase`. `PICKUP`-mode only. */
  markReadyForPickup(now: Date): SubOrder {
    return this.transition('MARK_READY_FOR_PICKUP', now);
  }

  /**
   * S4-QR: reached *only* from inside `RedeemPickupTokenUseCase`, after the
   * atomic `pickup_tokens` compare-and-set already succeeded — there is no
   * direct public endpoint that calls this (locked decision #10). `PICKUP`-
   * mode only.
   */
  completePickup(now: Date): SubOrder {
    return this.transition('COMPLETE_PICKUP', now);
  }
}
