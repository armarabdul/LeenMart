export type OrderStatusName =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'READY_FOR_PICKUP'
  | 'COMPLETED'
  | 'CANCELLED';

/**
 * The order/sub-order lifecycle state (S3-3A, approved decision D-S3-06;
 * widened S3-6, locked decision #2; widened again S4-QR). Shared by both
 * `Order` and `SubOrder` — the approved decision is to use one state model
 * for both, so this single class serves both entities rather than two
 * structurally identical ones.
 *
 * `SHIPPED`/`DELIVERED` are `DELIVERY`-mode-only; `READY_FOR_PICKUP`/
 * `COMPLETED` are `PICKUP`-mode-only (S4-QR — `SubOrder.fulfilmentMode` is
 * what enforces this, not this class, the same split this class already
 * draws between "which state" and "which transitions", see `SubOrder`'s own
 * `TRANSITIONS` table and its mode guards). No `ACCEPTED`, `REJECTED`,
 * `FAILED`, `REFUNDED`, `REDEEMED` or `PICKUP_MISSED` — `REDEEMED` is a
 * `PickupToken`'s own status, a different entity entirely (SDD 13.1), and
 * `PICKUP_MISSED` needs a pickup-window/grace-period concept S4-QR's locked
 * scope explicitly excludes (no delivery-slot/business-hours functionality).
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
  static readonly READY_FOR_PICKUP = new OrderStatus('READY_FOR_PICKUP');
  static readonly COMPLETED = new OrderStatus('COMPLETED');
  static readonly CANCELLED = new OrderStatus('CANCELLED');

  private static readonly BY_NAME: Readonly<Record<OrderStatusName, OrderStatus>> = {
    PENDING_PAYMENT: OrderStatus.PENDING_PAYMENT,
    CONFIRMED: OrderStatus.CONFIRMED,
    PROCESSING: OrderStatus.PROCESSING,
    SHIPPED: OrderStatus.SHIPPED,
    DELIVERED: OrderStatus.DELIVERED,
    READY_FOR_PICKUP: OrderStatus.READY_FOR_PICKUP,
    COMPLETED: OrderStatus.COMPLETED,
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
