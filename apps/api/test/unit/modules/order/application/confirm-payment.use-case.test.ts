import { describe, expect, it, vi } from 'vitest';
import { FixedClock, Money, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import type { OutboxWriter } from '../../../../../src/shared/application/ports/outbox-writer.port.js';
import { ConfirmPaymentUseCase } from '../../../../../src/modules/order/application/use-cases/confirm-payment.use-case.js';
import type { PaymentGateway } from '../../../../../src/modules/order/application/ports/payment-gateway.port.js';
import { Order } from '../../../../../src/modules/order/domain/entities/order.entity.js';
import { OrderItem } from '../../../../../src/modules/order/domain/entities/order-item.entity.js';
import { SubOrder } from '../../../../../src/modules/order/domain/entities/sub-order.entity.js';
import { PaymentAttempt } from '../../../../../src/modules/order/domain/entities/payment-attempt.entity.js';
import {
  OrderNotFoundError,
  OrderNotPendingPaymentError,
  PaymentAttemptNotFoundError,
  PaymentFailedError,
} from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { OrderStatus } from '../../../../../src/modules/order/domain/value-objects/order-status.value-object.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';
import { toOrderItemId } from '../../../../../src/modules/order/domain/value-objects/order-item-id.value-object.js';
import { toSubOrderId } from '../../../../../src/modules/order/domain/value-objects/sub-order-id.value-object.js';
import { toPaymentAttemptId } from '../../../../../src/modules/order/domain/value-objects/payment-attempt-id.value-object.js';
import type { OrderRepository } from '../../../../../src/modules/order/domain/repositories/order.repository.js';
import type { PaymentAttemptRepository } from '../../../../../src/modules/order/domain/repositories/payment-attempt.repository.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);

const customerId = toUserId(ids.generate());
const principal: Principal = {
  userId: customerId,
  sessionId: toSessionId(ids.generate()),
  role: 'CUSTOMER',
};
const orderId = toOrderId(ids.generate());
const vendorId = toVendorId(ids.generate());
const variantId = toProductVariantId(ids.generate());

const address = {
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  landmark: null,
  label: 'Home',
};

const buildOrder = (status: OrderStatus): Order => {
  const subOrderId = toSubOrderId(ids.generate());
  const item = OrderItem.reconstitute({
    id: toOrderItemId(ids.generate()),
    subOrderId,
    productId: toProductId(ids.generate()),
    variantId,
    vendorId,
    productNameSnapshot: 'Alphonso Mango',
    variantNameSnapshot: '1 kg box',
    vendorShopNameSnapshot: 'Test Shop',
    unitOfMeasureSnapshot: 'per box',
    quantity: 3,
    unitPrice: Money.fromMajor(199),
    lineAmount: Money.fromMajor(597),
    hsnCodeSnapshot: '08045020',
    tax: { resolved: false, rateBasisPoints: null, amount: null },
    commissionRateBasisPoints: 1000,
    commissionAmount: Money.fromMajor(59.7),
    createdAt: NOW,
  });
  const subOrder = SubOrder.reconstitute({
    id: subOrderId,
    orderId,
    vendorId,
    status,
    vendorShopNameSnapshot: 'Test Shop',
    totalAmount: Money.fromMajor(597),
    items: [item],
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  });
  return Order.reconstitute({
    id: orderId,
    customerId,
    status,
    totalAmount: Money.fromMajor(597),
    address,
    subOrders: [subOrder],
    createdAt: NOW,
    updatedAt: NOW,
  });
};

const buildInitiatedAttempt = (): PaymentAttempt =>
  PaymentAttempt.initiate({
    id: toPaymentAttemptId(ids.generate()),
    orderId,
    amount: Money.fromMajor(597),
    provider: 'MOCK',
    providerReference: 'MOCK-ref-1',
    now: NOW,
  });

const orderRepo = (overrides: Partial<OrderRepository> = {}): OrderRepository => {
  const repository: OrderRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByIdAndCustomerId: vi.fn().mockResolvedValue(buildOrder(OrderStatus.PENDING_PAYMENT)),
    findAllByCustomerId: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn(),
    ...overrides,
  };
  return repository;
};

const paymentAttemptRepo = (
  overrides: Partial<PaymentAttemptRepository> = {},
): PaymentAttemptRepository => {
  const repository: PaymentAttemptRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findInitiatedByOrderId: vi.fn().mockResolvedValue(buildInitiatedAttempt()),
    updateStatus: vi.fn(),
    ...overrides,
  };
  return repository;
};

const paymentGateway = (overrides: Partial<PaymentGateway> = {}): PaymentGateway => ({
  initiate: vi.fn().mockResolvedValue({ providerReference: 'MOCK-ref-1' }),
  confirm: vi.fn().mockResolvedValue({ succeeded: true }),
  ...overrides,
});

const outboxWriter = (overrides: Partial<OutboxWriter> = {}): OutboxWriter => {
  const writer: OutboxWriter = {
    withTransaction: () => writer,
    write: vi.fn(),
    ...overrides,
  };
  return writer;
};

const runner = (): TransactionRunner => ({
  run: async (work) => work({} as TransactionScope),
});

interface BuildOverrides {
  orderRepository?: OrderRepository;
  paymentAttemptRepository?: PaymentAttemptRepository;
  paymentGateway?: PaymentGateway;
  outboxWriter?: OutboxWriter;
}

const buildUseCase = (overrides: BuildOverrides = {}): ConfirmPaymentUseCase =>
  new ConfirmPaymentUseCase({
    orderRepository: overrides.orderRepository ?? orderRepo(),
    paymentAttemptRepository: overrides.paymentAttemptRepository ?? paymentAttemptRepo(),
    paymentGateway: overrides.paymentGateway ?? paymentGateway(),
    outboxWriter: overrides.outboxWriter ?? outboxWriter(),
    transactionRunner: runner(),
    clock,
    logger: new NullLogger(),
  });

const input = { principal, orderId, testScenario: 'SUCCEEDED' as const };

describe('ConfirmPaymentUseCase', () => {
  it('confirms payment and flips the order PENDING_PAYMENT -> CONFIRMED', async () => {
    const useCase = buildUseCase();

    const order = await useCase.execute(input);

    expect(order.status).toBe(OrderStatus.CONFIRMED);
    expect(order.subOrders.every((s) => s.status.name === 'CONFIRMED')).toBe(true);
  });

  it('persists the succeeded attempt and the confirmed order in the same transaction', async () => {
    const attempts = paymentAttemptRepo();
    const orders = orderRepo();
    const useCase = buildUseCase({ paymentAttemptRepository: attempts, orderRepository: orders });

    await useCase.execute(input);

    expect(attempts.updateStatus).toHaveBeenCalledTimes(1);
    expect(vi.mocked(attempts.updateStatus).mock.calls[0]![0].status.name).toBe('SUCCEEDED');
    expect(orders.updateStatus).toHaveBeenCalledTimes(1);
  });

  it('rejects confirmation for a non-existent order', async () => {
    const useCase = buildUseCase({
      orderRepository: orderRepo({ findByIdAndCustomerId: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(OrderNotFoundError);
  });

  it('cannot confirm an already-CONFIRMED order (ownership check runs before attempt lookup)', async () => {
    const useCase = buildUseCase({
      orderRepository: orderRepo({
        findByIdAndCustomerId: vi.fn().mockResolvedValue(buildOrder(OrderStatus.CONFIRMED)),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(OrderNotPendingPaymentError);
  });

  it('rejects confirmation when no INITIATED attempt exists for the order', async () => {
    const useCase = buildUseCase({
      paymentAttemptRepository: paymentAttemptRepo({
        findInitiatedByOrderId: vi.fn().mockResolvedValue(null),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(PaymentAttemptNotFoundError);
  });

  it('does not confirm the order when the gateway reports failure', async () => {
    const orders = orderRepo();
    const useCase = buildUseCase({
      orderRepository: orders,
      paymentGateway: paymentGateway({ confirm: vi.fn().mockResolvedValue({ succeeded: false }) }),
    });

    await expect(useCase.execute({ ...input, testScenario: 'FAILED' })).rejects.toThrow(
      PaymentFailedError,
    );
    expect(orders.updateStatus).not.toHaveBeenCalled();
  });

  it('durably records the attempt as FAILED even though the use case throws', async () => {
    const attempts = paymentAttemptRepo();
    const useCase = buildUseCase({
      paymentAttemptRepository: attempts,
      paymentGateway: paymentGateway({ confirm: vi.fn().mockResolvedValue({ succeeded: false }) }),
    });

    await expect(useCase.execute({ ...input, testScenario: 'FAILED' })).rejects.toThrow(
      PaymentFailedError,
    );
    expect(attempts.updateStatus).toHaveBeenCalledTimes(1);
    expect(vi.mocked(attempts.updateStatus).mock.calls[0]![0].status.name).toBe('FAILED');
  });

  it('never trusts a client-supplied amount — the gateway is called with the order’s own persisted total', async () => {
    const gateway = paymentGateway();
    const useCase = buildUseCase({ paymentGateway: gateway });

    await useCase.execute(input);

    const call = vi.mocked(gateway.confirm).mock.calls[0]![0];
    expect(call.amount.amountMinor).toBe(Money.fromMajor(597).amountMinor);
  });

  it('rejects confirming another customer’s order', async () => {
    const useCase = buildUseCase({
      orderRepository: orderRepo({ findByIdAndCustomerId: vi.fn().mockResolvedValue(null) }),
    });
    const attacker: Principal = {
      userId: toUserId(ids.generate()),
      sessionId: toSessionId(ids.generate()),
      role: 'CUSTOMER',
    };

    await expect(useCase.execute({ ...input, principal: attacker })).rejects.toThrow(
      OrderNotFoundError,
    );
  });

  it('writes an order.confirmed outbox event on success', async () => {
    const outbox = outboxWriter();
    const useCase = buildUseCase({ outboxWriter: outbox });

    await useCase.execute(input);

    expect(outbox.write).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'order.confirmed', aggregateType: 'Order' }),
    );
  });

  it('writes an order.payment_failed outbox event on failure', async () => {
    const outbox = outboxWriter();
    const useCase = buildUseCase({
      outboxWriter: outbox,
      paymentGateway: paymentGateway({ confirm: vi.fn().mockResolvedValue({ succeeded: false }) }),
    });

    await expect(useCase.execute({ ...input, testScenario: 'FAILED' })).rejects.toThrow(
      PaymentFailedError,
    );
    expect(outbox.write).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'order.payment_failed', aggregateType: 'Order' }),
    );
  });
});
