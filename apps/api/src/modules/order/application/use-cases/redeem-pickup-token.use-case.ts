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
  PickupTokenInvalidError,
  SubOrderConcurrentlyModifiedError,
} from '../../domain/errors/order-errors.js';
import type {
  VendorOrderRepository,
  VendorSubOrderDetail,
} from '../../domain/repositories/vendor-order.repository.js';
import type { PickupTokenRepository } from '../../domain/repositories/pickup-token.repository.js';
import { requireActiveVendor } from '../support/require-active-vendor.js';
import type { PickupTokenSigner } from '../ports/pickup-token-signer.port.js';

export interface RedeemPickupTokenInput {
  readonly principal: Principal;
  readonly token: string;
}

export interface RedeemPickupTokenDeps {
  readonly vendorRepository: VendorRepository;
  readonly vendorOrderRepository: VendorOrderRepository;
  /** Bound to the tenant-scoped `leenmart_app` client — RLS confines every row to the caller's own `vendor_id`, per the port's own doc comment. */
  readonly pickupTokenRepository: PickupTokenRepository;
  readonly pickupTokenSigner: PickupTokenSigner;
  readonly outboxWriter: OutboxWriter;
  readonly auditWriter: AuditWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * The one and only path to `COMPLETED` (S4-QR, SDD §13.2–13.3, locked
 * decision #10) — a vendor scans a customer's QR code, this verifies the
 * token and atomically redeems it, and only *then* does the `SubOrder`
 * itself transition.
 *
 * Every failure short of a completed redemption collapses to the one uniform
 * `PickupTokenInvalidError` (SEC-15, `PickupTokenSigner.verify()`'s own doc
 * comment) — a bad signature, an expired token, a token whose `nonce` no
 * longer matches the row (rotated out from under it), no row at all, a row
 * RLS hides because it belongs to another vendor, **and a token that has
 * already been consumed** all read identically to the caller. That last one
 * includes replay by the token's own vendor: the response reveals neither
 * that the sub-order is `COMPLETED`, nor that the token was ever valid, nor
 * when it was redeemed. This is what makes the "wrong vendor", "wrong
 * sub-order" and "already redeemed" mandatory test scenarios
 * indistinguishable from "forged token" at the response level, which is the
 * whole point: a vendor probing with someone else's sub-order id learns
 * nothing they didn't already know.
 *
 * The atomic `pickup_tokens` compare-and-set
 * (`PickupTokenRepository.redeemIfIssued`, locked decision #17) is what
 * actually makes concurrent redemption impossible, and it is the first write
 * this use case performs — see `execute` for why that ordering is what
 * delivers both the uniform replay response and the single-success
 * guarantee. `SubOrder.completePickup()`'s own version-guarded write is a
 * second, defensive guard, the same belt-and-braces shape every other
 * vendor-order mutation in this module already uses.
 */
export class RedeemPickupTokenUseCase {
  constructor(private readonly deps: RedeemPickupTokenDeps) {}

  /**
   * The outbox event and audit record for a completed pickup, written in the
   * same transaction as the transition itself — split out of `execute` only
   * to keep it within this repository's function-length budget.
   */
  private async recordCompletion(
    scope: TransactionScope,
    principal: Principal,
    completed: VendorSubOrderDetail['subOrder'],
  ): Promise<void> {
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
      action: ORDER_AUDIT_ACTIONS.PICKUP_COMPLETED,
      entityType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
      entityId: toUuid(completed.id),
      before: { status: 'READY_FOR_PICKUP' },
      after: { status: 'COMPLETED' },
    });
  }

  async execute(input: RedeemPickupTokenInput): Promise<VendorSubOrderDetail> {
    const {
      vendorRepository,
      vendorOrderRepository,
      pickupTokenRepository,
      pickupTokenSigner,
      transactionRunner,
      clock,
      logger,
    } = this.deps;
    const { principal, token } = input;

    const vendor = await requireActiveVendor(vendorRepository, principal.userId);

    // Signature/expiry/audience verification is a pure, stateless check —
    // deliberately done before opening a transaction, the same as every
    // other use case in this codebase that validates input before touching
    // the database.
    const payload = pickupTokenSigner.verify(token);

    return transactionRunner.run(async (scope) => {
      const pickupTokens = pickupTokenRepository.withTransaction(scope);
      const pickupToken = await pickupTokens.findBySubOrderId(payload.subOrderId);
      // No row, a stale/rotated-out nonce, or (redundantly, alongside RLS)
      // a row belonging to another vendor — all refused the same uniform
      // way. `vendorId` is denormalised onto `pickup_tokens` specifically so
      // this check needs no join.
      if (
        !pickupToken ||
        pickupToken.nonce !== payload.nonce ||
        pickupToken.vendorId !== vendor.id
      ) {
        throw new PickupTokenInvalidError();
      }

      const now = clock.now();

      // The atomic `ISSUED -> REDEEMED` compare-and-set is both the single-use
      // mechanism (locked decision #17) and the **first** thing this
      // transaction writes. Two properties follow, and the ordering is what
      // buys them:
      //
      //  - Consuming a token that is no longer `ISSUED` is indistinguishable
      //    from a forged one. Redemption is what drives a pickup to
      //    `COMPLETED`, so a replay by the token's own vendor would otherwise
      //    reach `completePickup()` below and be refused with the real
      //    transition reason — disclosing that the sub-order is already
      //    `COMPLETED`, that the token was previously valid, and when it was
      //    consumed. Failing here instead says only `PICKUP_TOKEN_INVALID`,
      //    exactly as a forged, expired, rotated-out or wrong-vendor token
      //    does.
      //  - A concurrent redemption blocks on this row's lock and re-evaluates
      //    the `status = 'ISSUED'` predicate once the winner commits, so it
      //    matches zero rows and never touches the `SubOrder` at all. Exactly
      //    one caller completes, and only that caller writes audit/outbox.
      //
      // Nothing is disclosed by moving it earlier: every check before it is
      // already collapsed into the same uniform failure, and the whole body
      // is one transaction — a later failure rolls the CAS back, leaving the
      // token `ISSUED` for a legitimate retry.
      const redeemed = await pickupTokens.redeemIfIssued(pickupToken.id, now, principal.userId);
      if (!redeemed) {
        throw new PickupTokenInvalidError();
      }

      const repository = vendorOrderRepository.withTransaction(scope);
      const detail = await repository.findDetailById(payload.subOrderId);
      if (!detail) {
        throw new PickupTokenInvalidError();
      }

      // Defence in depth behind the CAS: `SubOrder.completePickup()` throws
      // FulfilmentModeMismatchError for a DELIVERY sub-order and
      // InvalidOrderStatusTransitionError for anything but
      // READY_FOR_PICKUP, both enforced by the entity itself. Neither is
      // reachable for an already-completed pickup any more — that token is
      // `REDEEMED` and fails the CAS above.
      const completed = detail.subOrder.completePickup(now);

      const updated = await repository.updateStatusIfVersionMatches(
        completed,
        detail.subOrder.version,
      );
      if (!updated) {
        throw new SubOrderConcurrentlyModifiedError();
      }

      await this.recordCompletion(scope, principal, completed);
      logger.info(
        { subOrderId: completed.id, orderId: completed.orderId },
        'Vendor redeemed a customer pickup token',
      );
      return { subOrder: completed, address: detail.address };
    });
  }
}
