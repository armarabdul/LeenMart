import type { Money, TransactionScope } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type { Order } from '../entities/order.entity.js';
import type { OrderId } from '../value-objects/order-id.value-object.js';
import type { OrderStatus } from '../value-objects/order-status.value-object.js';

/**
 * One row of "My Orders" (S3-4) — enough to list, nothing more. Deliberately
 * not the full `Order` aggregate: `findAllByCustomerId` never needs
 * `subOrders`/items reconstituted, so this read model omits them at the
 * query itself rather than fetching and discarding them, the same
 * discipline `KycReviewQueueItem` already applies to its own queue row.
 */
export interface OrderSummary {
  readonly id: OrderId;
  readonly status: OrderStatus;
  readonly totalAmount: Money;
  readonly createdAt: Date;
}

export interface OrderRepository {
  /** Re-binds this repository to an open transaction. Same shape every other repository in this codebase publishes. */
  withTransaction(scope: TransactionScope): OrderRepository;

  /** Inserts the whole aggregate — the order, every sub-order and every order item — in one call. */
  create(order: Order): Promise<void>;

  /** Scoped to `id` + `customerId` — never a bare `id` lookup, so a client-supplied id can never reach another customer's order (SEC-06). */
  findByIdAndCustomerId(id: OrderId, customerId: UserId): Promise<Order | null>;

  /**
   * The caller's own orders, newest first, bounded to `limit` rows — no
   * cursor (S3-4). A personal order-history list is closer in shape to
   * `AuditLogRepository.findByActor(actorId, limit)` (one owner's own
   * bounded recent history) than to the admin/vendor cursor convention
   * `ProductRepository.listPage` uses for a queue that can grow without
   * bound under someone else's control — so it reuses that simpler
   * precedent rather than the cursor one.
   */
  findAllByCustomerId(customerId: UserId, limit: number): Promise<readonly OrderSummary[]>;

  /**
   * Writes the order's own status and every sub-order's status — the two
   * levels `cancel()` changes together. Nothing else on the aggregate is
   * ever rewritten (order items are immutable once created).
   */
  updateStatus(order: Order): Promise<void>;
}
