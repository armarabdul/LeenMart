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
import { InitiatePaymentUseCase } from '../../../../../src/modules/order/application/use-cases/initiate-payment.use-case.js';
import type { PaymentGateway } from '../../../../../src/modules/order/application/ports/payment-gateway.port.js';
import { Order } from '../../../../../src/modules/order/domain/entities/order.entity.js';
import { OrderItem } from '../../../../../src/modules/order/domain/entities/order-item.entity.js';
import { PaymentAttempt } from '../../../../../src/modules/order/domain/entities/payment-attempt.entity.js';
import { SubOrder } from '../../../../../src/modules/order/domain/entities/sub-order.entity.js';
import {
  OrderNotFoundError,
  OrderNotPendingPaymentError,
  PaymentAlreadyInitiatedError,
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
const otherCustomerId = toUserId(ids.generate());
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

const buildOrder = (status: OrderStatus, customer = customerId): Order => {
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
    customerId: customer,
    status,
    totalAmount: Money.fromMajor(597),
    address,
    subOrders: [subOrder],
    createdAt: NOW,
    updatedAt: NOW,
  });
};

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
    findInitiatedByOrderId: vi.fn().mockResolvedValue(null),
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

const buildUseCase = (overrides: BuildOverrides = {}): InitiatePaymentUseCase =>
  new InitiatePaymentUseCase({
    orderRepository: overrides.orderRepository ?? orderRepo(),
    paymentAttemptRepository: overrides.paymentAttemptRepository ?? paymentAttemptRepo(),
    paymentGateway: overrides.paymentGateway ?? paymentGateway(),
    outboxWriter: overrides.outboxWriter ?? outboxWriter(),
    transactionRunner: runner(),
    idGenerator: ids,
    clock,
    logger: new NullLogger(),
  });

const input = { principal, orderId };

describe('InitiatePaymentUseCase', () => {
  it('starts a payment attempt for a valid PENDING_PAYMENT order', async () => {
    const attempts = paymentAttemptRepo();
    const useCase = buildUseCase({ paymentAttemptRepository: attempts });

    const attempt = await useCase.execute(input);

    expect(attempt.orderId).toBe(orderId);
    expect(attempt.status.name).toBe('INITIATED');
    expect(attempts.create).toHaveBeenCalledTimes(1);
  });

  it('uses the order’s own persisted total, never a client-supplied amount', async () => {
    const gateway = paymentGateway();
    const useCase = buildUseCase({ paymentGateway: gateway });

    await useCase.execute(input);

    const call = vi.mocked(gateway.initiate).mock.calls[0]![0];
    expect(call.orderId).toBe(orderId);
    expect(call.amount.currency).toBe('INR');
    expect(call.amount.amountMinor).toBe(Money.fromMajor(597).amountMinor);
  });

  it('rejects initiation for a non-existent order', async () => {
    const useCase = buildUseCase({
      orderRepository: orderRepo({ findByIdAndCustomerId: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(OrderNotFoundError);
  });

  it('rejects initiation for another customer’s order', async () => {
    const useCase = buildUseCase({
      orderRepository: orderRepo({
        findByIdAndCustomerId: vi
          .fn()
          .mockImplementation((_id, forCustomerId) =>
            Promise.resolve(
              forCustomerId === customerId ? buildOrder(OrderStatus.PENDING_PAYMENT) : null,
            ),
          ),
      }),
    });

    const attackerPrincipal: Principal = {
      userId: otherCustomerId,
      sessionId: toSessionId(ids.generate()),
      role: 'CUSTOMER',
    };

    await expect(useCase.execute({ principal: attackerPrincipal, orderId })).rejects.toThrow(
      OrderNotFoundError,
    );
  });

  it('rejects initiation for an order that is not PENDING_PAYMENT', async () => {
    const useCase = buildUseCase({
      orderRepository: orderRepo({
        findByIdAndCustomerId: vi.fn().mockResolvedValue(buildOrder(OrderStatus.CONFIRMED)),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(OrderNotPendingPaymentError);
  });

  it('rejects a second initiation while one attempt is already INITIATED', async () => {
    const existing = PaymentAttempt.initiate({
      id: toPaymentAttemptId(ids.generate()),
      orderId,
      amount: Money.fromMajor(597),
      provider: 'MOCK',
      providerReference: 'MOCK-existing',
      now: NOW,
    });
    const attempts = paymentAttemptRepo({
      findInitiatedByOrderId: vi.fn().mockResolvedValue(existing),
    });
    const gateway = paymentGateway();
    const useCase = buildUseCase({ paymentAttemptRepository: attempts, paymentGateway: gateway });

    await expect(useCase.execute(input)).rejects.toThrow(PaymentAlreadyInitiatedError);
    expect(gateway.initiate).not.toHaveBeenCalled();
    expect(attempts.create).not.toHaveBeenCalled();
  });

  it('writes an order.payment_initiated outbox event', async () => {
    const outbox = outboxWriter();
    const useCase = buildUseCase({ outboxWriter: outbox });

    await useCase.execute(input);

    expect(outbox.write).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'order.payment_initiated', aggregateType: 'Order' }),
    );
  });
});
