import { describe, expect, it, vi } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import { GetVendorOrderUseCase } from '../../../../../src/modules/order/application/use-cases/get-vendor-order.use-case.js';
import { SubOrder } from '../../../../../src/modules/order/domain/entities/sub-order.entity.js';
import { FulfilmentMode } from '../../../../../src/modules/order/domain/value-objects/fulfilment-mode.value-object.js';
import {
  SubOrderNotFoundError,
  VendorNotActiveForOrdersError,
} from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { OrderStatus } from '../../../../../src/modules/order/domain/value-objects/order-status.value-object.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';
import { toSubOrderId } from '../../../../../src/modules/order/domain/value-objects/sub-order-id.value-object.js';
import type {
  VendorOrderRepository,
  VendorSubOrderDetail,
} from '../../../../../src/modules/order/domain/repositories/vendor-order.repository.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-01T00:00:00.000Z');
const userId = toUserId(ids.generate());
const vendorId = toVendorId(ids.generate());
const subOrderId = toSubOrderId(ids.generate());
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
  supportsPickup: false,
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

const detail: VendorSubOrderDetail = {
  subOrder: SubOrder.reconstitute({
    id: subOrderId,
    orderId: toOrderId(ids.generate()),
    vendorId,
    status: OrderStatus.CONFIRMED,
    fulfilmentMode: FulfilmentMode.DELIVERY,
    vendorShopNameSnapshot: 'Test Shop',
    totalAmount: Money.fromMajor(199),
    items: [],
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  }),
  address,
};

const vendorOrderRepo = (overrides: Partial<VendorOrderRepository> = {}): VendorOrderRepository => {
  const repository: VendorOrderRepository = {
    withTransaction: () => repository,
    findAllByVendor: vi.fn().mockResolvedValue([]),
    findDetailById: vi.fn().mockResolvedValue(detail),
    updateStatusIfVersionMatches: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return repository;
};

const input = { principal, subOrderId };

describe('GetVendorOrderUseCase', () => {
  it('returns the vendor’s own sub-order detail as reported by the repository', async () => {
    const useCase = new GetVendorOrderUseCase({
      vendorRepository: vendorRepo(),
      vendorOrderRepository: vendorOrderRepo(),
    });

    const result = await useCase.execute(input);

    expect(result).toBe(detail);
  });

  it('scopes the lookup by the caller’s own sub-order id', async () => {
    const repository = vendorOrderRepo();
    const useCase = new GetVendorOrderUseCase({
      vendorRepository: vendorRepo(),
      vendorOrderRepository: repository,
    });

    await useCase.execute(input);

    expect(repository.findDetailById).toHaveBeenCalledWith(subOrderId);
  });

  it('rejects with SubOrderNotFoundError for a sub-order that does not belong to the caller', async () => {
    const useCase = new GetVendorOrderUseCase({
      vendorRepository: vendorRepo(),
      vendorOrderRepository: vendorOrderRepo({ findDetailById: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(SubOrderNotFoundError);
  });

  it('rejects with VendorNotActiveForOrdersError when the vendor is not ACTIVE', async () => {
    const suspended = VendorProfile.reconstitute({
      id: vendorId,
      userId,
      status: VendorStatus.SUSPENDED,
      plan: 'COMMISSION',
      shopName: 'Test Shop',
      supportsPickup: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const useCase = new GetVendorOrderUseCase({
      vendorRepository: vendorRepo({ findByUserId: vi.fn().mockResolvedValue(suspended) }),
      vendorOrderRepository: vendorOrderRepo(),
    });

    await expect(useCase.execute(input)).rejects.toThrow(VendorNotActiveForOrdersError);
  });
});
