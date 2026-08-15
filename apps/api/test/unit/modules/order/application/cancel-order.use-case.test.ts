import { describe, expect, it, vi } from 'vitest';
import { FixedClock, Money, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { InventoryRepository } from '../../../../../src/modules/catalogue/index.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import type { OutboxWriter } from '../../../../../src/shared/application/ports/outbox-writer.port.js';
import { CancelOrderUseCase } from '../../../../../src/modules/order/application/use-cases/cancel-order.use-case.js';
import { Order } from '../../../../../src/modules/order/domain/entities/order.entity.js';
import { OrderItem } from '../../../../../src/modules/order/domain/entities/order-item.entity.js';
import { SubOrder } from '../../../../../src/modules/order/domain/entities/sub-order.entity.js';
import {
  OrderCancellationNotAllowedError,
  OrderNotFoundError,
} from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { OrderStatus } from '../../../../../src/modules/order/domain/value-objects/order-status.value-object.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';
import { toOrderItemId } from '../../../../../src/modules/order/domain/value-objects/order-item-id.value-object.js';
import { toSubOrderId } from '../../../../../src/modules/order/domain/value-objects/sub-order-id.value-object.js';
import type { OrderRepository } from '../../../../../src/modules/order/domain/repositories/order.repository.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');
const clock = new FixedClock(LATER);

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

const orderRepo = (overrides: Partial<OrderRepository> = {}): OrderRepository => {
  const repository: OrderRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByIdAndCustomerId: vi.fn().mockResolvedValue(buildOrder(OrderStatus.PENDING_PAYMENT)),
    updateStatus: vi.fn(),
    ...overrides,
  };
  return repository;
};

const inventoryRepo = (overrides: Partial<InventoryRepository> = {}): InventoryRepository => {
  const repository: InventoryRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByProductAndVariant: vi.fn().mockResolvedValue(null),
    setIfVersionMatches: vi.fn().mockResolvedValue(true),
    decrementIfAvailable: vi.fn().mockResolvedValue(true),
    restoreAvailability: vi.fn().mockResolvedValue(true),
    deleteForVariants: vi.fn().mockResolvedValue(0),
    deleteForProduct: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return repository;
};

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
  inventoryRepository?: InventoryRepository;
  outboxWriter?: OutboxWriter;
}

const buildUseCase = (overrides: BuildOverrides = {}): CancelOrderUseCase =>
  new CancelOrderUseCase({
    orderRepository: overrides.orderRepository ?? orderRepo(),
    inventoryRepository: overrides.inventoryRepository ?? inventoryRepo(),
    outboxWriter: overrides.outboxWriter ?? outboxWriter(),
    transactionRunner: runner(),
    clock,
    logger: new NullLogger(),
  });

const input = { principal, orderId };

describe('CancelOrderUseCase', () => {
  it('cancels an order that is still PENDING_PAYMENT', async () => {
    const useCase = buildUseCase({
      orderRepository: orderRepo({
        findByIdAndCustomerId: vi.fn().mockResolvedValue(buildOrder(OrderStatus.PENDING_PAYMENT)),
      }),
    });
    const cancelled = await useCase.execute(input);

    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(cancelled.subOrders.every((s) => s.status.name === 'CANCELLED')).toBe(true);
  });

  it('cancels an order that has been CONFIRMED but has not started PROCESSING', async () => {
    const useCase = buildUseCase({
      orderRepository: orderRepo({
        findByIdAndCustomerId: vi.fn().mockResolvedValue(buildOrder(OrderStatus.CONFIRMED)),
      }),
    });
    const cancelled = await useCase.execute(input);

    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
  });

  it('refuses to cancel once a sub-order has reached PROCESSING (approved decision)', async () => {
    const useCase = buildUseCase({
      orderRepository: orderRepo({
        findByIdAndCustomerId: vi.fn().mockResolvedValue(buildOrder(OrderStatus.PROCESSING)),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(OrderCancellationNotAllowedError);
  });

  it('rejects with OrderNotFoundError for an order that does not belong to the caller', async () => {
    const useCase = buildUseCase({
      orderRepository: orderRepo({ findByIdAndCustomerId: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(OrderNotFoundError);
  });

  it('restores inventory for every item across every sub-order', async () => {
    const inventory = inventoryRepo();
    const useCase = buildUseCase({ inventoryRepository: inventory });
    await useCase.execute(input);

    expect(inventory.restoreAvailability).toHaveBeenCalledWith(variantId, 3);
  });

  it('does not restore inventory or write status when cancellation is refused', async () => {
    const inventory = inventoryRepo();
    const orderRepository = orderRepo({
      findByIdAndCustomerId: vi.fn().mockResolvedValue(buildOrder(OrderStatus.PROCESSING)),
    });
    const useCase = buildUseCase({ orderRepository, inventoryRepository: inventory });

    await expect(useCase.execute(input)).rejects.toThrow(OrderCancellationNotAllowedError);
    expect(inventory.restoreAvailability).not.toHaveBeenCalled();
    expect(orderRepository.updateStatus).not.toHaveBeenCalled();
  });

  it('writes an OrderCancelled outbox event', async () => {
    const outbox = outboxWriter();
    const useCase = buildUseCase({ outboxWriter: outbox });
    await useCase.execute(input);

    expect(outbox.write).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'order.cancelled', aggregateType: 'Order' }),
    );
  });
});
