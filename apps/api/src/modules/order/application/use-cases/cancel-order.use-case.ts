import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { InventoryRepository } from '../../../catalogue/index.js';
import type { Principal } from '../../../identity/index.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import { ORDER_AUDIT_ACTIONS, ORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import type { Order } from '../../domain/entities/order.entity.js';
import { OrderNotFoundError } from '../../domain/errors/order-errors.js';
import type { OrderRepository } from '../../domain/repositories/order.repository.js';
import type { OrderId } from '../../domain/value-objects/order-id.value-object.js';

export interface CancelOrderInput {
  readonly principal: Principal;
  readonly orderId: OrderId;
}

export interface CancelOrderDeps {
  readonly orderRepository: OrderRepository;
  readonly inventoryRepository: InventoryRepository;
  readonly outboxWriter: OutboxWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Customer-initiated cancellation (`CANCEL_OWN_ORDER`, SDD 8.2: `CUSTOMER`
 * -> `OWN`). Approved decision: "permitted only while the order has not
 * reached PROCESSING" — enforced by `Order.cancel()` itself
 * (`OrderCancellationNotAllowedError` otherwise), not re-checked here.
 *
 * Every item's stock is restored in the same transaction as the status
 * write — the exact inverse of `PlaceOrderUseCase`'s decrement, on the same
 * `leenmart_checkout` credential, so a restore failure rolls the
 * cancellation back rather than leaving stock permanently short.
 *
 * No `AuditWriter` call, matching `PlaceOrderUseCase`'s own reasoning: this
 * is a customer self-service action, not an admin one, and SDD 18.4's
 * audit-log list never names it. An `OrderCancelled` outbox event is still
 * written — SDD's own module table names it as one of `order`'s published
 * events, and writing the row costs nothing beyond what `OrderPlaced`
 * already established.
 */
export class CancelOrderUseCase {
  constructor(private readonly deps: CancelOrderDeps) {}

  async execute(input: CancelOrderInput): Promise<Order> {
    const { orderRepository, inventoryRepository, outboxWriter, transactionRunner, clock, logger } =
      this.deps;
    const { principal, orderId } = input;

    return transactionRunner.run(async (scope) => {
      const repository = orderRepository.withTransaction(scope);
      const order = await repository.findByIdAndCustomerId(orderId, principal.userId);
      if (!order) {
        throw new OrderNotFoundError();
      }

      const now = clock.now();
      // Order.cancel() throws OrderCancellationNotAllowedError if any
      // sub-order has reached PROCESSING — the approved rule, enforced by
      // the aggregate itself.
      const cancelled = order.cancel(now);
      await repository.updateStatus(cancelled);

      const inventory = inventoryRepository.withTransaction(scope);
      for (const subOrder of cancelled.subOrders) {
        for (const item of subOrder.items) {
          await inventory.restoreAvailability(item.variantId, item.quantity);
        }
      }

      await outboxWriter.withTransaction(scope).write({
        aggregateType: ORDER_AUDIT_ENTITY_TYPES.ORDER,
        aggregateId: toUuid(cancelled.id),
        eventType: ORDER_AUDIT_ACTIONS.CANCELLED,
        payload: { orderId: cancelled.id, customerId: principal.userId },
      });

      logger.info({ orderId: cancelled.id }, 'Order cancelled by customer');
      return cancelled;
    });
  }
}
