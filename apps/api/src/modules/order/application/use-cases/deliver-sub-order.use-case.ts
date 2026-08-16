import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import type { VendorRepository } from '../../../vendor/domain/repositories/vendor.repository.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import { ORDER_AUDIT_ACTIONS, ORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import {
  SubOrderConcurrentlyModifiedError,
  SubOrderNotFoundError,
} from '../../domain/errors/order-errors.js';
import type {
  VendorOrderRepository,
  VendorSubOrderDetail,
} from '../../domain/repositories/vendor-order.repository.js';
import type { SubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';
import { requireActiveVendor } from '../support/require-active-vendor.js';

export interface DeliverSubOrderInput {
  readonly principal: Principal;
  readonly subOrderId: SubOrderId;
}

export interface DeliverSubOrderDeps {
  readonly vendorRepository: VendorRepository;
  readonly vendorOrderRepository: VendorOrderRepository;
  readonly outboxWriter: OutboxWriter;
  readonly auditWriter: AuditWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Vendor-initiated `SHIPPED -> DELIVERED` (S3-6, `UPDATE_ORDER_FULFILMENT`
 * — delivery-mode fulfilment completion, locked decision #3). Structurally
 * identical to `ShipSubOrderUseCase`/`StartProcessingUseCase` (S3-5) — reuses
 * `SubOrder.deliver()` as the domain transition rather than re-implementing
 * the state machine.
 *
 * `DELIVERED` is this milestone's terminal state (locked decision #22:
 * settlement release on delivery is explicitly out of scope) — this use
 * case writes the status change, an outbox event and an audit record and
 * nothing else. No customer confirmation step exists (locked decision #1's
 * scope boundary; the discovery report's SEC-04-analogous fraud-control gap
 * for delivery-mode is explicitly not addressed here).
 *
 * The parent `Order.status` is never read or written here (locked decision
 * #7). Inventory is never touched (locked decision #17).
 */
export class DeliverSubOrderUseCase {
  constructor(private readonly deps: DeliverSubOrderDeps) {}

  async execute(input: DeliverSubOrderInput): Promise<VendorSubOrderDetail> {
    const {
      vendorRepository,
      vendorOrderRepository,
      outboxWriter,
      auditWriter,
      transactionRunner,
      clock,
      logger,
    } = this.deps;
    const { principal, subOrderId } = input;

    await requireActiveVendor(vendorRepository, principal.userId);

    return transactionRunner.run(async (scope) => {
      const repository = vendorOrderRepository.withTransaction(scope);
      const detail = await repository.findDetailById(subOrderId);
      if (!detail) {
        throw new SubOrderNotFoundError();
      }

      const now = clock.now();
      // SubOrder.deliver() throws InvalidOrderStatusTransitionError for
      // anything but SHIPPED — the approved rule, enforced by the entity
      // itself.
      const delivered = detail.subOrder.deliver(now);

      const updated = await repository.updateStatusIfVersionMatches(
        delivered,
        detail.subOrder.version,
      );
      if (!updated) {
        throw new SubOrderConcurrentlyModifiedError();
      }

      await outboxWriter.withTransaction(scope).write({
        aggregateType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
        aggregateId: toUuid(delivered.id),
        eventType: ORDER_AUDIT_ACTIONS.DELIVERED,
        payload: {
          subOrderId: delivered.id,
          orderId: delivered.orderId,
          vendorId: delivered.vendorId,
        },
      });

      await auditWriter.withTransaction(scope).record({
        actorId: principal.userId,
        actorRole: principal.role,
        action: ORDER_AUDIT_ACTIONS.DELIVERED,
        entityType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
        entityId: toUuid(delivered.id),
        before: { status: 'SHIPPED' },
        after: { status: 'DELIVERED' },
      });

      logger.info(
        { subOrderId: delivered.id, orderId: delivered.orderId },
        'Vendor marked their sub-order delivered',
      );
      // The address snapshot cannot change between the read above and here —
      // it is immutable once the order is placed — so returning it from the
      // earlier fetch is exactly as accurate as re-reading it would be.
      return { subOrder: delivered, address: detail.address };
    });
  }
}
