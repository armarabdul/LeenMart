import {
  toUuid,
  type Clock,
  type IdGenerator,
  type Logger,
  type TransactionRunner,
} from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import { PaymentAttempt } from '../../domain/entities/payment-attempt.entity.js';
import {
  OrderNotFoundError,
  OrderNotPendingPaymentError,
  PaymentAlreadyInitiatedError,
} from '../../domain/errors/order-errors.js';
import type { OrderRepository } from '../../domain/repositories/order.repository.js';
import type { PaymentAttemptRepository } from '../../domain/repositories/payment-attempt.repository.js';
import type { OrderId } from '../../domain/value-objects/order-id.value-object.js';
import { toPaymentAttemptId } from '../../domain/value-objects/payment-attempt-id.value-object.js';
import type { PaymentGateway } from '../ports/payment-gateway.port.js';

export interface InitiatePaymentInput {
  readonly principal: Principal;
  readonly orderId: OrderId;
}

export interface InitiatePaymentDeps {
  readonly orderRepository: OrderRepository;
  readonly paymentAttemptRepository: PaymentAttemptRepository;
  readonly paymentGateway: PaymentGateway;
  readonly outboxWriter: OutboxWriter;
  readonly transactionRunner: TransactionRunner;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Starts one payment attempt for an order the caller owns (S3-3B). Ownership
 * and order state are checked against the database, never the client
 * (SEC-02) — `orderId` is the only thing the request carries; the amount
 * that gets attempted is always `order.totalAmount`, read fresh here.
 *
 * `paymentGateway.initiate()` is called **before** opening the transaction,
 * matching SDD 4.2's own rule ("No external HTTP call inside a database
 * transaction") even though `MockPaymentGateway` makes no real call today —
 * the ordering is what a real gateway adapter needs, and getting it right
 * now means swapping the adapter later changes nothing here.
 */
export class InitiatePaymentUseCase {
  constructor(private readonly deps: InitiatePaymentDeps) {}

  async execute(input: InitiatePaymentInput): Promise<PaymentAttempt> {
    const {
      orderRepository,
      paymentAttemptRepository,
      paymentGateway,
      outboxWriter,
      transactionRunner,
      idGenerator,
      clock,
      logger,
    } = this.deps;
    const { principal, orderId } = input;

    const order = await orderRepository.findByIdAndCustomerId(orderId, principal.userId);
    if (!order) {
      throw new OrderNotFoundError();
    }
    if (order.status.name !== 'PENDING_PAYMENT') {
      throw new OrderNotPendingPaymentError(order.status.name);
    }

    const existing = await paymentAttemptRepository.findInitiatedByOrderId(orderId);
    if (existing) {
      throw new PaymentAlreadyInitiatedError();
    }

    const gatewayResult = await paymentGateway.initiate({ orderId, amount: order.totalAmount });

    return transactionRunner.run(async (scope) => {
      const now = clock.now();
      const attempt = PaymentAttempt.initiate({
        id: toPaymentAttemptId(idGenerator.generate()),
        orderId,
        amount: order.totalAmount,
        provider: 'MOCK',
        providerReference: gatewayResult.providerReference,
        now,
      });

      await paymentAttemptRepository.withTransaction(scope).create(attempt);
      await outboxWriter.withTransaction(scope).write({
        aggregateType: 'Order',
        aggregateId: toUuid(orderId),
        eventType: 'order.payment_initiated',
        payload: {
          orderId,
          customerId: principal.userId,
          providerReference: attempt.providerReference,
        },
      });

      logger.info(
        { orderId, providerReference: attempt.providerReference },
        'Payment attempt initiated',
      );
      return attempt;
    });
  }
}
