import { describe, expect, it, vi } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { ListOrdersUseCase } from '../../../../../src/modules/order/application/use-cases/list-orders.use-case.js';
import { OrderStatus } from '../../../../../src/modules/order/domain/value-objects/order-status.value-object.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';
import type {
  OrderRepository,
  OrderSummary,
} from '../../../../../src/modules/order/domain/repositories/order.repository.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const customerId = toUserId(ids.generate());
const principal: Principal = {
  userId: customerId,
  sessionId: toSessionId(ids.generate()),
  role: 'CUSTOMER',
};

const buildSummary = (overrides: Partial<OrderSummary> = {}): OrderSummary => ({
  id: toOrderId(ids.generate()),
  status: OrderStatus.CONFIRMED,
  totalAmount: Money.fromMajor(199),
  createdAt: NOW,
  ...overrides,
});

const orderRepo = (overrides: Partial<OrderRepository> = {}): OrderRepository => {
  const repository: OrderRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByIdAndCustomerId: vi.fn(),
    findAllByCustomerId: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn(),
    ...overrides,
  };
  return repository;
};

describe('ListOrdersUseCase', () => {
  it("returns the caller's own orders as reported by the repository", async () => {
    const summaries = [buildSummary(), buildSummary()];
    const useCase = new ListOrdersUseCase({
      orderRepository: orderRepo({ findAllByCustomerId: vi.fn().mockResolvedValue(summaries) }),
    });

    const result = await useCase.execute({ principal });

    expect(result).toBe(summaries);
  });

  it('scopes the query by the caller’s own userId — never a client-supplied id', async () => {
    const repository = orderRepo();
    const useCase = new ListOrdersUseCase({ orderRepository: repository });

    await useCase.execute({ principal });

    expect(repository.findAllByCustomerId).toHaveBeenCalledWith(customerId, expect.any(Number));
  });

  it('passes a bounded limit — no unbounded/cursor query', async () => {
    const repository = orderRepo();
    const useCase = new ListOrdersUseCase({ orderRepository: repository });

    await useCase.execute({ principal });

    const call = vi.mocked(repository.findAllByCustomerId).mock.calls[0]!;
    expect(call[1]).toBe(50);
  });

  it('returns an empty list when the customer has no orders', async () => {
    const useCase = new ListOrdersUseCase({
      orderRepository: orderRepo({ findAllByCustomerId: vi.fn().mockResolvedValue([]) }),
    });

    const result = await useCase.execute({ principal });

    expect(result).toEqual([]);
  });

  it('trusts the repository’s own ordering rather than re-sorting (newest-first is the repository’s job)', async () => {
    const newest = buildSummary({ createdAt: new Date('2026-03-02T00:00:00.000Z') });
    const oldest = buildSummary({ createdAt: new Date('2026-03-01T00:00:00.000Z') });
    const useCase = new ListOrdersUseCase({
      orderRepository: orderRepo({
        findAllByCustomerId: vi.fn().mockResolvedValue([newest, oldest]),
      }),
    });

    const result = await useCase.execute({ principal });

    expect(result).toEqual([newest, oldest]);
  });
});
