import {
  toUuid,
  type Clock,
  type Logger,
  type TransactionRunner,
  type TransactionScope,
} from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import { ORDER_AUDIT_ACTIONS, ORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import type { Order } from '../../domain/entities/order.entity.js';
import {
  OrderNotFoundError,
  OrderNotPendingPaymentError,
  PaymentAttemptNotFoundError,
  PaymentFailedError,
} from '../../domain/errors/order-errors.js';
import type { OrderRepository } from '../../domain/repositories/order.repository.js';
import type { PaymentAttemptRepository } from '../../domain/repositories/payment-attempt.repository.js';
import type { OrderId } from '../../domain/value-objects/order-id.value-object.js';
import type { PaymentGateway, PaymentTestScenario } from '../ports/payment-gateway.port.js';

export interface ConfirmPaymentInput {
  readonly principal: Principal;
  readonly orderId: OrderId;
  readonly testScenario?: PaymentTestScenario;
}

export interface ConfirmPaymentDeps {
  readonly orderRepository: OrderRepository;
  readonly paymentAttemptRepository: PaymentAttemptRepository;
  readonly paymentGateway: PaymentGateway;
  readonly outboxWriter: OutboxWriter;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

type ConfirmOutcome =
  | { readonly kind: 'succeeded'; readonly order: Order }
  | { readonly kind: 'failed' };

/**
 * Resolves the caller's own currently-`INITIATED` payment attempt and, on
 * success, moves the order `PENDING_PAYMENT -> CONFIRMED` (S3-3B). Every
 * check is against the database, never the client (SEC-02): order
 * ownership, order status, and which attempt is "the" one being confirmed
 * are all resolved server-side — the request carries no attempt id, no
 * amount, no status, only `orderId` and (mock-only) which deterministic
 * outcome to exercise.
 *
 * **Both outcomes commit the same transaction.** A failed attempt must be
 * durably recorded as `FAILED` (freeing the partial-unique-index slot so a
 * retry can initiate a fresh attempt) even though this call still reports an
 * error to its caller — throwing `PaymentFailedError` *inside*
 * `transactionRunner.run` would roll that write back along with everything
 * else and leave the attempt stuck `INITIATED` forever, permanently
 * blocking retry. The transaction always commits; only the use case's own
 * return path decides afterward whether to throw.
 */
export class ConfirmPaymentUseCase {
  constructor(private readonly deps: ConfirmPaymentDeps) {}

  async execute(input: ConfirmPaymentInput): Promise<Order> {
    const { transactionRunner, logger } = this.deps;
    const { orderId } = input;

    const outcome = await transactionRunner.run<ConfirmOutcome>((scope) =>
      this.resolveInTransaction(scope, input),
    );

    if (outcome.kind === 'failed') {
      logger.info({ orderId }, 'Payment attempt failed — order remains PENDING_PAYMENT');
      throw new PaymentFailedError();
    }

    logger.info({ orderId: outcome.order.id }, 'Payment confirmed — order CONFIRMED');
    return outcome.order;
  }

  private async resolveInTransaction(
    scope: TransactionScope,
    input: ConfirmPaymentInput,
  ): Promise<ConfirmOutcome> {
    const { orderRepository, paymentAttemptRepository, paymentGateway, outboxWriter, clock } =
      this.deps;
    const { principal, orderId, testScenario } = input;

    const orders = orderRepository.withTransaction(scope);
    const order = await orders.findByIdAndCustomerId(orderId, principal.userId);
    if (!order) {
      throw new OrderNotFoundError();
    }
    if (order.status.name !== 'PENDING_PAYMENT') {
      throw new OrderNotPendingPaymentError(order.status.name);
    }

    const attempts = paymentAttemptRepository.withTransaction(scope);
    const attempt = await attempts.findInitiatedByOrderId(orderId);
    if (!attempt) {
      throw new PaymentAttemptNotFoundError();
    }

    // Called inside this transaction only because `MockPaymentGateway` makes
    // no real network call — see its own doc comment. A real adapter's
    // equivalent decision arrives via an already-verified webhook, not a
    // synchronous call made from here.
    const gatewayResult = await paymentGateway.confirm({
      providerReference: attempt.providerReference,
      amount: order.totalAmount,
      ...(testScenario !== undefined ? { testScenario } : {}),
    });

    const now = clock.now();
    const outboxes = outboxWriter.withTransaction(scope);

    if (!gatewayResult.succeeded) {
      await attempts.updateStatus(attempt.fail(now));
      await outboxes.write({
        aggregateType: ORDER_AUDIT_ENTITY_TYPES.ORDER,
        aggregateId: toUuid(orderId),
        eventType: ORDER_AUDIT_ACTIONS.PAYMENT_FAILED,
        payload: {
          orderId,
          customerId: principal.userId,
          providerReference: attempt.providerReference,
        },
      });
      return { kind: 'failed' };
    }

    await attempts.updateStatus(attempt.succeed(now));
    const confirmed = order.confirm(now);
    await orders.updateStatus(confirmed);
    await outboxes.write({
      aggregateType: ORDER_AUDIT_ENTITY_TYPES.ORDER,
      aggregateId: toUuid(orderId),
      eventType: ORDER_AUDIT_ACTIONS.CONFIRMED,
      payload: { orderId, customerId: principal.userId },
    });
    return { kind: 'succeeded', order: confirmed };
  }
}
