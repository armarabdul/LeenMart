import {
  toUuid,
  type Clock,
  type Logger,
  type TransactionRunner,
  type TransactionScope,
} from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import type { VendorRepository } from '../../../vendor/domain/repositories/vendor.repository.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import { ORDER_AUDIT_ACTIONS, ORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import {
  PickupTokenAlreadyRedeemedError,
  PickupTokenInvalidError,
  SubOrderConcurrentlyModifiedError,
  SubOrderNotFoundError,
} from '../../domain/errors/order-errors.js';
import type {
  VendorOrderRepository,
  VendorSubOrderDetail,
} from '../../domain/repositories/vendor-order.repository.js';
import type { PickupToken } from '../../domain/entities/pickup-token.entity.js';
import type { PickupTokenRepository } from '../../domain/repositories/pickup-token.repository.js';
import type { SubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';
import { requireActiveVendor } from '../support/require-active-vendor.js';
import type { PickupCodeHasher } from '../ports/pickup-code-hasher.port.js';
import type { VendorProfile } from '../../../vendor/domain/entities/vendor-profile.entity.js';

export interface CompletePickupManuallyInput {
  readonly principal: Principal;
  readonly subOrderId: SubOrderId;
  readonly code: string;
}

export interface CompletePickupManuallyDeps {
  readonly vendorRepository: VendorRepository;
  readonly vendorOrderRepository: VendorOrderRepository;
  /** Bound to the tenant-scoped `leenmart_app` client — same as `RedeemPickupTokenUseCase`'s own dependency. */
  readonly pickupTokenRepository: PickupTokenRepository;
  readonly pickupCodeHasher: PickupCodeHasher;
  readonly outboxWriter: OutboxWriter;
  readonly auditWriter: AuditWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * The scanner-broken fallback (S4-QR-FALLBACK, SDD 13.3's "Manual completion
 * by the vendor plus a 4-digit code read from the customer's screen" row) —
 * an alternate path to the exact same `READY_FOR_PICKUP -> COMPLETED`
 * transition `RedeemPickupTokenUseCase` performs, reusing its atomic
 * `redeemIfIssued` compare-and-set as the single source of truth for
 * single-use redemption (locked scope: "do not invent a second server-side
 * redemption mechanism").
 *
 * Unlike the QR path, this is addressed by `subOrderId` — a client-supplied
 * `:id`, the same shape every other vendor-order route in this module
 * already accepts (`ship`, `deliver`, `ready-for-pickup`). Ownership is
 * therefore proven the same way those routes prove it: an RLS-scoped
 * `findDetailById` miss and a `pickupToken.vendorId` mismatch both collapse
 * to `SubOrderNotFoundError` (SEC-06 — never distinguishes "no such
 * sub-order" from "not yours"), *not* `PickupTokenInvalidError`. That
 * error is reserved for failures reachable only once ownership of this
 * `:id` is already established: no code has ever been issued, too many wrong
 * guesses, or a wrong guess just now — all deliberately collapsed into one
 * uniform response (SEC-15), the same reasoning the QR path's own doc
 * comment gives for its own single failure shape.
 */
export class CompletePickupManuallyUseCase {
  constructor(private readonly deps: CompletePickupManuallyDeps) {}

  private async recordCompletion(
    scope: TransactionScope,
    principal: Principal,
    completed: VendorSubOrderDetail['subOrder'],
  ): Promise<void> {
    // Same outbox `eventType` as the QR path — the domain fact (a pickup
    // completed) is identical; only the audit trail needs to know *how*.
    await this.deps.outboxWriter.withTransaction(scope).write({
      aggregateType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
      aggregateId: toUuid(completed.id),
      eventType: ORDER_AUDIT_ACTIONS.PICKUP_COMPLETED,
      payload: {
        subOrderId: completed.id,
        orderId: completed.orderId,
        vendorId: completed.vendorId,
      },
    });

    await this.deps.auditWriter.withTransaction(scope).record({
      actorId: principal.userId,
      actorRole: principal.role,
      action: ORDER_AUDIT_ACTIONS.PICKUP_COMPLETED_MANUAL,
      entityType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
      entityId: toUuid(completed.id),
      before: { status: 'READY_FOR_PICKUP' },
      after: { status: 'COMPLETED' },
    });
  }

  /**
   * Everything that must happen *before* any transaction opens (split out
   * purely to keep `execute` under this file's function-length budget):
   * ownership resolution and the code check itself. A wrong guess has to
   * persist its incremented attempt count even though this whole call ends
   * in a thrown error, so none of this may run inside the transaction that
   * `execute` opens afterward — nesting it would let a rollback silently
   * discard every failed attempt ever recorded. Nothing here is the actual
   * security boundary — that is still the atomic CAS `execute` performs
   * next, exactly as the QR path's own pre-transaction signature check is
   * never itself the source of the single-use guarantee.
   */
  private async verifyOwnershipAndCode(
    input: CompletePickupManuallyInput,
    vendor: VendorProfile,
  ): Promise<{ detail: VendorSubOrderDetail; pickupToken: PickupToken }> {
    const { vendorOrderRepository, pickupTokenRepository, pickupCodeHasher, logger } = this.deps;
    const { subOrderId, code } = input;

    const detail = await vendorOrderRepository.findDetailById(subOrderId);
    if (!detail) {
      throw new SubOrderNotFoundError();
    }

    const pickupToken = await pickupTokenRepository.findBySubOrderId(subOrderId);
    // No token ever issued, or (redundantly, alongside RLS) issued for
    // another vendor entirely — both refused the same way `findDetailById`
    // above already would have been, matching this router's own
    // established "not found or not yours" collapse.
    if (!pickupToken || pickupToken.vendorId !== vendor.id) {
      throw new SubOrderNotFoundError();
    }

    // `PickupToken.redeem()`/`rotate()` already throw this once `status`
    // isn't `ISSUED` — checked explicitly here too so a stale completion
    // never spends an attempt or reaches the hasher for a code that could
    // not possibly still be current.
    if (pickupToken.status !== 'ISSUED') {
      throw new PickupTokenAlreadyRedeemedError();
    }
    if (!pickupToken.manualCodeHash || pickupToken.hasExceededManualCodeAttempts()) {
      throw new PickupTokenInvalidError();
    }

    const isValid = await pickupCodeHasher.verify(pickupToken.manualCodeHash, code);
    if (!isValid) {
      const incremented = pickupToken.recordFailedManualCodeAttempt();
      // The base (non-transactional) repository — commits on its own,
      // independent of whatever this call does next.
      await pickupTokenRepository.recordManualCodeAttempt(
        pickupToken.id,
        incremented.manualCodeAttempts,
      );
      logger.warn(
        { subOrderId, vendorId: vendor.id },
        'Manual pickup completion refused: wrong code',
      );
      throw new PickupTokenInvalidError();
    }

    return { detail, pickupToken };
  }

  async execute(input: CompletePickupManuallyInput): Promise<VendorSubOrderDetail> {
    const {
      vendorRepository,
      vendorOrderRepository,
      pickupTokenRepository,
      transactionRunner,
      clock,
      logger,
    } = this.deps;
    const { principal } = input;

    const vendor = await requireActiveVendor(vendorRepository, principal.userId);
    const { detail, pickupToken } = await this.verifyOwnershipAndCode(input, vendor);
    const now = clock.now();

    return transactionRunner.run(async (scope) => {
      const pickupTokens = pickupTokenRepository.withTransaction(scope);

      // The same atomic `ISSUED -> REDEEMED` compare-and-set the QR path
      // uses (locked decision: no second redemption mechanism). A `false`
      // here means the token was redeemed — online, or by a concurrent
      // manual attempt — in the moment between the code check above and
      // this statement; the vendor has already proven legitimate knowledge
      // of the code, so this is reported as a genuine race, not folded into
      // the uniform `PickupTokenInvalidError` above.
      const redeemed = await pickupTokens.redeemIfIssued(pickupToken.id, now, principal.userId);
      if (!redeemed) {
        throw new PickupTokenAlreadyRedeemedError();
      }

      const orderRepository = vendorOrderRepository.withTransaction(scope);

      // Defence in depth behind the CAS, exactly mirroring
      // `RedeemPickupTokenUseCase`: throws for a DELIVERY sub-order or
      // anything but READY_FOR_PICKUP, neither reachable here since the CAS
      // above already proved this token was still ISSUED.
      const completed = detail.subOrder.completePickup(now);

      const updated = await orderRepository.updateStatusIfVersionMatches(
        completed,
        detail.subOrder.version,
      );
      if (!updated) {
        throw new SubOrderConcurrentlyModifiedError();
      }

      await this.recordCompletion(scope, principal, completed);
      logger.info(
        { subOrderId: completed.id, orderId: completed.orderId },
        'Vendor completed a customer pickup via the manual fallback code',
      );
      return { subOrder: completed, address: detail.address };
    });
  }
}
