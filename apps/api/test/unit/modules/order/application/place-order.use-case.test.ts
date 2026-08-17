import { describe, expect, it, vi } from 'vitest';
import { FixedClock, Money, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type {
  InventoryRepository,
  ProductRepository,
  ProductVariantRepository,
} from '../../../../../src/modules/catalogue/index.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import { Product } from '../../../../../src/modules/catalogue/domain/entities/product.entity.js';
import { ProductVariant } from '../../../../../src/modules/catalogue/domain/entities/product-variant.entity.js';
import { Cart } from '../../../../../src/modules/cart/domain/entities/cart.entity.js';
import { CartItem } from '../../../../../src/modules/cart/domain/entities/cart-item.entity.js';
import type { CartItemRepository, CartRepository } from '../../../../../src/modules/cart/index.js';
import { toCartId } from '../../../../../src/modules/cart/domain/value-objects/cart-id.value-object.js';
import { toCartItemId } from '../../../../../src/modules/cart/domain/value-objects/cart-item-id.value-object.js';
import { Address } from '../../../../../src/modules/customer/domain/entities/address.entity.js';
import type { AddressRepository } from '../../../../../src/modules/customer/index.js';
import { toAddressId } from '../../../../../src/modules/customer/domain/value-objects/address-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/index.js';
import type { OutboxWriter } from '../../../../../src/shared/application/ports/outbox-writer.port.js';
import type {
  ResolveCommissionUseCase,
  ResolveTaxUseCase,
} from '../../../../../src/modules/pricing-tax/index.js';
import { PlaceOrderUseCase } from '../../../../../src/modules/order/application/use-cases/place-order.use-case.js';
import {
  EmptyCartError,
  InsufficientStockError,
  OrderAddressNotFoundError,
  PickupNotSupportedByVendorError,
  ProductNotEligibleForOrderError,
  VendorNotEligibleForOrderError,
} from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { FulfilmentMode } from '../../../../../src/modules/order/domain/value-objects/fulfilment-mode.value-object.js';
import type { OrderRepository } from '../../../../../src/modules/order/domain/repositories/order.repository.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);

const customerId = toUserId(ids.generate());
const principal: Principal = {
  userId: customerId,
  sessionId: toSessionId(ids.generate()),
  role: 'CUSTOMER',
};
const addressId = toAddressId(ids.generate());

const vendorId = toVendorId(ids.generate());
const productId = toProductId(ids.generate());
const variantId = toProductVariantId(ids.generate());

const activeVendor = VendorProfile.reconstitute({
  id: vendorId,
  userId: toUserId(ids.generate()),
  status: VendorStatus.ACTIVE,
  plan: 'COMMISSION',
  shopName: 'Test Shop',
  supportsPickup: false,
  shopAddress: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const product = Product.reconstitute({
  id: productId,
  vendorId,
  categoryId: toProductId(ids.generate()) as never,
  name: 'Alphonso Mango',
  brand: null,
  description: null,
  hsnCode: '08045020',
  countryOfOrigin: null,
  netQuantity: null,
  attributeValues: {},
  status: 'APPROVED',
  rejectionReason: null,
  rejectionNote: null,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
});

const variant = ProductVariant.reconstitute({
  id: variantId,
  productId,
  vendorId,
  sku: 'MANGO-1KG' as never,
  name: '1 kg box',
  price: Money.fromMajor(199),
  unitOfMeasure: 'per box',
  quantityStep: 1,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
});

const address = Address.reconstitute({
  id: addressId,
  userId: customerId,
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  landmark: null,
  label: 'Home',
  isDefault: true,
  createdAt: NOW,
  updatedAt: NOW,
});

const cartId = toCartId(ids.generate());
const cart = Cart.reconstitute({ id: cartId, userId: customerId, createdAt: NOW, updatedAt: NOW });
const cartItem = CartItem.reconstitute({
  id: toCartItemId(ids.generate()),
  cartId,
  variantId,
  quantity: 2,
  createdAt: NOW,
  updatedAt: NOW,
});

const cartRepo = (overrides: Partial<CartRepository> = {}): CartRepository => {
  const repository: CartRepository = {
    withTransaction: () => repository,
    findByUserId: vi.fn().mockResolvedValue(cart),
    upsertForUser: vi.fn().mockResolvedValue(cart),
    ...overrides,
  };
  return repository;
};

const cartItemRepo = (overrides: Partial<CartItemRepository> = {}): CartItemRepository => {
  const repository: CartItemRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByCartAndVariant: vi.fn().mockResolvedValue(null),
    findByCartAndId: vi.fn().mockResolvedValue(null),
    listByCartId: vi.fn().mockResolvedValue([cartItem]),
    updateQuantityIfOwned: vi.fn().mockResolvedValue(true),
    softDelete: vi.fn().mockResolvedValue(true),
    softDeleteAllForCart: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
  return repository;
};

const addressRepo = (overrides: Partial<AddressRepository> = {}): AddressRepository => ({
  create: vi.fn(),
  findById: vi.fn().mockResolvedValue(address),
  findAllByUserId: vi.fn().mockResolvedValue([address]),
  update: vi.fn().mockResolvedValue(true),
  remove: vi.fn().mockResolvedValue(true),
  setDefault: vi.fn().mockResolvedValue(true),
  ...overrides,
});

const productRepo = (overrides: Partial<ProductRepository> = {}): ProductRepository => {
  const repository: ProductRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(product),
    update: vi.fn().mockResolvedValue(true),
    listPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    softDelete: vi.fn().mockResolvedValue(true),
    lockForVariantChange: vi.fn().mockResolvedValue(true),
    submitForReviewIfEligible: vi.fn().mockResolvedValue(true),
    decideIfPendingReview: vi.fn().mockResolvedValue(true),
    lockForMediaChange: vi.fn().mockResolvedValue(true),
    reenterReviewIfApproved: vi.fn().mockResolvedValue(true),
    updateAndReenterReviewIfApproved: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return repository;
};

const variantRepo = (
  overrides: Partial<ProductVariantRepository> = {},
): ProductVariantRepository => {
  const repository: ProductVariantRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(variant),
    findByProductAndId: vi.fn().mockResolvedValue(variant),
    listByProductId: vi.fn().mockResolvedValue([variant]),
    update: vi.fn().mockResolvedValue(true),
    countLiveForProduct: vi.fn().mockResolvedValue(1),
    softDelete: vi.fn().mockResolvedValue(true),
    softDeleteAllForProduct: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return repository;
};

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

const orderRepo = (overrides: Partial<OrderRepository> = {}): OrderRepository => {
  const repository: OrderRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByIdAndCustomerId: vi.fn().mockResolvedValue(null),
    findAllByCustomerId: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn(),
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

/** Runs the callback and rethrows on failure — a real transaction's rollback behaviour, nothing swallowed. */
const runner = (): TransactionRunner => ({
  run: async (work) => work({} as TransactionScope),
});

const resolveCommissionUseCase = {
  execute: vi.fn().mockResolvedValue({
    rule: { rateBasisPoints: 1000 },
    commissionAmount: Money.fromMajor(39.8),
  }),
} as unknown as ResolveCommissionUseCase;

const resolveTaxUseCase = {
  execute: vi.fn().mockResolvedValue({ resolved: false, hsnCode: '08045020' }),
} as unknown as ResolveTaxUseCase;

interface BuildOverrides {
  cartRepository?: CartRepository;
  cartItemRepository?: CartItemRepository;
  addressRepository?: AddressRepository;
  productRepository?: ProductRepository;
  productVariantRepository?: ProductVariantRepository;
  vendorRepository?: VendorRepository;
  inventoryRepository?: InventoryRepository;
  orderRepository?: OrderRepository;
  outboxWriter?: OutboxWriter;
  transactionRunner?: TransactionRunner;
  resolveCommissionUseCase?: ResolveCommissionUseCase;
  resolveTaxUseCase?: ResolveTaxUseCase;
}

const defaultDeps = (): Required<BuildOverrides> => ({
  cartRepository: cartRepo(),
  cartItemRepository: cartItemRepo(),
  addressRepository: addressRepo(),
  productRepository: productRepo(),
  productVariantRepository: variantRepo(),
  vendorRepository: vendorRepo(),
  inventoryRepository: inventoryRepo(),
  orderRepository: orderRepo(),
  outboxWriter: outboxWriter(),
  transactionRunner: runner(),
  resolveCommissionUseCase,
  resolveTaxUseCase,
});

const buildUseCase = (overrides: BuildOverrides = {}): PlaceOrderUseCase =>
  new PlaceOrderUseCase({
    ...defaultDeps(),
    ...overrides,
    idGenerator: ids,
    clock,
    logger: new NullLogger(),
  });

const input = { principal, addressId, paymentMethod: 'ONLINE' as const };

// --- S4-QR: a second vendor/product/variant, so the pickup-selection tests
// can build a genuine two-vendor cart. ---
const pickupVendorId = toVendorId(ids.generate());
const pickupProductId = toProductId(ids.generate());
const pickupVariantId = toProductVariantId(ids.generate());

const pickupCapableVendor = VendorProfile.reconstitute({
  id: pickupVendorId,
  userId: toUserId(ids.generate()),
  status: VendorStatus.ACTIVE,
  plan: 'COMMISSION',
  shopName: 'Pickup Shop',
  supportsPickup: true,
  shopAddress: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const pickupProduct = Product.reconstitute({
  id: pickupProductId,
  vendorId: pickupVendorId,
  categoryId: toProductId(ids.generate()) as never,
  name: 'Kesar Mango',
  brand: null,
  description: null,
  hsnCode: '08045020',
  countryOfOrigin: null,
  netQuantity: null,
  attributeValues: {},
  status: 'APPROVED',
  rejectionReason: null,
  rejectionNote: null,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
});

const pickupVariant = ProductVariant.reconstitute({
  id: pickupVariantId,
  productId: pickupProductId,
  vendorId: pickupVendorId,
  sku: 'MANGO-KESAR' as never,
  name: '1 kg box (Kesar)',
  price: Money.fromMajor(249),
  unitOfMeasure: 'per box',
  quantityStep: 1,
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: null,
});

const pickupCartItem = CartItem.reconstitute({
  id: toCartItemId(ids.generate()),
  cartId,
  variantId: pickupVariantId,
  quantity: 1,
  createdAt: NOW,
  updatedAt: NOW,
});

/** Routes findById calls to whichever of the two fixture vendors/products/variants the id names. */
const twoVendorProductRepo = (): ProductRepository =>
  productRepo({
    findById: vi
      .fn()
      .mockImplementation((id: unknown) =>
        Promise.resolve(id === pickupProductId ? pickupProduct : product),
      ),
  });

const twoVendorVariantRepo = (): ProductVariantRepository =>
  variantRepo({
    findById: vi
      .fn()
      .mockImplementation((id: unknown) =>
        Promise.resolve(id === pickupVariantId ? pickupVariant : variant),
      ),
  });

const twoVendorVendorRepo = (): VendorRepository =>
  vendorRepo({
    findById: vi
      .fn()
      .mockImplementation((id: unknown) =>
        Promise.resolve(id === pickupVendorId ? pickupCapableVendor : activeVendor),
      ),
  });

describe('PlaceOrderUseCase', () => {
  it('places an order that starts PENDING_PAYMENT', async () => {
    const useCase = buildUseCase();
    const order = await useCase.execute(input);

    expect(order.status.name).toBe('PENDING_PAYMENT');
    expect(order.customerId).toBe(customerId);
  });

  it('groups a single-vendor cart into exactly one sub-order', async () => {
    const useCase = buildUseCase();
    const order = await useCase.execute(input);

    expect(order.subOrders).toHaveLength(1);
    expect(order.subOrders[0]?.items).toHaveLength(1);
  });

  it('snapshots the resolved product/variant/vendor data onto the order item, never trusting the cart', async () => {
    const useCase = buildUseCase();
    const order = await useCase.execute(input);

    const item = order.subOrders[0]?.items[0];
    expect(item?.productNameSnapshot).toBe('Alphonso Mango');
    expect(item?.variantNameSnapshot).toBe('1 kg box');
    expect(item?.vendorShopNameSnapshot).toBe('Test Shop');
    expect(item?.unitPrice.equals(Money.fromMajor(199))).toBe(true);
    expect(item?.quantity).toBe(2);
  });

  it('rejects with EmptyCartError when the customer has no cart', async () => {
    const useCase = buildUseCase({
      cartRepository: cartRepo({ findByUserId: vi.fn().mockResolvedValue(null) }),
    });
    await expect(useCase.execute(input)).rejects.toThrow(EmptyCartError);
  });

  it('rejects with EmptyCartError when the cart has zero items', async () => {
    const useCase = buildUseCase({
      cartItemRepository: cartItemRepo({ listByCartId: vi.fn().mockResolvedValue([]) }),
    });
    await expect(useCase.execute(input)).rejects.toThrow(EmptyCartError);
  });

  it('rejects with OrderAddressNotFoundError for an address that does not belong to the caller', async () => {
    const useCase = buildUseCase({
      addressRepository: addressRepo({ findById: vi.fn().mockResolvedValue(null) }),
    });
    await expect(useCase.execute(input)).rejects.toThrow(OrderAddressNotFoundError);
  });

  it('rejects with ProductNotEligibleForOrderError when the variant is no longer publicly eligible', async () => {
    const useCase = buildUseCase({
      productVariantRepository: variantRepo({ findById: vi.fn().mockResolvedValue(null) }),
    });
    await expect(useCase.execute(input)).rejects.toThrow(ProductNotEligibleForOrderError);
  });

  it('rejects with VendorNotEligibleForOrderError when the vendor is not ACTIVE', async () => {
    const suspendedVendor = VendorProfile.reconstitute({
      id: vendorId,
      userId: toUserId(ids.generate()),
      status: VendorStatus.SUSPENDED,
      plan: 'COMMISSION',
      shopName: 'Test Shop',
      supportsPickup: false,
      shopAddress: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const useCase = buildUseCase({
      vendorRepository: vendorRepo({ findById: vi.fn().mockResolvedValue(suspendedVendor) }),
    });
    await expect(useCase.execute(input)).rejects.toThrow(VendorNotEligibleForOrderError);
  });

  it('rejects with VendorNotEligibleForOrderError when the vendor has not set a shopName', async () => {
    const noNameVendor = VendorProfile.reconstitute({
      id: vendorId,
      userId: toUserId(ids.generate()),
      status: VendorStatus.ACTIVE,
      plan: 'COMMISSION',
      shopName: null,
      supportsPickup: false,
      shopAddress: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const useCase = buildUseCase({
      vendorRepository: vendorRepo({ findById: vi.fn().mockResolvedValue(noNameVendor) }),
    });
    await expect(useCase.execute(input)).rejects.toThrow(VendorNotEligibleForOrderError);
  });

  it('resolves commission for every line via the vendor plan', async () => {
    const commission = {
      execute: vi.fn().mockResolvedValue({
        rule: { rateBasisPoints: 1000 },
        commissionAmount: Money.fromMajor(39.8),
      }),
    } as unknown as ResolveCommissionUseCase;
    const useCase = buildUseCase({ resolveCommissionUseCase: commission });
    await useCase.execute(input);

    expect(commission.execute).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'COMMISSION' }),
    );
  });

  it('represents unresolved tax honestly — never defaults to ₹0', async () => {
    const useCase = buildUseCase();
    const order = await useCase.execute(input);

    const item = order.subOrders[0]?.items[0];
    expect(item?.tax.resolved).toBe(false);
    expect(item?.tax.amount).toBeNull();
  });

  it('carries a resolved tax amount through to the order item when one exists', async () => {
    const resolved = {
      execute: vi.fn().mockResolvedValue({
        resolved: true,
        rate: { rateBasisPoints: 500 },
        taxAmount: Money.fromMajor(9.48),
      }),
    } as unknown as ResolveTaxUseCase;
    const useCase = buildUseCase({ resolveTaxUseCase: resolved });
    const order = await useCase.execute(input);

    const item = order.subOrders[0]?.items[0];
    expect(item?.tax.resolved).toBe(true);
    expect(item?.tax.rateBasisPoints).toBe(500);
    expect(item?.tax.amount?.equals(Money.fromMajor(9.48))).toBe(true);
  });

  it('decrements inventory atomically for every line inside the transaction', async () => {
    const inventory = inventoryRepo();
    const useCase = buildUseCase({ inventoryRepository: inventory });
    await useCase.execute(input);

    expect(inventory.decrementIfAvailable).toHaveBeenCalledWith(variantId, 2);
  });

  it('rejects with InsufficientStockError when the atomic decrement affects zero rows, and creates no order', async () => {
    const orderRepository = orderRepo();
    const useCase = buildUseCase({
      inventoryRepository: inventoryRepo({
        decrementIfAvailable: vi.fn().mockResolvedValue(false),
      }),
      orderRepository,
    });

    await expect(useCase.execute(input)).rejects.toThrow(InsufficientStockError);
    expect(orderRepository.create).not.toHaveBeenCalled();
  });

  it('writes an OrderPlaced outbox event inside the same transaction as order creation', async () => {
    const outbox = outboxWriter();
    const useCase = buildUseCase({ outboxWriter: outbox });
    await useCase.execute(input);

    expect(outbox.write).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'order.placed', aggregateType: 'Order' }),
    );
  });

  it('clears the cart after a successful placement', async () => {
    const cartItems = cartItemRepo();
    const useCase = buildUseCase({ cartItemRepository: cartItems });
    await useCase.execute(input);

    expect(cartItems.softDeleteAllForCart).toHaveBeenCalledWith(cartId, NOW);
  });

  it('does not fail order placement if clearing the cart afterward throws', async () => {
    const cartItems = cartItemRepo({
      softDeleteAllForCart: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const useCase = buildUseCase({ cartItemRepository: cartItems });

    await expect(useCase.execute(input)).resolves.toBeDefined();
  });

  describe('pickup selection (S4-QR)', () => {
    it('defaults to DELIVERY when pickupVendorIds is omitted — existing checkout calls are unaffected', async () => {
      const useCase = buildUseCase();
      const order = await useCase.execute(input);

      expect(order.subOrders[0]?.fulfilmentMode).toBe(FulfilmentMode.DELIVERY);
    });

    it('sets PICKUP on the sub-order for a vendor named in pickupVendorIds who supports it', async () => {
      const useCase = buildUseCase({
        cartItemRepository: cartItemRepo({
          listByCartId: vi.fn().mockResolvedValue([pickupCartItem]),
        }),
        productRepository: twoVendorProductRepo(),
        productVariantRepository: twoVendorVariantRepo(),
        vendorRepository: twoVendorVendorRepo(),
      });

      const order = await useCase.execute({ ...input, pickupVendorIds: [pickupVendorId] });

      expect(order.subOrders).toHaveLength(1);
      expect(order.subOrders[0]?.fulfilmentMode).toBe(FulfilmentMode.PICKUP);
    });

    it('rejects with PickupNotSupportedByVendorError for a vendor that does not support pickup, and creates no order — never silently downgraded to DELIVERY', async () => {
      const orderRepository = orderRepo();
      const useCase = buildUseCase({ orderRepository });

      await expect(useCase.execute({ ...input, pickupVendorIds: [vendorId] })).rejects.toThrow(
        PickupNotSupportedByVendorError,
      );
      expect(orderRepository.create).not.toHaveBeenCalled();
    });

    it('a multi-vendor cart may freely mix PICKUP and DELIVERY across its sub-orders', async () => {
      const useCase = buildUseCase({
        cartItemRepository: cartItemRepo({
          listByCartId: vi.fn().mockResolvedValue([cartItem, pickupCartItem]),
        }),
        productRepository: twoVendorProductRepo(),
        productVariantRepository: twoVendorVariantRepo(),
        vendorRepository: twoVendorVendorRepo(),
      });

      const order = await useCase.execute({ ...input, pickupVendorIds: [pickupVendorId] });

      expect(order.subOrders).toHaveLength(2);
      const byVendor = new Map(order.subOrders.map((so) => [so.vendorId, so.fulfilmentMode]));
      expect(byVendor.get(vendorId)).toBe(FulfilmentMode.DELIVERY);
      expect(byVendor.get(pickupVendorId)).toBe(FulfilmentMode.PICKUP);
    });
  });
});
