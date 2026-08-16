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

export interface StartProcessingInput {
  readonly principal: Principal;
  readonly subOrderId: SubOrderId;
}

export interface StartProcessingDeps {
  readonly vendorRepository: VendorRepository;
  readonly vendorOrderRepository: VendorOrderRepository;
  readonly outboxWriter: OutboxWriter;
  readonly auditWriter: AuditWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Vendor-initiated `CONFIRMED -> PROCESSING` (S3-5, `ACCEPT_OR_REJECT_ORDER`
 * — accept/process only, per the locked decision; there is no reject/
 * cancel path here). Reuses `SubOrder.startProcessing()` as the domain
 * transition rather than re-implementing the state machine — the same
 * `InvalidOrderStatusTransitionError` it already throws for any status but
 * `CONFIRMED` is what a vendor retrying a stale page, or racing a customer's
 * cancellation into `CANCELLED` first, will see.
 *
 * The parent `Order.status` is never read or written here (locked decision
 * #1): `PROCESSING` is a `SubOrder`-level fact only in S3-5, so this use
 * case never touches the `orders` row at all.
 *
 * Both an outbox event and an `AuditWriter` record are written, in the same
 * transaction as the status change (locked decision #8) — this module's
 * first genuine `AuditWriter` call (see `ORDER_AUDIT_ACTIONS.PROCESSING_STARTED`'s
 * own comment for why this action, unlike every prior order action, is
 * audited).
 */
export class StartProcessingUseCase {
  constructor(private readonly deps: StartProcessingDeps) {}

  async execute(input: StartProcessingInput): Promise<VendorSubOrderDetail> {
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
      // SubOrder.startProcessing() throws InvalidOrderStatusTransitionError
      // for anything but CONFIRMED — the approved rule, enforced by the
      // entity itself, exactly like Order.cancel()'s own PROCESSING guard.
      const processing = detail.subOrder.startProcessing(now);

      const updated = await repository.updateStatusIfVersionMatches(
        processing,
        detail.subOrder.version,
      );
      if (!updated) {
        throw new SubOrderConcurrentlyModifiedError();
      }

      await outboxWriter.withTransaction(scope).write({
        aggregateType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
        aggregateId: toUuid(processing.id),
        eventType: ORDER_AUDIT_ACTIONS.PROCESSING_STARTED,
        payload: {
          subOrderId: processing.id,
          orderId: processing.orderId,
          vendorId: processing.vendorId,
        },
      });

      await auditWriter.withTransaction(scope).record({
        actorId: principal.userId,
        actorRole: principal.role,
        action: ORDER_AUDIT_ACTIONS.PROCESSING_STARTED,
        entityType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
        entityId: toUuid(processing.id),
        before: { status: 'CONFIRMED' },
        after: { status: 'PROCESSING' },
      });

      logger.info(
        { subOrderId: processing.id, orderId: processing.orderId },
        'Vendor started processing their sub-order',
      );
      // The address snapshot cannot change between the read above and here —
      // it is immutable once the order is placed — so returning it from the
      // earlier fetch is exactly as accurate as re-reading it would be.
      return { subOrder: processing, address: detail.address };
    });
  }
}
