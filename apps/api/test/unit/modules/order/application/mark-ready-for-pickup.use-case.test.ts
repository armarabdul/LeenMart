import { describe, expect, it, vi } from 'vitest';
import { FixedClock, Money, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../../../src/modules/audit/index.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import type { OutboxWriter } from '../../../../../src/shared/application/ports/outbox-writer.port.js';
import { MarkReadyForPickupUseCase } from '../../../../../src/modules/order/application/use-cases/mark-ready-for-pickup.use-case.js';
import { SubOrder } from '../../../../../src/modules/order/domain/entities/sub-order.entity.js';
import { FulfilmentMode } from '../../../../../src/modules/order/domain/value-objects/fulfilment-mode.value-object.js';
import {
  FulfilmentModeMismatchError,
  InvalidOrderStatusTransitionError,
  SubOrderConcurrentlyModifiedError,
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
const LATER = new Date('2026-08-02T00:00:00.000Z');
const clock = new FixedClock(LATER);

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
  supportsPickup: true,
  shopAddress: null,
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

const buildDetail = (
  status: OrderStatus,
  fulfilmentMode: FulfilmentMode = FulfilmentMode.PICKUP,
  version = 1,
): VendorSubOrderDetail => ({
  subOrder: SubOrder.reconstitute({
    id: subOrderId,
    orderId: toOrderId(ids.generate()),
    vendorId,
    status,
    fulfilmentMode,
    vendorShopNameSnapshot: 'Test Shop',
    pickupLocationSnapshot: null,
    slot: null,
    totalAmount: Money.fromMajor(199),
    items: [],
    createdAt: NOW,
    updatedAt: NOW,
    version,
  }),
  address,
});

const vendorOrderRepo = (overrides: Partial<VendorOrderRepository> = {}): VendorOrderRepository => {
  const repository: VendorOrderRepository = {
    withTransaction: () => repository,
    findAllByVendor: vi.fn().mockResolvedValue([]),
    findDetailById: vi.fn().mockResolvedValue(buildDetail(OrderStatus.PROCESSING)),
    updateStatusIfVersionMatches: vi.fn().mockResolvedValue(true),
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

const auditWriter = (overrides: Partial<AuditWriter> = {}): AuditWriter => {
  const writer: AuditWriter = {
    withTransaction: () => writer,
    record: vi.fn(),
    ...overrides,
  };
  return writer;
};

const runner = (): TransactionRunner => ({
  run: async (work) => work({} as TransactionScope),
});

interface BuildOverrides {
  vendorRepository?: VendorRepository;
  vendorOrderRepository?: VendorOrderRepository;
  outboxWriter?: OutboxWriter;
  auditWriter?: AuditWriter;
}

const buildUseCase = (overrides: BuildOverrides = {}): MarkReadyForPickupUseCase =>
  new MarkReadyForPickupUseCase({
    vendorRepository: overrides.vendorRepository ?? vendorRepo(),
    vendorOrderRepository: overrides.vendorOrderRepository ?? vendorOrderRepo(),
    outboxWriter: overrides.outboxWriter ?? outboxWriter(),
    auditWriter: overrides.auditWriter ?? auditWriter(),
    transactionRunner: runner(),
    clock,
    logger: new NullLogger(),
  });

const input = { principal, subOrderId };

describe('MarkReadyForPickupUseCase', () => {
  it('moves a PROCESSING PICKUP sub-order to READY_FOR_PICKUP', async () => {
    const useCase = buildUseCase();

    const result = await useCase.execute(input);

    expect(result.subOrder.status).toBe(OrderStatus.READY_FOR_PICKUP);
  });

  it('never touches the parent Order (locked decision #7) and never inventory (locked decision #21)', async () => {
    const vendorOrder = vendorOrderRepo();
    const useCase = buildUseCase({ vendorOrderRepository: vendorOrder });

    await useCase.execute(input);

    expect(vendorOrder.findDetailById).toHaveBeenCalledTimes(1);
    expect(vendorOrder.updateStatusIfVersionMatches).toHaveBeenCalledTimes(1);
  });

  it('writes with the version the sub-order was read at', async () => {
    const vendorOrder = vendorOrderRepo({
      findDetailById: vi
        .fn()
        .mockResolvedValue(buildDetail(OrderStatus.PROCESSING, FulfilmentMode.PICKUP, 5)),
    });
    const useCase = buildUseCase({ vendorOrderRepository: vendorOrder });

    await useCase.execute(input);

    expect(vendorOrder.updateStatusIfVersionMatches).toHaveBeenCalledWith(
      expect.objectContaining({ status: OrderStatus.READY_FOR_PICKUP }),
      5,
    );
  });

  it('rejects with SubOrderConcurrentlyModifiedError when the version was already moved', async () => {
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrderRepo({
        updateStatusIfVersionMatches: vi.fn().mockResolvedValue(false),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(SubOrderConcurrentlyModifiedError);
  });

  it('refuses a sub-order that is not PROCESSING (reuses SubOrder.markReadyForPickup(), no duplicated state machine)', async () => {
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrderRepo({
        findDetailById: vi
          .fn()
          .mockResolvedValue(buildDetail(OrderStatus.CONFIRMED, FulfilmentMode.PICKUP)),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(InvalidOrderStatusTransitionError);
  });

  it('refuses a DELIVERY sub-order, even from PROCESSING (locked decision: PICKUP-only transition)', async () => {
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrderRepo({
        findDetailById: vi
          .fn()
          .mockResolvedValue(buildDetail(OrderStatus.PROCESSING, FulfilmentMode.DELIVERY)),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(FulfilmentModeMismatchError);
  });

  it('rejects with SubOrderNotFoundError for a sub-order that does not belong to the caller', async () => {
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrderRepo({ findDetailById: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(SubOrderNotFoundError);
  });

  it('rejects with VendorNotActiveForOrdersError when the vendor is not ACTIVE, before any write', async () => {
    const vendorOrder = vendorOrderRepo();
    const suspended = VendorProfile.reconstitute({
      id: vendorId,
      userId,
      status: VendorStatus.SUSPENDED,
      plan: 'COMMISSION',
      shopName: 'Test Shop',
      supportsPickup: true,
      shopAddress: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const useCase = buildUseCase({
      vendorRepository: vendorRepo({ findByUserId: vi.fn().mockResolvedValue(suspended) }),
      vendorOrderRepository: vendorOrder,
    });

    await expect(useCase.execute(input)).rejects.toThrow(VendorNotActiveForOrdersError);
    expect(vendorOrder.updateStatusIfVersionMatches).not.toHaveBeenCalled();
  });

  it('writes a sub_order.ready_for_pickup outbox event', async () => {
    const outbox = outboxWriter();
    const useCase = buildUseCase({ outboxWriter: outbox });

    await useCase.execute(input);

    expect(outbox.write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'sub_order.ready_for_pickup',
        aggregateType: 'SubOrder',
      }),
    );
  });

  it('writes an audit record for the transition', async () => {
    const audit = auditWriter();
    const useCase = buildUseCase({ auditWriter: audit });

    await useCase.execute(input);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: userId,
        actorRole: 'VENDOR_OWNER',
        action: 'sub_order.ready_for_pickup',
        entityType: 'SubOrder',
        before: { status: 'PROCESSING' },
        after: { status: 'READY_FOR_PICKUP' },
      }),
    );
  });

  it('does not write outbox or audit when the transition is refused', async () => {
    const outbox = outboxWriter();
    const audit = auditWriter();
    const useCase = buildUseCase({
      outboxWriter: outbox,
      auditWriter: audit,
      vendorOrderRepository: vendorOrderRepo({
        findDetailById: vi
          .fn()
          .mockResolvedValue(buildDetail(OrderStatus.CANCELLED, FulfilmentMode.PICKUP)),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(InvalidOrderStatusTransitionError);
    expect(outbox.write).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
