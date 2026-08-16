export type OrderStatusName =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

/**
 * The order/sub-order lifecycle state (S3-3A, approved decision D-S3-06;
 * widened S3-6, locked decision #2). Shared by both `Order` and `SubOrder` —
 * the approved decision is to use one state model for both, so this single
 * class serves both entities rather than two structurally identical ones.
 *
 * `SHIPPED`/`DELIVERED` are delivery-mode-only (S3-6 locked decision #1 —
 * there is no pickup mode in this codebase at all). No `ACCEPTED`,
 * `REJECTED`, `COMPLETED`, `FAILED`, `REFUNDED`, `READY_FOR_PICKUP`,
 * `REDEEMED` or `PICKUP_MISSED` — S3-6 explicitly excludes all of them.
 *
 * Only *which* state this is; the allowed transitions between them belong
 * to the entity, the same split `VendorStatus`/`VendorProfile` already
 * establish.
 */
export class OrderStatus {
  private constructor(public readonly name: OrderStatusName) {}

  static readonly PENDING_PAYMENT = new OrderStatus('PENDING_PAYMENT');
  static readonly CONFIRMED = new OrderStatus('CONFIRMED');
  static readonly PROCESSING = new OrderStatus('PROCESSING');
  static readonly SHIPPED = new OrderStatus('SHIPPED');
  static readonly DELIVERED = new OrderStatus('DELIVERED');
  static readonly CANCELLED = new OrderStatus('CANCELLED');

  private static readonly BY_NAME: Readonly<Record<OrderStatusName, OrderStatus>> = {
    PENDING_PAYMENT: OrderStatus.PENDING_PAYMENT,
    CONFIRMED: OrderStatus.CONFIRMED,
    PROCESSING: OrderStatus.PROCESSING,
    SHIPPED: OrderStatus.SHIPPED,
    DELIVERED: OrderStatus.DELIVERED,
    CANCELLED: OrderStatus.CANCELLED,
  };

  static fromName(name: string): OrderStatus {
    const status = (OrderStatus.BY_NAME as Record<string, OrderStatus | undefined>)[name];
    if (!status) {
      throw new TypeError(`Not a valid order status: "${name}"`);
    }
    return status;
  }

  equals(other: OrderStatus): boolean {
    return this.name === other.name;
  }
}
