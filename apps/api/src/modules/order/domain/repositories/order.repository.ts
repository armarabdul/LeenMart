import type { TransactionScope } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type { Order } from '../entities/order.entity.js';
import type { OrderId } from '../value-objects/order-id.value-object.js';

export interface OrderRepository {
  /** Re-binds this repository to an open transaction. Same shape every other repository in this codebase publishes. */
  withTransaction(scope: TransactionScope): OrderRepository;

  /** Inserts the whole aggregate — the order, every sub-order and every order item — in one call. */
  create(order: Order): Promise<void>;

  /** Scoped to `id` + `customerId` — never a bare `id` lookup, so a client-supplied id can never reach another customer's order (SEC-06). */
  findByIdAndCustomerId(id: OrderId, customerId: UserId): Promise<Order | null>;

  /**
   * Writes the order's own status and every sub-order's status — the two
   * levels `cancel()` changes together. Nothing else on the aggregate is
   * ever rewritten (order items are immutable once created).
   */
  updateStatus(order: Order): Promise<void>;
}
