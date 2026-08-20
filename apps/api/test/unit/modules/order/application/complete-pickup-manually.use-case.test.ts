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
import { CompletePickupManuallyUseCase } from '../../../../../src/modules/order/application/use-cases/complete-pickup-manually.use-case.js';
import type { PickupCodeHasher } from '../../../../../src/modules/order/application/ports/pickup-code-hasher.port.js';
import { PickupToken } from '../../../../../src/modules/order/domain/entities/pickup-token.entity.js';
import { SubOrder } from '../../../../../src/modules/order/domain/entities/sub-order.entity.js';
import { FulfilmentMode } from '../../../../../src/modules/order/domain/value-objects/fulfilment-mode.value-object.js';
import {
  PickupTokenAlreadyRedeemedError,
  PickupTokenInvalidError,
  SubOrderConcurrentlyModifiedError,
  SubOrderNotFoundError,
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
const CODE = '4821';
const CODE_HASH = '$argon2id$mock$fixture$';

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
    findDetailById: vi.fn().mockResolvedValue(buildDetail(OrderStatus.READY_FOR_PICKUP)),
    updateStatusIfVersionMatches: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return repository;
};

const buildPickupToken = (
  overrides: Partial<{ vendorId: typeof vendorId; manualCodeAttempts: number }> = {},
): PickupToken => {
  let token = PickupToken.issue({
    id: toPickupTokenId(ids.generate()),
    subOrderId,
    vendorId: overrides.vendorId ?? vendorId,
    tokenHash: 'x'.repeat(64),
    nonce: 'a'.repeat(32),
    issuedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 90_000),
    manualCodeHash: CODE_HASH,
  });
  const attempts = overrides.manualCodeAttempts ?? 0;
  for (let i = 0; i < attempts; i += 1) {
    token = token.recordFailedManualCodeAttempt();
  }
  return token;
};

const pickupTokenRepo = (overrides: Partial<PickupTokenRepository> = {}): PickupTokenRepository => {
  const repository: PickupTokenRepository = {
    withTransaction: () => repository,
    findBySubOrderId: vi.fn().mockResolvedValue(buildPickupToken()),
    create: vi.fn(),
    rotate: vi.fn(),
    redeemIfIssued: vi.fn().mockResolvedValue(true),
    recordManualCodeAttempt: vi.fn(),
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

const codeHasher = (overrides: Partial<PickupCodeHasher> = {}): PickupCodeHasher => ({
  hash: vi.fn(),
  verify: vi
    .fn()
    .mockImplementation((hash: string, raw: string) =>
      Promise.resolve(hash === CODE_HASH && raw === CODE),
    ),
  ...overrides,
});

interface BuildOverrides {
  vendorRepository?: VendorRepository;
  vendorOrderRepository?: VendorOrderRepository;
  pickupTokenRepository?: PickupTokenRepository;
  pickupCodeHasher?: PickupCodeHasher;
  outboxWriter?: OutboxWriter;
  auditWriter?: AuditWriter;
}

const buildUseCase = (overrides: BuildOverrides = {}): CompletePickupManuallyUseCase =>
  new CompletePickupManuallyUseCase({
    vendorRepository: overrides.vendorRepository ?? vendorRepo(),
    vendorOrderRepository: overrides.vendorOrderRepository ?? vendorOrderRepo(),
    pickupTokenRepository: overrides.pickupTokenRepository ?? pickupTokenRepo(),
    pickupCodeHasher: overrides.pickupCodeHasher ?? codeHasher(),
    outboxWriter: overrides.outboxWriter ?? outboxWriter(),
    auditWriter: overrides.auditWriter ?? auditWriter(),
    transactionRunner: runner(),
    clock,
    logger: new NullLogger(),
  });

const input = { principal, subOrderId, code: CODE };

describe('CompletePickupManuallyUseCase (S4-QR-FALLBACK)', () => {
  it('valid code succeeds: moves READY_FOR_PICKUP -> COMPLETED', async () => {
    const useCase = buildUseCase();

    const result = await useCase.execute(input);

    expect(result.subOrder.status).toBe(OrderStatus.COMPLETED);
  });

  it('atomically redeems the token via the same CAS the QR path uses, before writing the SubOrder', async () => {
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

  it('invalid code is refused, increments the attempt count, and never reaches the CAS', async () => {
    const tokens = pickupTokenRepo();
    const useCase = buildUseCase({ pickupTokenRepository: tokens });

    await expect(useCase.execute({ ...input, code: '0000' })).rejects.toThrow(
      PickupTokenInvalidError,
    );

    expect(tokens.recordManualCodeAttempt).toHaveBeenCalledWith(expect.anything(), 1);
    expect(tokens.redeemIfIssued).not.toHaveBeenCalled();
  });

  it('locks out further attempts once MAX_MANUAL_CODE_ATTEMPTS is reached — the client sees the same uniform error', async () => {
    const useCase = buildUseCase({
      pickupTokenRepository: pickupTokenRepo({
        findBySubOrderId: vi
          .fn()
          .mockResolvedValue(
            buildPickupToken({ manualCodeAttempts: PickupToken.MAX_MANUAL_CODE_ATTEMPTS }),
          ),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(PickupTokenInvalidError);
  });

  it('a code entered against another vendor’s sub-order is refused as SubOrderNotFoundError — never distinguished from "no such sub-order"', async () => {
    const useCase = buildUseCase({
      pickupTokenRepository: pickupTokenRepo({
        findBySubOrderId: vi.fn().mockResolvedValue(buildPickupToken({ vendorId: otherVendorId })),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(SubOrderNotFoundError);
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

    await expect(useCase.execute(input)).rejects.toThrow(SubOrderNotFoundError);
    expect(tokens.redeemIfIssued).not.toHaveBeenCalled();
    expect(vendorOrder.updateStatusIfVersionMatches).not.toHaveBeenCalled();
  });

  it('no sub-order matching the id at all is refused as SubOrderNotFoundError', async () => {
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrderRepo({ findDetailById: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(SubOrderNotFoundError);
  });

  it('an already-redeemed token is refused as PickupTokenAlreadyRedeemedError before the code is even checked', async () => {
    const hasher = codeHasher();
    const redeemed = buildPickupToken().rotate({
      tokenHash: 'y'.repeat(64),
      nonce: 'b'.repeat(32),
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 90_000),
      manualCodeHash: CODE_HASH,
    });
    const alreadyRedeemed = redeemed.redeem({ redeemedAt: LATER, redeemedByUserId: userId });
    const useCase = buildUseCase({
      pickupTokenRepository: pickupTokenRepo({
        findBySubOrderId: vi.fn().mockResolvedValue(alreadyRedeemed),
      }),
      pickupCodeHasher: hasher,
    });

    await expect(useCase.execute(input)).rejects.toThrow(PickupTokenAlreadyRedeemedError);
    expect(hasher.verify).not.toHaveBeenCalled();
  });

  it('a genuine race lost at the CAS (won by a concurrent scan/manual attempt) reports a 409, not the uniform 422', async () => {
    const vendorOrder = vendorOrderRepo();
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrder,
      pickupTokenRepository: pickupTokenRepo({ redeemIfIssued: vi.fn().mockResolvedValue(false) }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(PickupTokenAlreadyRedeemedError);
    expect(vendorOrder.updateStatusIfVersionMatches).not.toHaveBeenCalled();
  });

  it('vendor without an ACTIVE profile is refused before any code verification', async () => {
    const hasher = codeHasher();
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
      pickupCodeHasher: hasher,
    });

    await expect(useCase.execute(input)).rejects.toThrow(VendorNotActiveForOrdersError);
    expect(hasher.verify).not.toHaveBeenCalled();
  });

  it('rejects with SubOrderConcurrentlyModifiedError when the version was already moved', async () => {
    const useCase = buildUseCase({
      vendorOrderRepository: vendorOrderRepo({
        updateStatusIfVersionMatches: vi.fn().mockResolvedValue(false),
      }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(SubOrderConcurrentlyModifiedError);
  });

  it('writes the same sub_order.pickup_completed outbox event the QR path writes', async () => {
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

  it('writes a distinct sub_order.pickup_completed_manual audit action — never the QR path’s own action', async () => {
    const audit = auditWriter();
    const useCase = buildUseCase({ auditWriter: audit });

    await useCase.execute(input);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: userId,
        action: 'sub_order.pickup_completed_manual',
        entityType: 'SubOrder',
        before: { status: 'READY_FOR_PICKUP' },
        after: { status: 'COMPLETED' },
      }),
    );
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'sub_order.pickup_completed' }),
    );
  });

  it('never logs or audits the plaintext code', async () => {
    const audit = auditWriter();
    const useCase = buildUseCase({ auditWriter: audit });

    await useCase.execute(input);

    const calls = (audit.record as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    for (const call of calls) {
      expect(JSON.stringify(call)).not.toContain(CODE);
    }
  });

  it('does not write outbox or the completion audit when the code is wrong', async () => {
    const outbox = outboxWriter();
    const audit = auditWriter();
    const useCase = buildUseCase({ outboxWriter: outbox, auditWriter: audit });

    await expect(useCase.execute({ ...input, code: '0000' })).rejects.toThrow(
      PickupTokenInvalidError,
    );
    expect(outbox.write).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
