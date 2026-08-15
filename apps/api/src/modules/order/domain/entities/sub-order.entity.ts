import type { Money } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';
import { InvalidOrderStatusTransitionError } from '../errors/order-errors.js';
import { OrderStatus, type OrderStatusName } from '../value-objects/order-status.value-object.js';
import type { OrderId } from '../value-objects/order-id.value-object.js';
import type { SubOrderId } from '../value-objects/sub-order-id.value-object.js';
import type { OrderItem } from './order-item.entity.js';

export interface SubOrderProps {
  readonly id: SubOrderId;
  readonly orderId: OrderId;
  readonly vendorId: VendorId;
  readonly status: OrderStatus;
  readonly vendorShopNameSnapshot: string;
  readonly totalAmount: Money;
  readonly items: readonly OrderItem[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Same four-state model as `Order` (S3-3A decision D-S3-06: "use the same
 * state model consistently for Order and SubOrder"). `PROCESSING` is a
 * genuinely per-vendor fact here (SDD 6.3: "N independent fulfilment
 * lifecycles") — this is the level a real "vendor starts processing"
 * action would eventually transition, though no HTTP caller reaches it in
 * S3-3A (vendor-portal/fulfilment work, out of this milestone's scope).
 */
const TRANSITIONS = {
  CONFIRM: { from: ['PENDING_PAYMENT'], to: OrderStatus.CONFIRMED },
  START_PROCESSING: { from: ['CONFIRMED'], to: OrderStatus.PROCESSING },
  CANCEL: { from: ['PENDING_PAYMENT', 'CONFIRMED'], to: OrderStatus.CANCELLED },
} satisfies Record<string, { from: readonly OrderStatusName[]; to: OrderStatus }>;

type SubOrderTransition = keyof typeof TRANSITIONS;

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
    vendorShopNameSnapshot: string;
    totalAmount: Money;
    items: readonly OrderItem[];
    now: Date;
  }): SubOrder {
    return new SubOrder({
      id: props.id,
      orderId: props.orderId,
      vendorId: props.vendorId,
      status: OrderStatus.PENDING_PAYMENT,
      vendorShopNameSnapshot: props.vendorShopNameSnapshot,
      totalAmount: props.totalAmount,
      items: props.items,
      createdAt: props.now,
      updatedAt: props.now,
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

  get vendorShopNameSnapshot(): string {
    return this.props.vendorShopNameSnapshot;
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

  private transition(name: SubOrderTransition, now: Date): SubOrder {
    const { from, to } = TRANSITIONS[name];
    if (!(from as readonly OrderStatusName[]).includes(this.props.status.name)) {
      throw new InvalidOrderStatusTransitionError(this.props.status.name, to.name);
    }
    return new SubOrder({ ...this.props, status: to, updatedAt: now });
  }

  /** No HTTP caller in S3-3A — the payment-confirmation transition arrives with S3-3B. */
  confirm(now: Date): SubOrder {
    return this.transition('CONFIRM', now);
  }

  /** No HTTP caller in S3-3A — vendor-portal/fulfilment scope, named nowhere in this milestone. */
  startProcessing(now: Date): SubOrder {
    return this.transition('START_PROCESSING', now);
  }

  cancel(now: Date): SubOrder {
    return this.transition('CANCEL', now);
  }
}
