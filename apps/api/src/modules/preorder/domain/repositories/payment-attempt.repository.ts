import type { TransactionScope } from '@leen-mart/domain-kit';
import type { PreorderPaymentAttempt } from '../entities/preorder-payment-attempt.entity.js';
import type { PreorderPaymentAttemptId } from '../value-objects/payment-attempt-id.value-object.js';
import type { ReservationId } from '../value-objects/reservation-id.value-object.js';

export interface PaymentAttemptRepository {
  withTransaction(scope: TransactionScope): PaymentAttemptRepository;

  create(attempt: PreorderPaymentAttempt): Promise<void>;
  findById(id: PreorderPaymentAttemptId): Promise<PreorderPaymentAttempt | null>;
  findByProviderReference(providerReference: string): Promise<PreorderPaymentAttempt | null>;
  /** Mirrors `PaymentAttemptRepository.findInitiatedByOrderId` (order module) — the currently-open attempt of one kind for one reservation, or `null`. */
  findInitiatedByReservationAndKind(
    reservationId: ReservationId,
    kind: 'ADVANCE' | 'BALANCE',
  ): Promise<PreorderPaymentAttempt | null>;
  update(attempt: PreorderPaymentAttempt): Promise<void>;
  listByReservationId(reservationId: ReservationId): Promise<readonly PreorderPaymentAttempt[]>;
}
