import { toUuid, type Clock, type Logger, type TransactionRunner } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import type { PreorderReservation } from '../../domain/entities/preorder-reservation.entity.js';
import {
  ReservationAlreadyConvertedError,
  ReservationNotFoundError,
} from '../../domain/errors/preorder-errors.js';
import { PREORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import { PREORDER_OUTBOX_EVENTS } from '../../domain/outbox-events.js';
import type { CampaignRepository } from '../../domain/repositories/campaign.repository.js';
import type { ReservationRepository } from '../../domain/repositories/reservation.repository.js';
import type { CampaignId } from '../../domain/value-objects/campaign-id.value-object.js';
import type { ReservationId } from '../../domain/value-objects/reservation-id.value-object.js';
import type { ReservationStatusName } from '../../domain/value-objects/reservation-status.value-object.js';
import type { RedisCampaignQuotaGate } from '../../infrastructure/cache/redis-campaign-quota-gate.js';

export interface CancelReservationInput {
  readonly customerId: UserId;
  readonly reservationId: ReservationId;
}

export interface CancelReservationDeps {
  readonly reservationRepository: ReservationRepository;
  readonly campaignRepository: CampaignRepository;
  readonly quotaGate: RedisCampaignQuotaGate;
  readonly outboxWriter: OutboxWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

interface Resolution {
  readonly reservation: PreorderReservation;
  /** Set only when this call actually performed the release — tells the caller whether to also touch Redis, post-commit. */
  readonly released: { readonly campaignId: CampaignId; readonly quantity: number } | null;
}

/**
 * A customer cancels their own reservation, from either `PENDING` or
 * `CONFIRMED` (`PreorderReservation.cancel()` picks the right transition).
 * **No refund call anywhere in this use case** — the same BR-06/07 boundary
 * `CancelCampaignUseCase` and `PreorderReservation.cancel()`'s own doc
 * comment already establish; this releases the held quantity and stops
 * there. Not audited — self-service customer actions aren't audited
 * anywhere in this codebase (mirrors `CancelOrderUseCase`/cart mutations).
 *
 * `updateIfStatus(cancelled, reservation.status.name)` guards against the
 * same race `ConfirmReservationPaymentUseCase` guards against: if the expiry
 * sweep or a payment confirmation has already moved this row between this
 * use case's read and write, the guard returns `false` and this call loses
 * the race cleanly rather than double-releasing quantity that something else
 * already released.
 *
 * The Redis quota gate is released **after** the transaction commits —
 * `quotaGate.release()`'s own doc comment names this exact path
 * ("on every reservation release: expiry/failure/cancel") — Postgres remains
 * the correctness authority regardless (`decrementRemainingIfAvailable`);
 * this only keeps the fast admission gate from staying artificially low
 * until the next reconciliation tick.
 */
export class CancelReservationUseCase {
  constructor(private readonly deps: CancelReservationDeps) {}

  async execute(input: CancelReservationInput): Promise<PreorderReservation> {
    const {
      reservationRepository,
      campaignRepository,
      quotaGate,
      outboxWriter,
      transactionRunner,
      clock,
      logger,
    } = this.deps;
    const { customerId, reservationId } = input;

    const resolution = await transactionRunner.run<Resolution>(async (scope) => {
      const reservations = reservationRepository.withTransaction(scope);
      const reservation = await reservations.findByIdAndCustomerId(reservationId, customerId);
      if (!reservation) {
        throw new ReservationNotFoundError();
      }
      if (reservation.convertedOrderId !== null) {
        throw new ReservationAlreadyConvertedError();
      }

      const now = clock.now();
      const expectedStatus: ReservationStatusName = reservation.status.name;
      const cancelled = reservation.cancel(now);

      const applied = await reservations.updateIfStatus(cancelled, expectedStatus);
      if (!applied) {
        // Lost the race — the expiry sweep or a payment confirmation already
        // moved this row. Report the real current state, not the stale
        // in-memory `cancelled` object this call never actually persisted.
        const fresh = await reservations.findByIdAndCustomerId(reservationId, customerId);
        return { reservation: fresh ?? cancelled, released: null };
      }

      const campaigns = campaignRepository.withTransaction(scope);
      await campaigns.incrementRemaining(reservation.campaignId, reservation.quantity);

      await outboxWriter.withTransaction(scope).write({
        aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
        aggregateId: toUuid(reservation.campaignId),
        eventType: PREORDER_OUTBOX_EVENTS.RESERVATION_CANCELLED,
        payload: { campaignId: reservation.campaignId, reservationId, customerId },
      });

      return {
        reservation: cancelled,
        released: { campaignId: reservation.campaignId, quantity: reservation.quantity },
      };
    });

    if (resolution.released) {
      await quotaGate
        .release(resolution.released.campaignId, resolution.released.quantity)
        .catch((error: unknown) => {
          logger.error({ err: error, reservationId }, 'Failed to release quota-gate compensation');
        });
      logger.info({ reservationId }, 'Preorder reservation cancelled');
    } else {
      logger.info({ reservationId }, 'Preorder reservation cancel lost a race');
    }

    return resolution.reservation;
  }
}
