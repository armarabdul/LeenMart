import { describe, expect, it, vi } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { GetOrderUseCase } from '../../../../../src/modules/order/application/use-cases/get-order.use-case.js';
import { Order } from '../../../../../src/modules/order/domain/entities/order.entity.js';
import { OrderNotFoundError } from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';
import type { OrderRepository } from '../../../../../src/modules/order/domain/repositories/order.repository.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const customerId = toUserId(ids.generate());
const principal: Principal = {
  userId: customerId,
  sessionId: toSessionId(ids.generate()),
  role: 'CUSTOMER',
};
const orderId = toOrderId(ids.generate());

const order = Order.place({
  id: orderId,
  customerId,
  totalAmount: Money.fromMajor(199),
  address: {
    recipientName: 'Asha Rao',
    phone: '+919876543210',
    line1: '221B Baker Street',
    line2: null,
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    landmark: null,
    label: 'Home',
  },
  subOrders: [],
  now: NOW,
});

const orderRepo = (overrides: Partial<OrderRepository> = {}): OrderRepository => {
  const repository: OrderRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByIdAndCustomerId: vi.fn().mockResolvedValue(order),
    findAllByCustomerId: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn(),
    ...overrides,
  };
  return repository;
};

describe('GetOrderUseCase', () => {
  it('returns the order when it belongs to the caller', async () => {
    const useCase = new GetOrderUseCase({ orderRepository: orderRepo() });
    const result = await useCase.execute({ principal, orderId });
    expect(result.id).toBe(orderId);
  });

  it('scopes the lookup by (id, customerId) — never a bare id lookup', async () => {
    const repository = orderRepo();
    const useCase = new GetOrderUseCase({ orderRepository: repository });
    await useCase.execute({ principal, orderId });

    expect(repository.findByIdAndCustomerId).toHaveBeenCalledWith(orderId, customerId);
  });

  it('rejects with OrderNotFoundError rather than leaking whether the order exists for someone else', async () => {
    const useCase = new GetOrderUseCase({
      orderRepository: orderRepo({ findByIdAndCustomerId: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute({ principal, orderId })).rejects.toThrow(OrderNotFoundError);
  });
});
