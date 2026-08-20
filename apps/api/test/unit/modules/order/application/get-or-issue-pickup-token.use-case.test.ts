import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Money, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { GetOrIssuePickupTokenUseCase } from '../../../../../src/modules/order/application/use-cases/get-or-issue-pickup-token.use-case.js';
import type { PickupTokenSigner } from '../../../../../src/modules/order/application/ports/pickup-token-signer.port.js';
import type { PickupCodeGenerator } from '../../../../../src/modules/order/application/ports/pickup-code-generator.port.js';
import type { PickupCodeHasher } from '../../../../../src/modules/order/application/ports/pickup-code-hasher.port.js';
import { Order } from '../../../../../src/modules/order/domain/entities/order.entity.js';
import { PickupToken } from '../../../../../src/modules/order/domain/entities/pickup-token.entity.js';
import { SubOrder } from '../../../../../src/modules/order/domain/entities/sub-order.entity.js';
import {
  FulfilmentModeMismatchError,
  OrderNotFoundError,
  PickupTokenNotAvailableError,
  SubOrderNotFoundError,
} from '../../../../../src/modules/order/domain/errors/order-errors.js';
import type { OrderRepository } from '../../../../../src/modules/order/domain/repositories/order.repository.js';
import type { PickupTokenRepository } from '../../../../../src/modules/order/domain/repositories/pickup-token.repository.js';
import { FulfilmentMode } from '../../../../../src/modules/order/domain/value-objects/fulfilment-mode.value-object.js';
import { OrderStatus } from '../../../../../src/modules/order/domain/value-objects/order-status.value-object.js';
import { toOrderId } from '../../../../../src/modules/order/domain/value-objects/order-id.value-object.js';
import { toPickupTokenId } from '../../../../../src/modules/order/domain/value-objects/pickup-token-id.value-object.js';
import { toSubOrderId } from '../../../../../src/modules/order/domain/value-objects/sub-order-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-01T00:00:00.000Z');
const customerId = toUserId(ids.generate());
const principal: Principal = {
  userId: customerId,
  sessionId: toSessionId(ids.generate()),
  role: 'CUSTOMER',
};
const orderId = toOrderId(ids.generate());
const vendorId = toVendorId(ids.generate());
const subOrderId = toSubOrderId(ids.generate());

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

const buildSubOrder = (status: OrderStatus, fulfilmentMode: FulfilmentMode): SubOrder =>
  SubOrder.reconstitute({
    id: subOrderId,
    orderId,
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
    version: 1,
  });

const buildOrder = (subOrders: readonly SubOrder[]): Order =>
  Order.place({
    id: orderId,
    customerId,
    totalAmount: Money.fromMajor(199),
    address,
    subOrders,
    now: NOW,
  });

const readyPickupOrder = buildOrder([
  buildSubOrder(OrderStatus.READY_FOR_PICKUP, FulfilmentMode.PICKUP),
]);

const orderRepo = (overrides: Partial<OrderRepository> = {}): OrderRepository => {
  const repository: OrderRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByIdAndCustomerId: vi.fn().mockResolvedValue(readyPickupOrder),
    findAllByCustomerId: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn(),
    ...overrides,
  };
  return repository;
};

const pickupTokenRepo = (overrides: Partial<PickupTokenRepository> = {}): PickupTokenRepository => {
  const repository: PickupTokenRepository = {
    withTransaction: () => repository,
    findBySubOrderId: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    rotate: vi.fn(),
    redeemIfIssued: vi.fn(),
    recordManualCodeAttempt: vi.fn(),
    ...overrides,
  };
  return repository;
};

const SIGNED_TOKEN = {
  token: 'header.payload.signature',
  nonce: 'a'.repeat(32),
  issuedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 90_000),
};

const MANUAL_CODE = '4821';
const MANUAL_CODE_HASH = '$argon2id$mock$fixture$';

const signer = (): PickupTokenSigner => ({
  sign: vi.fn().mockReturnValue(SIGNED_TOKEN),
  verify: vi.fn(),
});

const codeGenerator = (): PickupCodeGenerator => ({
  generate: vi.fn().mockReturnValue(MANUAL_CODE),
});

const codeHasher = (): PickupCodeHasher => ({
  hash: vi.fn().mockResolvedValue(MANUAL_CODE_HASH),
  verify: vi.fn(),
});

const buildUseCase = (
  deps: {
    orderRepository?: OrderRepository;
    pickupTokenRepository?: PickupTokenRepository;
    pickupTokenSigner?: PickupTokenSigner;
    pickupCodeGenerator?: PickupCodeGenerator;
    pickupCodeHasher?: PickupCodeHasher;
  } = {},
): GetOrIssuePickupTokenUseCase =>
  new GetOrIssuePickupTokenUseCase({
    orderRepository: deps.orderRepository ?? orderRepo(),
    pickupTokenRepository: deps.pickupTokenRepository ?? pickupTokenRepo(),
    pickupTokenSigner: deps.pickupTokenSigner ?? signer(),
    pickupCodeGenerator: deps.pickupCodeGenerator ?? codeGenerator(),
    pickupCodeHasher: deps.pickupCodeHasher ?? codeHasher(),
    idGenerator: ids,
    logger: new NullLogger(),
  });

const input = { principal, orderId, subOrderId };

describe('GetOrIssuePickupTokenUseCase', () => {
  it('issues a fresh token when none has been issued yet', async () => {
    const tokens = pickupTokenRepo();
    const useCase = buildUseCase({ pickupTokenRepository: tokens });

    const result = await useCase.execute(input);

    expect(result.token).toBe(SIGNED_TOKEN.token);
    expect(result.expiresAt).toEqual(SIGNED_TOKEN.expiresAt);
    expect(tokens.create).toHaveBeenCalledTimes(1);
    expect(tokens.rotate).not.toHaveBeenCalled();
  });

  it('stores the SHA-256 hash of the signed token, not the token itself', async () => {
    const tokens = pickupTokenRepo();
    const useCase = buildUseCase({ pickupTokenRepository: tokens });

    await useCase.execute(input);

    const expectedHash = createHash('sha256').update(SIGNED_TOKEN.token).digest('hex');
    expect(tokens.create).toHaveBeenCalledWith(
      expect.objectContaining({ tokenHash: expectedHash, nonce: SIGNED_TOKEN.nonce }),
    );
  });

  it('mints a manual fallback code, stores only its hash, and returns the plaintext once (S4-QR-FALLBACK)', async () => {
    const tokens = pickupTokenRepo();
    const hasher = codeHasher();
    const useCase = buildUseCase({ pickupTokenRepository: tokens, pickupCodeHasher: hasher });

    const result = await useCase.execute(input);

    expect(result.manualCode).toBe(MANUAL_CODE);
    expect(hasher.hash).toHaveBeenCalledWith(MANUAL_CODE);
    expect(tokens.create).toHaveBeenCalledWith(
      expect.objectContaining({ manualCodeHash: MANUAL_CODE_HASH }),
    );
    const created = (tokens.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as PickupToken;
    expect(JSON.stringify(created)).not.toContain(MANUAL_CODE);
  });

  it('rotates the manual code in lockstep with the QR token, never deriving it from the nonce', async () => {
    const existing = PickupToken.issue({
      id: toPickupTokenId(ids.generate()),
      subOrderId,
      vendorId,
      tokenHash: 'old-hash',
      nonce: 'old-nonce',
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 90_000),
      manualCodeHash: 'old-manual-code-hash',
    });
    const tokens = pickupTokenRepo({ findBySubOrderId: vi.fn().mockResolvedValue(existing) });
    const generator = codeGenerator();
    const useCase = buildUseCase({ pickupTokenRepository: tokens, pickupCodeGenerator: generator });

    const result = await useCase.execute(input);

    expect(generator.generate).toHaveBeenCalledTimes(1);
    expect(result.manualCode).toBe(MANUAL_CODE);
    expect(tokens.rotate).toHaveBeenCalledWith(
      expect.objectContaining({ manualCodeHash: MANUAL_CODE_HASH }),
    );
  });

  it('rotates the existing row on a later call instead of creating a second one', async () => {
    const existing = PickupToken.issue({
      id: toPickupTokenId(ids.generate()),
      subOrderId,
      vendorId,
      tokenHash: 'old-hash',
      nonce: 'old-nonce',
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 90_000),
      manualCodeHash: 'old-manual-code-hash',
    });
    const tokens = pickupTokenRepo({ findBySubOrderId: vi.fn().mockResolvedValue(existing) });
    const useCase = buildUseCase({ pickupTokenRepository: tokens });

    await useCase.execute(input);

    expect(tokens.rotate).toHaveBeenCalledTimes(1);
    expect(tokens.create).not.toHaveBeenCalled();
  });

  it('never touches status — only RedeemPickupTokenUseCase does that', async () => {
    const existing = PickupToken.issue({
      id: toPickupTokenId(ids.generate()),
      subOrderId,
      vendorId,
      tokenHash: 'old-hash',
      nonce: 'old-nonce',
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 90_000),
      manualCodeHash: 'old-manual-code-hash',
    });
    const tokens = pickupTokenRepo({ findBySubOrderId: vi.fn().mockResolvedValue(existing) });
    const useCase = buildUseCase({ pickupTokenRepository: tokens });

    await useCase.execute(input);

    const rotated = (tokens.rotate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as PickupToken;
    expect(rotated.status).toBe('ISSUED');
  });

  it('signs a fresh token via the signer on every call (SDD 13.1 rotation)', async () => {
    const pickupTokenSigner = signer();
    const useCase = buildUseCase({ pickupTokenSigner });

    await useCase.execute(input);
    await useCase.execute(input);

    expect(pickupTokenSigner.sign).toHaveBeenCalledTimes(2);
    expect(pickupTokenSigner.sign).toHaveBeenCalledWith(subOrderId);
  });

  it('rejects with OrderNotFoundError when the order does not belong to the caller', async () => {
    const useCase = buildUseCase({
      orderRepository: orderRepo({ findByIdAndCustomerId: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute(input)).rejects.toThrow(OrderNotFoundError);
  });

  it('rejects with SubOrderNotFoundError when the sub-order id does not belong to this order', async () => {
    const otherSubOrderId = toSubOrderId(ids.generate());
    const useCase = buildUseCase({
      orderRepository: orderRepo({
        findByIdAndCustomerId: vi.fn().mockResolvedValue(readyPickupOrder),
      }),
    });

    await expect(useCase.execute({ ...input, subOrderId: otherSubOrderId })).rejects.toThrow(
      SubOrderNotFoundError,
    );
  });

  it('rejects with FulfilmentModeMismatchError for a DELIVERY sub-order', () => {
    const deliveryOrder = buildOrder([
      buildSubOrder(OrderStatus.READY_FOR_PICKUP, FulfilmentMode.DELIVERY),
    ]);
    const useCase = buildUseCase({
      orderRepository: orderRepo({
        findByIdAndCustomerId: vi.fn().mockResolvedValue(deliveryOrder),
      }),
    });

    return expect(useCase.execute(input)).rejects.toThrow(FulfilmentModeMismatchError);
  });

  it('rejects with PickupTokenNotAvailableError before the vendor marks READY_FOR_PICKUP', () => {
    const notReadyOrder = buildOrder([
      buildSubOrder(OrderStatus.PROCESSING, FulfilmentMode.PICKUP),
    ]);
    const useCase = buildUseCase({
      orderRepository: orderRepo({
        findByIdAndCustomerId: vi.fn().mockResolvedValue(notReadyOrder),
      }),
    });

    return expect(useCase.execute(input)).rejects.toThrow(PickupTokenNotAvailableError);
  });

  it('rejects with PickupTokenNotAvailableError after the pickup has already COMPLETED', () => {
    const completedOrder = buildOrder([
      buildSubOrder(OrderStatus.COMPLETED, FulfilmentMode.PICKUP),
    ]);
    const useCase = buildUseCase({
      orderRepository: orderRepo({
        findByIdAndCustomerId: vi.fn().mockResolvedValue(completedOrder),
      }),
    });

    return expect(useCase.execute(input)).rejects.toThrow(PickupTokenNotAvailableError);
  });
});
