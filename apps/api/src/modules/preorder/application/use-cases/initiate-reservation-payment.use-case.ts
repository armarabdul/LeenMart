import {
  toUuid,
  type Clock,
  type IdGenerator,
  type Logger,
  type TransactionRunner,
} from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import { PreorderPaymentAttempt } from '../../domain/entities/preorder-payment-attempt.entity.js';
import type { PreorderReservation } from '../../domain/entities/preorder-reservation.entity.js';
import {
  ReservationBalanceNotDueError,
  ReservationNotFoundError,
  ReservationNotPendingError,
  ReservationPaymentAlreadyInitiatedError,
} from '../../domain/errors/preorder-errors.js';
import { PREORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import { PREORDER_OUTBOX_EVENTS } from '../../domain/outbox-events.js';
import type { PaymentAttemptRepository } from '../../domain/repositories/payment-attempt.repository.js';
import type { ReservationRepository } from '../../domain/repositories/reservation.repository.js';
import { toPreorderPaymentAttemptId } from '../../domain/value-objects/payment-attempt-id.value-object.js';
import type { ReservationId } from '../../domain/value-objects/reservation-id.value-object.js';
import type { PreorderPaymentGateway } from '../ports/preorder-payment-gateway.port.js';

export type InitiateReservationPaymentKind = 'ADVANCE' | 'BALANCE';

export interface InitiateReservationPaymentInput {
  readonly customerId: UserId;
  readonly reservationId: ReservationId;
  readonly kind: InitiateReservationPaymentKind;
}

export interface InitiateReservationPaymentDeps {
  readonly reservationRepository: ReservationRepository;
  readonly paymentAttemptRepository: PaymentAttemptRepository;
  readonly preorderPaymentGateway: PreorderPaymentGateway;
  readonly outboxWriter: OutboxWriter;
  readonly transactionRunner: TransactionRunner;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Starts one payment attempt against a reservation the caller owns — mirrors
 * `InitiatePaymentUseCase` exactly. Ownership and reservation state are
 * checked against the database, never the client (SEC-02): the request
 * carries only `reservationId` and `kind`; the amount attempted is always
 * read fresh off the reservation's own `advanceAmount`/`balanceAmount`
 * snapshot, never client-supplied.
 *
 * `ADVANCE` requires the reservation still `PENDING` (not yet confirmed, not
 * expired/failed/cancelled). `BALANCE` requires it `CONFIRMED` with an
 * outstanding balance still unpaid.
 *
 * `preorderPaymentGateway.initiate()` is called **before** opening the
 * transaction, matching SDD 4.2's own rule and `InitiatePaymentUseCase`'s own
 * precedent, even though `MockPreorderPaymentGateway` makes no real call
 * today.
 */
export class InitiateReservationPaymentUseCase {
  constructor(private readonly deps: InitiateReservationPaymentDeps) {}

  /** Ownership/status/no-existing-attempt resolution — split out purely to keep `execute` within this repository's complexity budget. */
  private async resolveReservation(
    input: InitiateReservationPaymentInput,
  ): Promise<PreorderReservation> {
    const { reservationRepository, paymentAttemptRepository } = this.deps;
    const { customerId, reservationId, kind } = input;

    const reservation = await reservationRepository.findByIdAndCustomerId(
      reservationId,
      customerId,
    );
    if (!reservation) {
      throw new ReservationNotFoundError();
    }

    if (kind === 'ADVANCE') {
      if (reservation.status.name !== 'PENDING') {
        throw new ReservationNotPendingError(reservation.status.name);
      }
    } else if (reservation.status.name !== 'CONFIRMED' || !reservation.hasOutstandingBalance()) {
      throw new ReservationBalanceNotDueError();
    }

    const existing = await paymentAttemptRepository.findInitiatedByReservationAndKind(
      reservationId,
      kind,
    );
    if (existing) {
      throw new ReservationPaymentAlreadyInitiatedError();
    }

    return reservation;
  }

  async execute(input: InitiateReservationPaymentInput): Promise<PreorderPaymentAttempt> {
    const {
      paymentAttemptRepository,
      preorderPaymentGateway,
      outboxWriter,
      transactionRunner,
      idGenerator,
      clock,
      logger,
    } = this.deps;
    const { customerId, reservationId, kind } = input;

    const reservation = await this.resolveReservation(input);

    const amount = kind === 'ADVANCE' ? reservation.advanceAmount : reservation.balanceAmount;
    const gatewayResult = await preorderPaymentGateway.initiate({
      referenceId: reservation.id,
      amount,
    });

    return transactionRunner.run(async (scope) => {
      const now = clock.now();
      const attempt = PreorderPaymentAttempt.initiate({
        id: toPreorderPaymentAttemptId(idGenerator.generate()),
        reservationId,
        kind,
        amount,
        provider: 'MOCK',
        providerReference: gatewayResult.providerReference,
        now,
      });

      await paymentAttemptRepository.withTransaction(scope).create(attempt);
      await outboxWriter.withTransaction(scope).write({
        aggregateType: PREORDER_AUDIT_ENTITY_TYPES.CAMPAIGN,
        aggregateId: toUuid(reservation.campaignId),
        eventType:
          kind === 'ADVANCE'
            ? PREORDER_OUTBOX_EVENTS.RESERVATION_PAYMENT_INITIATED_ADVANCE
            : PREORDER_OUTBOX_EVENTS.RESERVATION_PAYMENT_INITIATED_BALANCE,
        payload: {
          campaignId: reservation.campaignId,
          reservationId,
          customerId,
          kind,
          providerReference: attempt.providerReference,
        },
      });

      logger.info(
        { reservationId, kind, providerReference: attempt.providerReference },
        'Preorder reservation payment attempt initiated',
      );
      return attempt;
    });
  }
}
