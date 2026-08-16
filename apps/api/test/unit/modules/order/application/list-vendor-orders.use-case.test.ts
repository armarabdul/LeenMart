import { describe, expect, it, vi } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import { ListVendorOrdersUseCase } from '../../../../../src/modules/order/application/use-cases/list-vendor-orders.use-case.js';
import { VendorNotActiveForOrdersError } from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { OrderStatus } from '../../../../../src/modules/order/domain/value-objects/order-status.value-object.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';
import { toSubOrderId } from '../../../../../src/modules/order/domain/value-objects/sub-order-id.value-object.js';
import type {
  VendorOrderRepository,
  VendorSubOrderSummary,
} from '../../../../../src/modules/order/domain/repositories/vendor-order.repository.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-01T00:00:00.000Z');
const userId = toUserId(ids.generate());
const vendorId = toVendorId(ids.generate());
const principal: Principal = {
  userId,
  sessionId: toSessionId(ids.generate()),
  role: 'VENDOR_OWNER',
};

const activeVendor = VendorProfile.reconstitute({
  id: vendorId,
  userId,
  status: VendorStatus.ACTIVE,
  plan: 'COMMISSION',
  shopName: 'Test Shop',
  createdAt: NOW,
  updatedAt: NOW,
});

const vendorRepo = (overrides: Partial<VendorRepository> = {}): VendorRepository => {
  const repository: VendorRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn().mockResolvedValue(activeVendor),
    findByUserId: vi.fn().mockResolvedValue(activeVendor),
    ...overrides,
  };
  return repository;
};

const buildSummary = (overrides: Partial<VendorSubOrderSummary> = {}): VendorSubOrderSummary => ({
  id: toSubOrderId(ids.generate()),
  orderId: toOrderId(ids.generate()),
  status: OrderStatus.CONFIRMED,
  totalAmount: Money.fromMajor(199),
  createdAt: NOW,
  ...overrides,
});

const vendorOrderRepo = (overrides: Partial<VendorOrderRepository> = {}): VendorOrderRepository => {
  const repository: VendorOrderRepository = {
    withTransaction: () => repository,
    findAllByVendor: vi.fn().mockResolvedValue([]),
    findDetailById: vi.fn(),
    updateStatusIfVersionMatches: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return repository;
};

describe('ListVendorOrdersUseCase', () => {
  it('returns the vendor’s own sub-orders as reported by the repository', async () => {
    const summaries = [buildSummary(), buildSummary()];
    const useCase = new ListVendorOrdersUseCase({
      vendorRepository: vendorRepo(),
      vendorOrderRepository: vendorOrderRepo({
        findAllByVendor: vi.fn().mockResolvedValue(summaries),
      }),
    });

    const result = await useCase.execute({ principal });

    expect(result).toBe(summaries);
  });

  it('passes a bounded limit — no unbounded/cursor query', async () => {
    const repository = vendorOrderRepo();
    const useCase = new ListVendorOrdersUseCase({
      vendorRepository: vendorRepo(),
      vendorOrderRepository: repository,
    });

    await useCase.execute({ principal });

    expect(repository.findAllByVendor).toHaveBeenCalledWith(50);
  });

  it('rejects with VendorNotActiveForOrdersError when the caller has no vendor profile', async () => {
    const useCase = new ListVendorOrdersUseCase({
      vendorRepository: vendorRepo({ findByUserId: vi.fn().mockResolvedValue(null) }),
      vendorOrderRepository: vendorOrderRepo(),
    });

    await expect(useCase.execute({ principal })).rejects.toThrow(VendorNotActiveForOrdersError);
  });

  it('rejects with VendorNotActiveForOrdersError when the vendor is not ACTIVE', async () => {
    const suspended = VendorProfile.reconstitute({
      id: vendorId,
      userId,
      status: VendorStatus.SUSPENDED,
      plan: 'COMMISSION',
      shopName: 'Test Shop',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const useCase = new ListVendorOrdersUseCase({
      vendorRepository: vendorRepo({ findByUserId: vi.fn().mockResolvedValue(suspended) }),
      vendorOrderRepository: vendorOrderRepo(),
    });

    await expect(useCase.execute({ principal })).rejects.toThrow(VendorNotActiveForOrdersError);
  });

  it('returns an empty list when the vendor has no sub-orders', async () => {
    const useCase = new ListVendorOrdersUseCase({
      vendorRepository: vendorRepo(),
      vendorOrderRepository: vendorOrderRepo({ findAllByVendor: vi.fn().mockResolvedValue([]) }),
    });

    const result = await useCase.execute({ principal });

    expect(result).toEqual([]);
  });
});
