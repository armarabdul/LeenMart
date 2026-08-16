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

export interface ShipSubOrderInput {
  readonly principal: Principal;
  readonly subOrderId: SubOrderId;
}

export interface ShipSubOrderDeps {
  readonly vendorRepository: VendorRepository;
  readonly vendorOrderRepository: VendorOrderRepository;
  readonly outboxWriter: OutboxWriter;
  readonly auditWriter: AuditWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Vendor-initiated `PROCESSING -> SHIPPED` (S3-6, `UPDATE_ORDER_FULFILMENT`
 * — delivery-mode fulfilment completion, locked decision #3). Structurally
 * identical to `StartProcessingUseCase` (S3-5) — reuses `SubOrder.ship()` as
 * the domain transition rather than re-implementing the state machine, and
 * follows the same read/transition/version-guarded-write/outbox/audit shape.
 *
 * The parent `Order.status` is never read or written here (locked decision
 * #7): fulfilment is a `SubOrder`-level fact only, exactly as `PROCESSING`
 * already was. Inventory is never touched (locked decision #17) — stock was
 * already permanently decremented at order placement.
 */
export class ShipSubOrderUseCase {
  constructor(private readonly deps: ShipSubOrderDeps) {}

  async execute(input: ShipSubOrderInput): Promise<VendorSubOrderDetail> {
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
      // SubOrder.ship() throws InvalidOrderStatusTransitionError for
      // anything but PROCESSING — the approved rule, enforced by the entity
      // itself, exactly like startProcessing()'s own CONFIRMED guard.
      const shipped = detail.subOrder.ship(now);

      const updated = await repository.updateStatusIfVersionMatches(
        shipped,
        detail.subOrder.version,
      );
      if (!updated) {
        throw new SubOrderConcurrentlyModifiedError();
      }

      await outboxWriter.withTransaction(scope).write({
        aggregateType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
        aggregateId: toUuid(shipped.id),
        eventType: ORDER_AUDIT_ACTIONS.SHIPPED,
        payload: {
          subOrderId: shipped.id,
          orderId: shipped.orderId,
          vendorId: shipped.vendorId,
        },
      });

      await auditWriter.withTransaction(scope).record({
        actorId: principal.userId,
        actorRole: principal.role,
        action: ORDER_AUDIT_ACTIONS.SHIPPED,
        entityType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
        entityId: toUuid(shipped.id),
        before: { status: 'PROCESSING' },
        after: { status: 'SHIPPED' },
      });

      logger.info(
        { subOrderId: shipped.id, orderId: shipped.orderId },
        'Vendor marked their sub-order shipped',
      );
      // The address snapshot cannot change between the read above and here —
      // it is immutable once the order is placed — so returning it from the
      // earlier fetch is exactly as accurate as re-reading it would be.
      return { subOrder: shipped, address: detail.address };
    });
  }
}
