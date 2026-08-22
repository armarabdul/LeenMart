import {
  toUuid,
  type Clock,
  type Logger,
  type TransactionRunner,
  type TransactionScope,
} from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import type { PreorderPaymentAttempt } from '../../domain/entities/preorder-payment-attempt.entity.js';
import type { PreorderReservation } from '../../domain/entities/preorder-reservation.entity.js';
import {
  ReservationBalanceNotDueError,
  ReservationNotFoundError,
  ReservationNotPendingError,
  ReservationPaymentAttemptNotFoundError,
  ReservationPaymentFailedError,
} from '../../domain/errors/preorder-errors.js';
import { PREORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import { PREORDER_OUTBOX_EVENTS } from '../../domain/outbox-events.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { PaymentAttemptRepository } from '../../domain/repositories/payment-attempt.repository.js';
import type { ReservationRepository } from '../../domain/repositories/reservation.repository.js';
import type { CampaignId } from '../../domain/value-objects/campaign-id.value-object.js';
import type { ReservationId } from '../../domain/value-objects/reservation-id.value-object.js';
import type {
  PreorderPaymentGateway,
  PreorderPaymentTestScenario,
} from '../ports/preorder-payment-gateway.port.js';
import type { InitiateReservationPaymentKind } from './initiate-reservation-payment.use-case.js';
import type { RedisCampaignQuotaGate } from '../../infrastructure/cache/redis-campaign-quota-gate.js';

export interface ConfirmReservationPaymentInput {
  readonly customerId: UserId;
  readonly reservationId: ReservationId;
  readonly kind: InitiateReservationPaymentKind;
  readonly testScenario?: PreorderPaymentTestScenario;
}

export interface ConfirmReservationPaymentDeps {
  readonly reservationRepository: ReservationRepository;
  readonly campaignRepository: CampaignRepository;
  readonly paymentAttemptRepository: PaymentAttemptRepository;
  readonly preorderPaymentGateway: PreorderPaymentGateway;
  readonly quotaGate: RedisCampaignQuotaGate;
  readonly outboxWriter: OutboxWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

type ConfirmOutcome =
  | { readonly kind: 'succeeded'; readonly reservation: PreorderReservation }
  | {
      readonly kind: 'failed';
      /** Set only when this attempt actually released the hold (the ADVANCE failure path) — tells `execute()` whether to also touch Redis, post-commit. */
      readonly released: { readonly campaignId: CampaignId; readonly quantity: number } | null;
    };

/**
 * Resolves the caller's own currently-`INITIATED` payment attempt for one
 * reservation and, on success, advances the reservation — mirrors
 * `ConfirmPaymentUseCase` exactly, including its most load-bearing property:
 * **both outcomes commit the same transaction.** A failed attempt must be
 * durably recorded `FAILED` (freeing the slot for a retry) even though this
 * call still reports an error — throwing *inside* `transactionRunner.run`
 * would roll that write back and leave the attempt stuck `INITIATED`
 * forever. Only the outer `execute()` decides afterward whether to throw.
 *
 * `ADVANCE` success uses `reservationRepository.updateIfStatus(reservation,
 * 'PENDING')` — the same conditional-transition guard `create-reservation`'s
 * own doc comment calls "only the current owner of the transition can
 * perform the release": if the TTL expiry sweep has already flipped this row
 * to `EXPIRED` between this use case's read and write, the guard returns
 * `false` and this call loses the race cleanly rather than silently
 * resurrecting an expired reservation.
 *
 * `BALANCE` success has no status transition to guard (the reservation stays
 * `CONFIRMED` throughout) — double-payment is guarded by re-checking
 * `hasOutstandingBalance()` fresh inside the transaction, backed by the
 * existing Idempotency-Key middleware at the route layer for true
 * duplicate-request protection.
 */
export class ConfirmReservationPaymentUseCase {
  constructor(private readonly deps: ConfirmReservationPaymentDeps) {}

  async execute(input: ConfirmReservationPaymentInput): Promise<PreorderReservation> {
    const { transactionRunner, quotaGate, logger } = this.deps;
    const { reservationId, kind } = input;

    const outcome = await transactionRunner.run<ConfirmOutcome>((scope) =>
      this.resolveInTransaction(scope, input),
    );

    if (outcome.kind === 'failed') {
      if (outcome.released) {
        // Post-commit, mirroring `CancelReservationUseCase` — Postgres
        // remains authoritative regardless; this only keeps the fast
        // admission gate from staying artificially low until the next
        // reconciliation tick (`quotaGate.release()`'s own doc comment).
        await quotaGate
          .release(outcome.released.campaignId, outcome.released.quantity)
          .catch((error: unknown) => {
            logger.error(
              { err: error, reservationId },
              'Failed to release quota-gate compensation',
            );
          });
      }
      logger.info({ reservationId, kind }, 'Reservation payment attempt failed');
      throw new ReservationPaymentFailedError();
    }

    logger.info({ reservationId: outcome.reservation.id, kind }, 'Reservation payment confirmed');
    return outcome.reservation;
  }

  /** Ownership/status/attempt resolution ahead of the gateway call — split out purely to keep `resolveInTransaction` within this repository's complexity budget. */
  private async loadReservationAndAttempt(
    scope: TransactionScope,
    input: ConfirmReservationPaymentInput,
  ): Promise<{
    readonly reservation: PreorderReservation;
    readonly attempt: PreorderPaymentAttempt;
  }> {
    const { reservationRepository, paymentAttemptRepository } = this.deps;
    const { customerId, reservationId, kind } = input;

    const reservations = reservationRepository.withTransaction(scope);
    const reservation = await reservations.findByIdAndCustomerId(reservationId, customerId);
    if (!reservation) throw new ReservationNotFoundError();

    if (kind === 'ADVANCE') {
      if (reservation.status.name !== 'PENDING') {
        throw new ReservationNotPendingError(reservation.status.name);
      }
    } else if (reservation.status.name !== 'CONFIRMED' || !reservation.hasOutstandingBalance()) {
      throw new ReservationBalanceNotDueError();
    }

    const attempts = paymentAttemptRepository.withTransaction(scope);
    const attempt = await attempts.findInitiatedByReservationAndKind(reservationId, kind);
    if (!attempt) throw new ReservationPaymentAttemptNotFoundError();

    return { reservation, attempt };
  }

  /** The gateway-failed branch — split out for the same reason `loadReservationAndAttempt` was. */
  private async handleGatewayFailure(
    scope: TransactionScope,
    input: ConfirmReservationPaymentInput,
    reservation: PreorderReservation,
    now: Date,
  ): Promise<ConfirmOutcome> {
    const { reservationRepository, campaignRepository, outboxWriter } = this.deps;
    const { customerId, reservationId, kind } = input;
    const reservations = reservationRepository.withTransaction(scope);

    await outboxWriter.withTransaction(scope).write({
      aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
      aggregateId: toUuid(reservation.campaignId),
      eventType:
        kind === 'ADVANCE'
          ? PREORDER_OUTBOX_EVENTS.RESERVATION_PAYMENT_FAILED_ADVANCE
          : PREORDER_OUTBOX_EVENTS.RESERVATION_PAYMENT_FAILED_BALANCE,
      payload: { campaignId: reservation.campaignId, reservationId, customerId, kind },
    });

    if (kind === 'ADVANCE') {
      // The advance failed — the hold is released, exactly as expiry does.
      const failedReservation = reservation.failPayment(now);
      const applied = await reservations.updateIfStatus(failedReservation, 'PENDING');
      if (applied) {
        const campaigns = campaignRepository.withTransaction(scope);
        await campaigns.incrementRemaining(reservation.campaignId, reservation.quantity);
        return {
          kind: 'failed',
          released: { campaignId: reservation.campaignId, quantity: reservation.quantity },
        };
      }
    }

    return { kind: 'failed', released: null };
  }

  /** The `ADVANCE`-success branch — split out for the same reason `loadReservationAndAttempt` was. */
  private async handleAdvanceSuccess(
    scope: TransactionScope,
    input: ConfirmReservationPaymentInput,
    reservation: PreorderReservation,
    now: Date,
  ): Promise<ConfirmOutcome> {
    const { reservationRepository, campaignRepository, outboxWriter } = this.deps;
    const { customerId, reservationId } = input;
    const reservations = reservationRepository.withTransaction(scope);

    const confirmedReservation = reservation.confirm(now);
    const applied = await reservations.updateIfStatus(confirmedReservation, 'PENDING');
    if (!applied) {
      // Lost the race to the expiry sweep — the advance succeeded but the
      // hold is already gone. Reported as a failed confirmation; the
      // customer's money was never actually captured by a real gateway in
      // this milestone (mock only), so there is nothing to reconcile here.
      // No `released` payload: the expiry sweep that won the race already
      // owns the compensating Redis release for this quantity.
      return { kind: 'failed', released: null };
    }

    const campaigns = campaignRepository.withTransaction(scope);
    const campaign = await campaigns.findById(reservation.campaignId);
    if (campaign && !campaign.isFrozen()) {
      await campaigns.update(campaign.markFirstReservationConfirmed(now));
    }

    await outboxWriter.withTransaction(scope).write({
      aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
      aggregateId: toUuid(reservation.campaignId),
      eventType: PREORDER_OUTBOX_EVENTS.RESERVATION_CONFIRMED,
      payload: { campaignId: reservation.campaignId, reservationId, customerId },
    });
    return { kind: 'succeeded', reservation: confirmedReservation };
  }

  /** The `BALANCE`-success branch — split out for the same reason `loadReservationAndAttempt` was. */
  private async handleBalanceSuccess(
    scope: TransactionScope,
    input: ConfirmReservationPaymentInput,
    reservation: PreorderReservation,
    now: Date,
  ): Promise<ConfirmOutcome> {
    const { reservationRepository, outboxWriter } = this.deps;
    const { customerId, reservationId } = input;

    const paidReservation = reservation.recordBalancePaid(now);
    await reservationRepository.withTransaction(scope).update(paidReservation);
    await outboxWriter.withTransaction(scope).write({
      aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
      aggregateId: toUuid(reservation.campaignId),
      eventType: PREORDER_OUTBOX_EVENTS.RESERVATION_BALANCE_PAID,
      payload: { campaignId: reservation.campaignId, reservationId, customerId },
    });
    return { kind: 'succeeded', reservation: paidReservation };
  }

  private async resolveInTransaction(
    scope: TransactionScope,
    input: ConfirmReservationPaymentInput,
  ): Promise<ConfirmOutcome> {
    const { paymentAttemptRepository, preorderPaymentGateway, clock } = this.deps;
    const { kind, testScenario } = input;

    const { reservation, attempt } = await this.loadReservationAndAttempt(scope, input);

    // Called inside this transaction only because `MockPreorderPaymentGateway`
    // makes no real network call — see `InitiateReservationPaymentUseCase`'s
    // own doc comment for the general rule.
    const gatewayResult = await preorderPaymentGateway.confirm({
      providerReference: attempt.providerReference,
      amount: attempt.amount,
      ...(testScenario !== undefined ? { testScenario } : {}),
    });

    const now = clock.now();
    const attempts = paymentAttemptRepository.withTransaction(scope);

    if (!gatewayResult.succeeded) {
      await attempts.update(attempt.fail(now));
      return this.handleGatewayFailure(scope, input, reservation, now);
    }

    await attempts.update(attempt.succeed(now));
    return kind === 'ADVANCE'
      ? this.handleAdvanceSuccess(scope, input, reservation, now)
      : this.handleBalanceSuccess(scope, input, reservation, now);
  }
}
