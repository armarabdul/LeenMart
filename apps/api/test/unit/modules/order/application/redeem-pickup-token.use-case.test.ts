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
import { RedeemPickupTokenUseCase } from '../../../../../src/modules/order/application/use-cases/redeem-pickup-token.use-case.js';
import type { PickupTokenSigner } from '../../../../../src/modules/order/application/ports/pickup-token-signer.port.js';
import { PickupToken } from '../../../../../src/modules/order/domain/entities/pickup-token.entity.js';
import { SubOrder } from '../../../../../src/modules/order/domain/entities/sub-order.entity.js';
import { FulfilmentMode } from '../../../../../src/modules/order/domain/value-objects/fulfilment-mode.value-object.js';
import {
  FulfilmentModeMismatchError,
  InvalidOrderStatusTransitionError,
  PickupTokenInvalidError,
  SubOrderConcurrentlyModifiedError,
  VendorNotActiveForOrdersError,
} from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { OrderStatus } from '../../../../../src/modules/order/domain/value-objects/order-status.value-object.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';
import { toPickupTokenId } from '../../../../../src/modules/order/domain/value-objects/pickup-token-id.value-object.js';
import { toSubOrderId } from '../../../../../src/modules/order/domain/value-objects/sub-order-id.value-object.js';
import type {
  VendorOrderRepository,
  VendorSubOrderDetail,
} from '../../../../../src/modules/order/domain/repositories/vendor-order.repository.js';
import type { PickupTokenRepository } from '../../../../../src/modules/order/domain/repositories/pickup-token.repository.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-01T00:00:00.000Z');
const LATER = new Date('2026-08-02T00:00:00.000Z');
const clock = new FixedClock(LATER);

const userId = toUserId(ids.generate());
const vendorId = toVendorId(ids.generate());
const otherVendorId = toVendorId(ids.generate());
const subOrderId = toSubOrderId(ids.generate());
const principal: Principal = {
  userId,
  sessionId: toSessionId(ids.generate()),
  role: 'VENDOR_OWNER',
};
const TOKEN = 'header.payload.signature';
const NONCE = 'a'.repeat(32);

const activeVendor = VendorProfile.reconstitute({
  id: vendorId,
  userId,
  status: VendorStatus.ACTIVE,
  plan: 'COMMISSION',
  shopName: 'Test Shop',
  supportsPickup: true,
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
    findDetailById: vi.fn().mockResolvedValue(buildDetail(OrderStatus.READY_FOR_PICKUP)),
    updateStatusIfVersionMatches: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return repository;
};

const buildPickupToken = (
  overrides: Partial<{ vendorId: typeof vendorId; nonce: string }> = {},
): PickupToken =>
  PickupToken.issue({
    id: toPickupTokenId(ids.generate()),
    subOrderId,
    vendorId: overrides.vendorId ?? vendorId,
    tokenHash: 'x'.repeat(64),
    nonce: overrides.nonce ?? NONCE,
    issuedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 90_000),
  });

const pickupTokenRepo = (overrides: Partial<PickupTokenRepository> = {}): PickupTokenRepository => {
  const repository: PickupTokenRepository = {
    withTransaction: () => repository,
    findBySubOrderId: vi.fn().mockResolvedValue(buildPickupToken()),
    create: vi.fn(),
    rotate: vi.fn(),
    redeemIfIssued: vi.fn().mockResolvedValue(true),
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

const signer = (overrides: Partial<PickupTokenSigner> = {}): PickupTokenSigner => ({
  verify: vi.fn().mockReturnValue({ subOrderId, nonce: NONCE }),
  sign: vi.fn(),
  ...overrides,
});

interface BuildOverrides {
  vendorRepository?: VendorRepository;
  vendorOrderRepository?: VendorOrderRepository;
  pickupTokenRepository?: PickupTokenRepository;
  pickupTokenSigner?: PickupTokenSigner;
  outboxWriter?: OutboxWriter;
  auditWriter?: AuditWriter;
}

const buildUseCase = (overrides: BuildOverrides = {}): RedeemPickupTokenUseCase =>
  new RedeemPickupTokenUseCase({
    vendorRepository: overrides.vendorRepository ?? vendorRepo(),
    vendorOrderRepository: overrides.vendorOrderRepository ?? vendorOrderRepo(),
    pickupTokenRepository: overrides.pickupTokenRepository ?? pickupTokenRepo(),
    pickupTokenSigner: overrides.pickupTokenSigner ?? signer(),
    outboxWriter: overrides.outboxWriter ?? outboxWriter(),
    auditWriter: overrides.auditWriter ?? auditWriter(),
    transactionRunner: runner(),
    clock,
    logger: new NullLogger(),
  });

const input = { principal, token: TOKEN };

describe('RedeemPickupTokenUseCase', () => {
  it('valid token succeeds: moves READY_FOR_PICKUP -> COMPLETED', async () => {
    const useCase = buildUseCase();

    const result = await useCase.execute(input);

    expect(result.subOrder.status).toBe(OrderStatus.COMPLETED);
  });

  it('atomically redeems the token before writing the SubOrder', async () => {
    const tokens = pickupTokenRepo();
    const vendorOrder = vendorOrderRepo();
    const useCase = buildUseCase({
      pickupTokenRepository: tokens,
      vendorOrderRepository: vendorOrder,
    });

    await useCase.execute(input);

    expect(tokens.redeemIfIssued).toHaveBeenCalledTimes(1);
    expect(vendorOrder.updateStatusIfVersionMatches).toHaveBeenCalledTimes(1);
  });

  it('expired/forged/wrong-audience token fails uniformly — any verify() failure becomes PickupTokenInvalidError', async () => {
    const useCase = buildUseCase({
      pickupTokenSigner: signer({
        verify: vi.fn().mockImplementation(() => {
          throw new PickupTokenInvalidError();
        }),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(PickupTokenInvalidError);
  });

  it('wrong sub-order fails: no matching pickup_tokens row (RLS-invisible or never issued)', async () => {
    const useCase = buildUseCase({
      pickupTokenRepository: pickupTokenRepo({ findBySubOrderId: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(PickupTokenInvalidError);
  });

  it('a stale (rotated-out) nonce fails the same uniform way', async () => {
    const useCase = buildUseCase({
      pickupTokenRepository: pickupTokenRepo({
        findBySubOrderId: vi.fn().mockResolvedValue(buildPickupToken({ nonce: 'stale-nonce' })),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(PickupTokenInvalidError);
  });

  it('wrong vendor fails: token belongs to a different vendor_id than the caller', async () => {
    const useCase = buildUseCase({
      pickupTokenRepository: pickupTokenRepo({
        findBySubOrderId: vi.fn().mockResolvedValue(buildPickupToken({ vendorId: otherVendorId })),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(PickupTokenInvalidError);
  });

  it('does not touch the token or the sub-order when the wrong-vendor check fails', async () => {
    const tokens = pickupTokenRepo({
      findBySubOrderId: vi.fn().mockResolvedValue(buildPickupToken({ vendorId: otherVendorId })),
    });
    const vendorOrder = vendorOrderRepo();
    const useCase = buildUseCase({
      pickupTokenRepository: tokens,
      vendorOrderRepository: vendorOrder,
    });

    await expect(useCase.execute(input)).rejects.toThrow(PickupTokenInvalidError);
    expect(tokens.redeemIfIssued).not.toHaveBeenCalled();
    expect(vendorOrder.updateStatusIfVersionMatches).not.toHaveBeenCalled();
  });

  it('already-redeemed token fails generically: the atomic CAS returned false', async () => {
    const vendorOrder = vendorOrderRepo();
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrder,
      pickupTokenRepository: pickupTokenRepo({ redeemIfIssued: vi.fn().mockResolvedValue(false) }),
    });

    // Uniform with a forged token (SEC-15): replay must not disclose that the
    // token was ever valid, nor that the sub-order has already COMPLETED.
    await expect(useCase.execute(input)).rejects.toThrow(PickupTokenInvalidError);
    // The CAS is the first write, so a losing caller never reads or touches
    // the SubOrder at all.
    expect(vendorOrder.updateStatusIfVersionMatches).not.toHaveBeenCalled();
  });

  it('vendor without an ACTIVE profile is refused before any token verification', async () => {
    const vendorOrder = vendorOrderRepo();
    const pickupTokenSignerVerify = vi.fn();
    const suspended = VendorProfile.reconstitute({
      id: vendorId,
      userId,
      status: VendorStatus.SUSPENDED,
      plan: 'COMMISSION',
      shopName: 'Test Shop',
      supportsPickup: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const useCase = buildUseCase({
      vendorRepository: vendorRepo({ findByUserId: vi.fn().mockResolvedValue(suspended) }),
      vendorOrderRepository: vendorOrder,
      pickupTokenSigner: signer({ verify: pickupTokenSignerVerify }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(VendorNotActiveForOrdersError);
    expect(pickupTokenSignerVerify).not.toHaveBeenCalled();
  });

  it('PICKUP SubOrder that is not READY_FOR_PICKUP refuses completion (invalid state transition)', async () => {
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrderRepo({
        findDetailById: vi
          .fn()
          .mockResolvedValue(buildDetail(OrderStatus.PROCESSING, FulfilmentMode.PICKUP)),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(InvalidOrderStatusTransitionError);
  });

  it('refuses to complete an already-COMPLETED sub-order (repeated redemption)', async () => {
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrderRepo({
        findDetailById: vi
          .fn()
          .mockResolvedValue(buildDetail(OrderStatus.COMPLETED, FulfilmentMode.PICKUP)),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(InvalidOrderStatusTransitionError);
  });

  it('refuses a DELIVERY sub-order — this is the pickup-only completion path', async () => {
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrderRepo({
        findDetailById: vi
          .fn()
          .mockResolvedValue(buildDetail(OrderStatus.READY_FOR_PICKUP, FulfilmentMode.DELIVERY)),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(FulfilmentModeMismatchError);
  });

  it('rejects with SubOrderConcurrentlyModifiedError when the version was already moved', async () => {
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrderRepo({
        updateStatusIfVersionMatches: vi.fn().mockResolvedValue(false),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(SubOrderConcurrentlyModifiedError);
  });

  it('writes a sub_order.pickup_completed outbox event on success', async () => {
    const outbox = outboxWriter();
    const useCase = buildUseCase({ outboxWriter: outbox });

    await useCase.execute(input);

    expect(outbox.write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'sub_order.pickup_completed',
        aggregateType: 'SubOrder',
      }),
    );
  });

  it('writes an audit record naming the redeeming vendor as the actor', async () => {
    const audit = auditWriter();
    const useCase = buildUseCase({ auditWriter: audit });

    await useCase.execute(input);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: userId,
        action: 'sub_order.pickup_completed',
        entityType: 'SubOrder',
        before: { status: 'READY_FOR_PICKUP' },
        after: { status: 'COMPLETED' },
      }),
    );
  });

  it('does not write outbox or audit when redemption is refused', async () => {
    const outbox = outboxWriter();
    const audit = auditWriter();
    const useCase = buildUseCase({
      outboxWriter: outbox,
      auditWriter: audit,
      pickupTokenRepository: pickupTokenRepo({ redeemIfIssued: vi.fn().mockResolvedValue(false) }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(PickupTokenInvalidError);
    expect(outbox.write).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
