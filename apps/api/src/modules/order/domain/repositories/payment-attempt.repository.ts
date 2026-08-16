import type { TransactionScope } from '@leen-mart/domain-kit';
import type { PaymentAttempt } from '../entities/payment-attempt.entity.js';
import type { OrderId } from '../value-objects/order-id.value-object.js';

export interface PaymentAttemptRepository {
  /** Re-binds this repository to an open transaction. Same shape every other repository in this codebase publishes. */
  withTransaction(scope: TransactionScope): PaymentAttemptRepository;

  create(attempt: PaymentAttempt): Promise<void>;

  /**
   * The single `INITIATED` attempt for this order, if one exists — scoped by
   * `orderId` alone (never a bare attempt id), since `ConfirmPaymentUseCase`
   * only ever needs "the payment currently awaiting confirmation for *this*
   * order," and the caller's ownership of that order is checked separately.
   * A partial unique index (`(order_id) WHERE status = 'INITIATED'`) is what
   * makes "the" singular actually true at the database level.
   */
  findInitiatedByOrderId(orderId: OrderId): Promise<PaymentAttempt | null>;

  /** Writes this attempt's own status. Nothing else on a `PaymentAttempt` is ever rewritten (append-only once resolved). */
  updateStatus(attempt: PaymentAttempt): Promise<void>;
}
