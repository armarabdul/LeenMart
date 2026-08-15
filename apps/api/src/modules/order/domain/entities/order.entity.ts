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
 * Same four-state model as `SubOrder` (S3-3A decision D-S3-06). Only
 * `PENDING_PAYMENT` is ever produced by this milestone's own code paths —
 * `CONFIRMED`/`PROCESSING` are fully modelled (so the state machine and the
 * cancellation rule are real and tested) but reachable only from S3-3B/
 * vendor-portal work, not from anything in S3-3A's own scope. See
 * `schema.prisma`'s `OrderStatus` doc comment for the full reasoning.
 */
const TRANSITIONS = {
  CONFIRM: { from: ['PENDING_PAYMENT'], to: OrderStatus.CONFIRMED },
  START_PROCESSING: { from: ['CONFIRMED'], to: OrderStatus.PROCESSING },
  CANCEL: { from: ['PENDING_PAYMENT', 'CONFIRMED'], to: OrderStatus.CANCELLED },
} satisfies Record<string, { from: readonly OrderStatusName[]; to: OrderStatus }>;

type OrderTransition = keyof typeof TRANSITIONS;

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

  private transition(name: OrderTransition, now: Date): Order {
    const { from, to } = TRANSITIONS[name];
    if (!(from as readonly OrderStatusName[]).includes(this.props.status.name)) {
      throw new InvalidOrderStatusTransitionError(this.props.status.name, to.name);
    }
    return new Order({ ...this.props, status: to, updatedAt: now });
  }

  /** No HTTP caller in S3-3A — arrives with S3-3B's payment confirmation. */
  confirm(now: Date): Order {
    return this.transition('CONFIRM', now);
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
   */
  canBeCancelledByCustomer(): boolean {
    if (this.props.status.name === 'PROCESSING' || this.props.status.name === 'CANCELLED') {
      return false;
    }
    return this.props.subOrders.every(
      (subOrder) => subOrder.status.name !== 'PROCESSING' && subOrder.status.name !== 'CANCELLED',
    );
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
