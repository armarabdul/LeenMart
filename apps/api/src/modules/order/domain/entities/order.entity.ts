import type { Money } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import {
  InvalidOrderStatusTransitionError,
  OrderCancellationNotAllowedError,
} from '../errors/order-errors.js';
import { OrderStatus, type OrderStatusName } from '../value-objects/order-status.value-object.js';
import type { OrderId } from '../value-objects/order-id.value-object.js';
import type { SubOrder } from './sub-order.entity.js';

/** SDD 6.3's `order_addresses` snapshot, inlined (S3-3A has one address per order, no separate lifecycle for it). */
export interface OrderAddressSnapshot {
  readonly recipientName: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
  readonly landmark: string | null;
  readonly label: string;
}

export interface OrderProps {
  readonly id: OrderId;
  readonly customerId: UserId;
  readonly status: OrderStatus;
  readonly totalAmount: Money;
  readonly address: OrderAddressSnapshot;
  readonly subOrders: readonly SubOrder[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Same shared `OrderStatus` model as `SubOrder` (S3-3A decision D-S3-06;
 * widened S3-6). `Order` itself never gains `SHIP`/`DELIVER` transitions —
 * S3-6 locked decision #7 keeps the parent `Order.status` independent of
 * individual vendor fulfilment transitions, which are `SubOrder`-only facts.
 * This table is therefore unchanged from S3-3A: `CONFIRM`/`CANCEL` are the
 * only transitions `Order` itself ever performs (`START_PROCESSING` is
 * declared for symmetry with `SubOrder`'s table but has no caller here,
 * exactly as before S3-6 — see `schema.prisma`'s `OrderStatus` doc comment
 * for the full reasoning).
 */
const TRANSITIONS = {
  CONFIRM: { from: ['PENDING_PAYMENT'], to: OrderStatus.CONFIRMED },
  START_PROCESSING: { from: ['CONFIRMED'], to: OrderStatus.PROCESSING },
  CANCEL: { from: ['PENDING_PAYMENT', 'CONFIRMED'], to: OrderStatus.CANCELLED },
} satisfies Record<string, { from: readonly OrderStatusName[]; to: OrderStatus }>;

/**
 * A customer's order (S3-3A, SDD 5 module 8, SDD 6.3 "Order 1..N SubOrder").
 * Always constructed whole, by `PlaceOrderUseCase` — id, address snapshot
 * and every `SubOrder`/`OrderItem` together — never assembled piecemeal, the
 * same "one root, loaded and saved whole" aggregate discipline SDD 24.3
 * states for every aggregate in this codebase.
 */
export class Order {
  private constructor(private readonly props: OrderProps) {}

  static place(props: {
    id: OrderId;
    customerId: UserId;
    totalAmount: Money;
    address: OrderAddressSnapshot;
    subOrders: readonly SubOrder[];
    now: Date;
  }): Order {
    return new Order({
      id: props.id,
      customerId: props.customerId,
      status: OrderStatus.PENDING_PAYMENT,
      totalAmount: props.totalAmount,
      address: props.address,
      subOrders: props.subOrders,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: OrderProps): Order {
    return new Order(props);
  }

  get id(): OrderId {
    return this.props.id;
  }

  get customerId(): UserId {
    return this.props.customerId;
  }

  get status(): OrderStatus {
    return this.props.status;
  }

  get totalAmount(): Money {
    return this.props.totalAmount;
  }

  get address(): OrderAddressSnapshot {
    return this.props.address;
  }

  get subOrders(): readonly SubOrder[] {
    return this.props.subOrders;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /**
   * S3-3B: payment confirmation. One payment covers the whole multi-vendor
   * order, so — exactly like `cancel()` — this cascades to every `SubOrder`
   * rather than leaving them stranded at `PENDING_PAYMENT` under a
   * `CONFIRMED` parent.
   */
  confirm(now: Date): Order {
    const { from, to } = TRANSITIONS.CONFIRM;
    if (!(from as readonly OrderStatusName[]).includes(this.props.status.name)) {
      throw new InvalidOrderStatusTransitionError(this.props.status.name, to.name);
    }
    return new Order({
      ...this.props,
      status: to,
      subOrders: this.props.subOrders.map((subOrder) => subOrder.confirm(now)),
      updatedAt: now,
    });
  }

  /**
   * Approved decision: "customer cancellation is permitted only while the
   * order has not reached PROCESSING." Checked against every `SubOrder`,
   * not just this order's own status — `PROCESSING` is fundamentally a
   * per-vendor fact (SDD 6.3's independent fulfilment lifecycles), so the
   * conservative reading this milestone takes is that any one vendor
   * starting processing locks the *whole* order from customer
   * cancellation, rather than inventing partial-order cancellation
   * semantics no approved decision describes.
   *
   * S3-6 locked decision #6 (mandatory correctness fix): this is now an
   * **allow-list**, not a deny-list. Before S3-6 the check excluded
   * `PROCESSING`/`CANCELLED` by name — safe only because those were the two
   * non-cancellable states that existed. Adding `SHIPPED`/`DELIVERED`
   * without this change would have left them uncaught (neither name is
   * excluded by the old deny-list), letting a customer "cancel" — and
   * `CancelOrderUseCase` restore inventory for — an order that has already
   * shipped or been delivered. An allow-list of exactly the two
   * pre-fulfilment states cannot make the same mistake again if a future
   * milestone adds yet another state.
   */
  canBeCancelledByCustomer(): boolean {
    const isPreFulfilment = (status: OrderStatusName): boolean =>
      status === 'PENDING_PAYMENT' || status === 'CONFIRMED';

    if (!isPreFulfilment(this.props.status.name)) {
      return false;
    }
    return this.props.subOrders.every((subOrder) => isPreFulfilment(subOrder.status.name));
  }

  cancel(now: Date): Order {
    if (!this.canBeCancelledByCustomer()) {
      throw new OrderCancellationNotAllowedError();
    }
    return new Order({
      ...this.props,
      status: TRANSITIONS.CANCEL.to,
      subOrders: this.props.subOrders.map((subOrder) => subOrder.cancel(now)),
      updatedAt: now,
    });
  }
}
