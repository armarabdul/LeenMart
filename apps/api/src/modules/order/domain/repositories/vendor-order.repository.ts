import type { Money, TransactionScope } from '@leen-mart/domain-kit';
import type { OrderAddressSnapshot } from '../entities/order.entity.js';
import type { SubOrder } from '../entities/sub-order.entity.js';
import type { OrderId } from '../value-objects/order-id.value-object.js';
import type { OrderStatus } from '../value-objects/order-status.value-object.js';
import type { SubOrderId } from '../value-objects/sub-order-id.value-object.js';

/**
 * One row of "Vendor Orders" (S3-5) — enough to list, nothing more. The same
 * "enough to list, nothing more" discipline `OrderSummary` (S3-4) already
 * applies: no items, no address, since a list row exists only to let the
 * vendor pick which sub-order to open next.
 */
export interface VendorSubOrderSummary {
  readonly id: SubOrderId;
  readonly orderId: OrderId;
  readonly status: OrderStatus;
  readonly totalAmount: Money;
  readonly createdAt: Date;
}

/**
 * The vendor-facing detail view (S3-5): the vendor's own `SubOrder` (with its
 * own `OrderItem`s — never another vendor's) plus the parent `Order`'s
 * delivery-address snapshot, the one piece of the parent aggregate a vendor
 * genuinely needs to fulfil their slice. Deliberately not the full `Order`
 * (never another vendor's sub-orders, never the customer's account identity
 * beyond the address' own recipient/phone fields, never commission).
 */
export interface VendorSubOrderDetail {
  readonly subOrder: SubOrder;
  readonly address: OrderAddressSnapshot;
}

/**
 * Vendor-scoped order access (S3-5), bound to the tenant-scoped `prisma`
 * client (`leenmart_app`) rather than `leenmart_checkout` — see the
 * `20260816130000` migration's own header for why. No `vendorId` parameter
 * on any method here: the same convention `PrismaProductRepository.findById`
 * already establishes for every other vendor-owned model — the Prisma client
 * this repository is constructed on is already scoped to the caller's own
 * vendor by `tenantContext`/RLS, so a wrong-vendor id simply matches no row.
 */
export interface VendorOrderRepository {
  /** Re-binds this repository to an open transaction. Same shape every other repository in this codebase publishes. */
  withTransaction(scope: TransactionScope): VendorOrderRepository;

  /** The caller's own sub-orders, newest first, bounded to `limit` rows — mirrors `OrderRepository.findAllByCustomerId`'s own bounded, no-cursor shape (S3-4). */
  findAllByVendor(limit: number): Promise<readonly VendorSubOrderSummary[]>;

  /** One sub-order the caller's vendor owns, with its items and its parent order's address snapshot — `null` if it does not exist or belongs to another vendor. */
  findDetailById(subOrderId: SubOrderId): Promise<VendorSubOrderDetail | null>;

  /**
   * Writes `subOrder`'s new status **only if** the row still carries
   * `expectedVersion` — the same `Inventory.setIfVersionMatches` idiom.
   * `false` means someone else (a customer's cancellation, or a concurrent
   * retry of this same request) moved first; the caller turns that into a
   * conflict.
   */
  updateStatusIfVersionMatches(subOrder: SubOrder, expectedVersion: number): Promise<boolean>;
}
