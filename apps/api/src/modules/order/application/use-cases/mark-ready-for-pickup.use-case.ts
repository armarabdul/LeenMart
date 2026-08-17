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

export interface MarkReadyForPickupInput {
  readonly principal: Principal;
  readonly subOrderId: SubOrderId;
}

export interface MarkReadyForPickupDeps {
  readonly vendorRepository: VendorRepository;
  readonly vendorOrderRepository: VendorOrderRepository;
  readonly outboxWriter: OutboxWriter;
  readonly auditWriter: AuditWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Vendor-initiated `PROCESSING -> READY_FOR_PICKUP` (S4-QR,
 * `UPDATE_ORDER_FULFILMENT` — the same permission `ShipSubOrderUseCase`
 * already uses, since this is the pickup-mode analogue of "I've prepared
 * this order," not a new capability). Structurally identical to
 * `ShipSubOrderUseCase` — reuses `SubOrder.markReadyForPickup()` as the
 * domain transition (which itself refuses a `DELIVERY` sub-order via
 * `FulfilmentModeMismatchError`) rather than re-implementing either guard
 * here.
 *
 * The parent `Order.status` is never read or written here (locked decision
 * #7). Inventory is never touched (locked decision #21). This is *not* the
 * transition that completes a pickup — `COMPLETED` is reachable only through
 * `RedeemPickupTokenUseCase`'s atomic token redemption (locked decision
 * #10).
 */
export class MarkReadyForPickupUseCase {
  constructor(private readonly deps: MarkReadyForPickupDeps) {}

  async execute(input: MarkReadyForPickupInput): Promise<VendorSubOrderDetail> {
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
      // SubOrder.markReadyForPickup() throws FulfilmentModeMismatchError for
      // a DELIVERY sub-order and InvalidOrderStatusTransitionError for
      // anything but PROCESSING — both enforced by the entity itself.
      const readyForPickup = detail.subOrder.markReadyForPickup(now);

      const updated = await repository.updateStatusIfVersionMatches(
        readyForPickup,
        detail.subOrder.version,
      );
      if (!updated) {
        throw new SubOrderConcurrentlyModifiedError();
      }

      await outboxWriter.withTransaction(scope).write({
        aggregateType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
        aggregateId: toUuid(readyForPickup.id),
        eventType: ORDER_AUDIT_ACTIONS.READY_FOR_PICKUP,
        payload: {
          subOrderId: readyForPickup.id,
          orderId: readyForPickup.orderId,
          vendorId: readyForPickup.vendorId,
        },
      });

      await auditWriter.withTransaction(scope).record({
        actorId: principal.userId,
        actorRole: principal.role,
        action: ORDER_AUDIT_ACTIONS.READY_FOR_PICKUP,
        entityType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
        entityId: toUuid(readyForPickup.id),
        before: { status: 'PROCESSING' },
        after: { status: 'READY_FOR_PICKUP' },
      });

      logger.info(
        { subOrderId: readyForPickup.id, orderId: readyForPickup.orderId },
        'Vendor marked their pickup sub-order ready for pickup',
      );
      // The address snapshot cannot change between the read above and here —
      // it is immutable once the order is placed — so returning it from the
      // earlier fetch is exactly as accurate as re-reading it would be.
      return { subOrder: readyForPickup, address: detail.address };
    });
  }
}
