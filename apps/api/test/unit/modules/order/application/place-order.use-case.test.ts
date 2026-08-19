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
import type { SlotAvailabilityRepository } from '../../../../../src/modules/vendor/domain/repositories/delivery-slot.repository.js';
import type { Order } from '../../../../../src/modules/order/domain/entities/order.entity.js';
import type { OutboxWriter } from '../../../../../src/shared/application/ports/outbox-writer.port.js';
import type {
  ResolveCommissionUseCase,
  ResolveTaxUseCase,
} from '../../../../../src/modules/pricing-tax/index.js';
import type { ResolveServiceabilityUseCase } from '../../../../../src/modules/order/application/use-cases/resolve-serviceability.use-case.js';
import type { ResolveBusinessHoursUseCase } from '../../../../../src/modules/order/application/use-cases/resolve-business-hours.use-case.js';
import type {
  ResolveSlotSelectionUseCase,
  ResolvedSlot,
} from '../../../../../src/modules/order/application/use-cases/resolve-slot-selection.use-case.js';
import { PlaceOrderUseCase } from '../../../../../src/modules/order/application/use-cases/place-order.use-case.js';
import {
  EmptyCartError,
  InsufficientStockError,
  OrderAddressNotFoundError,
  OrderSlotUnavailableError,
  AddressNotServiceableError,
  PickupNotSupportedByVendorError,
  ProductNotEligibleForOrderError,
  VendorClosedForDeliveryError,
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

/**
 * S4-SERV. Default: nothing is unserviceable, so every pre-existing
 * expectation in this file is unaffected. Tests that care override it.
 */
/**
 * S4-HOURS. Default: nothing is closed, so every pre-existing expectation in
 * this file is unaffected. Tests that care override it.
 */
const businessHoursUseCase = (closed: readonly unknown[] = []): ResolveBusinessHoursUseCase =>
  ({ execute: vi.fn().mockResolvedValue(closed) }) as unknown as ResolveBusinessHoursUseCase;

const serviceabilityUseCase = (
  unserviceable: readonly unknown[] = [],
): ResolveServiceabilityUseCase =>
  ({
    execute: vi.fn().mockResolvedValue(unserviceable),
  }) as unknown as ResolveServiceabilityUseCase;

/**
 * S4-SLOTS. Returns nothing by default, which is the "vendor offers no
 * windows" case — so every test written before this milestone keeps its
 * meaning without naming a slot.
 */
const slotSelectionUseCase = (
  resolved: ReadonlyMap<unknown, unknown> = new Map(),
): ResolveSlotSelectionUseCase =>
  ({ execute: vi.fn().mockResolvedValue(resolved) }) as unknown as ResolveSlotSelectionUseCase;

/** Records what capacity was taken, and can be told to refuse. */
const slotRepo = (
  consumable = true,
): SlotAvailabilityRepository & { consume: ReturnType<typeof vi.fn> } => {
  const consume = vi.fn().mockResolvedValue(consumable);
  const repository = {
    withTransaction: () => repository,
    findTemplatesForVendors: vi.fn().mockResolvedValue(new Map()),
    findBookingsForVendors: vi.fn().mockResolvedValue(new Map()),
    consume,
    release: vi.fn().mockResolvedValue(undefined),
  };
  return repository as unknown as SlotAvailabilityRepository & {
    consume: ReturnType<typeof vi.fn>;
  };
};

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
  resolveServiceabilityUseCase?: ResolveServiceabilityUseCase;
  resolveBusinessHoursUseCase?: ResolveBusinessHoursUseCase;
  resolveSlotSelectionUseCase?: ResolveSlotSelectionUseCase;
  slotAvailabilityRepository?: SlotAvailabilityRepository;
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
  resolveServiceabilityUseCase: serviceabilityUseCase(),
  resolveBusinessHoursUseCase: businessHoursUseCase(),
  resolveSlotSelectionUseCase: slotSelectionUseCase(),
  slotAvailabilityRepository: slotRepo(),
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
  describe('inventory lock ordering (M2)', () => {
    /** The sequence of variant ids the placement actually decremented. */
    const decrementOrder = (repository: InventoryRepository): string[] =>
      (repository.decrementIfAvailable as ReturnType<typeof vi.fn>).mock.calls.map(
        (call) => call[0] as string,
      );

    const twoLineUseCase = (
      items: readonly unknown[],
      inventoryRepository: InventoryRepository,
    ): PlaceOrderUseCase =>
      buildUseCase({
        inventoryRepository,
        cartItemRepository: cartItemRepo({
          listByCartId: vi.fn().mockResolvedValue(items),
        }),
        productRepository: twoVendorProductRepo(),
        productVariantRepository: twoVendorVariantRepo(),
        vendorRepository: twoVendorVendorRepo(),
      });

    const twoLineInput = { ...input, pickupVendorIds: [pickupVendorId] };

    it('decrements in a stable order, not cart order', async () => {
      const inventory = inventoryRepo();

      await twoLineUseCase([cartItem, pickupCartItem], inventory).execute(twoLineInput);

      const expected = [variantId, pickupVariantId].sort((a, b) => a.localeCompare(b));
      expect(decrementOrder(inventory)).toEqual(expected);
    });

    it('takes the same rows in the same order whichever way the cart is arranged', async () => {
      // The deadlock this prevents: two concurrent orders holding the same two
      // variants in opposite cart order, each waiting on the row the other has
      // already taken.
      const first = inventoryRepo();
      const second = inventoryRepo();

      await twoLineUseCase([cartItem, pickupCartItem], first).execute(twoLineInput);
      await twoLineUseCase([pickupCartItem, cartItem], second).execute(twoLineInput);

      expect(decrementOrder(first)).toEqual(decrementOrder(second));
    });

    it('still decrements every line, with its own quantity', async () => {
      // Ordering is all that changed — no line is dropped or merged.
      const inventory = inventoryRepo();

      await twoLineUseCase([cartItem, pickupCartItem], inventory).execute(twoLineInput);

      expect(inventory.decrementIfAvailable).toHaveBeenCalledTimes(2);
      expect(inventory.decrementIfAvailable).toHaveBeenCalledWith(variantId, cartItem.quantity);
      expect(inventory.decrementIfAvailable).toHaveBeenCalledWith(
        pickupVariantId,
        pickupCartItem.quantity,
      );
    });

    it('still refuses the whole order when any line is short', async () => {
      const orderRepository = orderRepo();
      const inventory = inventoryRepo({
        decrementIfAvailable: vi.fn().mockResolvedValue(false),
      });

      await expect(
        buildUseCase({ orderRepository, inventoryRepository: inventory }).execute(input),
      ).rejects.toThrow(InsufficientStockError);
      expect(orderRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('delivery serviceability (S4-SERV)', () => {
    it('places the order when every delivery vendor serves the address', async () => {
      const useCase = buildUseCase({ resolveServiceabilityUseCase: serviceabilityUseCase([]) });

      const order = await useCase.execute(input);

      expect(order.subOrders).toHaveLength(1);
    });

    it('rejects the whole order when a delivery vendor does not serve the address (D4)', async () => {
      const orderRepository = orderRepo();
      const useCase = buildUseCase({
        orderRepository,
        resolveServiceabilityUseCase: serviceabilityUseCase([vendorId]),
      });

      await expect(useCase.execute(input)).rejects.toThrow(AddressNotServiceableError);
      // All-or-nothing: nothing is written, and no sub-order is quietly
      // flipped to PICKUP to make the order fit.
      expect(orderRepository.create).not.toHaveBeenCalled();
    });

    it('checks serviceability before pricing, so a refused order costs no tax or commission work', async () => {
      // These spies are module-level and shared across the file, so the
      // assertion below is about *this* execution rather than the suite's.
      vi.mocked(resolveTaxUseCase.execute).mockClear();
      vi.mocked(resolveCommissionUseCase.execute).mockClear();
      const useCase = buildUseCase({
        resolveServiceabilityUseCase: serviceabilityUseCase([vendorId]),
      });

      await expect(useCase.execute(input)).rejects.toThrow(AddressNotServiceableError);

      // SDD 4.2 puts step 4b ahead of steps 4d/4e.
      expect(resolveTaxUseCase.execute).not.toHaveBeenCalled();
      expect(resolveCommissionUseCase.execute).not.toHaveBeenCalled();
    });

    it('uses the pincode from the stored address, never one supplied by the caller', async () => {
      const resolveServiceabilityUseCase = serviceabilityUseCase([]);
      const useCase = buildUseCase({ resolveServiceabilityUseCase });

      await useCase.execute(input);

      expect(resolveServiceabilityUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ pincode: address.pincode }),
      );
    });

    it('excludes a PICKUP vendor from the serviceability check entirely (D6)', async () => {
      const resolveServiceabilityUseCase = serviceabilityUseCase([]);
      const useCase = buildUseCase({
        cartItemRepository: cartItemRepo({
          listByCartId: vi.fn().mockResolvedValue([pickupCartItem]),
        }),
        productRepository: twoVendorProductRepo(),
        productVariantRepository: twoVendorVariantRepo(),
        vendorRepository: twoVendorVendorRepo(),
        resolveServiceabilityUseCase,
      });

      await useCase.execute({ ...input, pickupVendorIds: [pickupVendorId] });

      expect(resolveServiceabilityUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryVendorIds: [] }),
      );
    });

    it('checks only the DELIVERY half of a mixed-fulfilment cart', async () => {
      const resolveServiceabilityUseCase = serviceabilityUseCase([]);
      const useCase = buildUseCase({
        cartItemRepository: cartItemRepo({
          listByCartId: vi.fn().mockResolvedValue([cartItem, pickupCartItem]),
        }),
        productRepository: twoVendorProductRepo(),
        productVariantRepository: twoVendorVariantRepo(),
        vendorRepository: twoVendorVendorRepo(),
        resolveServiceabilityUseCase,
      });

      await useCase.execute({ ...input, pickupVendorIds: [pickupVendorId] });

      expect(resolveServiceabilityUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({ deliveryVendorIds: [vendorId] }),
      );
    });
  });
  describe('business hours (S4-HOURS)', () => {
    it('places the order when every delivery vendor is open', async () => {
      const useCase = buildUseCase({ resolveBusinessHoursUseCase: businessHoursUseCase([]) });

      const order = await useCase.execute(input);

      expect(order.subOrders).toHaveLength(1);
    });

    it('rejects the whole order when a delivery vendor is closed (H1-A)', async () => {
      const orderRepository = orderRepo();
      const useCase = buildUseCase({
        orderRepository,
        resolveBusinessHoursUseCase: businessHoursUseCase([vendorId]),
      });

      await expect(useCase.execute(input)).rejects.toThrow(VendorClosedForDeliveryError);
      // All-or-nothing: nothing written, nothing deferred, no mode flipped.
      expect(orderRepository.create).not.toHaveBeenCalled();
    });

    it('checks hours before pricing, so a closed vendor costs no tax or commission work', async () => {
      vi.mocked(resolveTaxUseCase.execute).mockClear();
      vi.mocked(resolveCommissionUseCase.execute).mockClear();
      const useCase = buildUseCase({
        resolveBusinessHoursUseCase: businessHoursUseCase([vendorId]),
      });

      await expect(useCase.execute(input)).rejects.toThrow(VendorClosedForDeliveryError);

      // SDD 4.2 puts step 4c ahead of steps 4d/4e.
      expect(resolveTaxUseCase.execute).not.toHaveBeenCalled();
      expect(resolveCommissionUseCase.execute).not.toHaveBeenCalled();
    });

    it('excludes a PICKUP vendor from the hours check entirely (H2-A)', async () => {
      const resolveBusinessHoursUseCase = businessHoursUseCase([]);
      const useCase = buildUseCase({
        cartItemRepository: cartItemRepo({
          listByCartId: vi.fn().mockResolvedValue([pickupCartItem]),
        }),
        productRepository: twoVendorProductRepo(),
        productVariantRepository: twoVendorVariantRepo(),
        vendorRepository: twoVendorVendorRepo(),
        resolveBusinessHoursUseCase,
      });

      await useCase.execute({ ...input, pickupVendorIds: [pickupVendorId] });

      expect(resolveBusinessHoursUseCase.execute).toHaveBeenCalledWith({ deliveryVendorIds: [] });
    });

    it('checks only the DELIVERY half of a mixed-fulfilment cart', async () => {
      const resolveBusinessHoursUseCase = businessHoursUseCase([]);
      const useCase = buildUseCase({
        cartItemRepository: cartItemRepo({
          listByCartId: vi.fn().mockResolvedValue([cartItem, pickupCartItem]),
        }),
        productRepository: twoVendorProductRepo(),
        productVariantRepository: twoVendorVariantRepo(),
        vendorRepository: twoVendorVendorRepo(),
        resolveBusinessHoursUseCase,
      });

      await useCase.execute({ ...input, pickupVendorIds: [pickupVendorId] });

      expect(resolveBusinessHoursUseCase.execute).toHaveBeenCalledWith({
        deliveryVendorIds: [vendorId],
      });
    });

    it('rejects a mixed cart when the DELIVERY half is closed, even though the PICKUP half is exempt', async () => {
      const orderRepository = orderRepo();
      const useCase = buildUseCase({
        cartItemRepository: cartItemRepo({
          listByCartId: vi.fn().mockResolvedValue([cartItem, pickupCartItem]),
        }),
        productRepository: twoVendorProductRepo(),
        productVariantRepository: twoVendorVariantRepo(),
        vendorRepository: twoVendorVendorRepo(),
        orderRepository,
        resolveBusinessHoursUseCase: businessHoursUseCase([vendorId]),
      });

      await expect(
        useCase.execute({ ...input, pickupVendorIds: [pickupVendorId] }),
      ).rejects.toThrow(VendorClosedForDeliveryError);
      expect(orderRepository.create).not.toHaveBeenCalled();
    });

    it('runs the hours check after serviceability, per SDD 4.2', async () => {
      const calls: string[] = [];
      const resolveServiceabilityUseCase = {
        execute: vi.fn().mockImplementation(() => {
          calls.push('serviceability');
          return Promise.resolve([]);
        }),
      } as unknown as ResolveServiceabilityUseCase;
      const resolveBusinessHoursUseCase = {
        execute: vi.fn().mockImplementation(() => {
          calls.push('hours');
          return Promise.resolve([]);
        }),
      } as unknown as ResolveBusinessHoursUseCase;

      await buildUseCase({ resolveServiceabilityUseCase, resolveBusinessHoursUseCase }).execute(
        input,
      );

      expect(calls).toEqual(['serviceability', 'hours']);
    });
  });

  describe('slot capacity (S4-SLOTS)', () => {
    const slotFor = (vendor: typeof vendorId): ReadonlyMap<typeof vendorId, ResolvedSlot> =>
      new Map([[vendor, { date: '2026-08-18', startMinute: 540, endMinute: 660, capacity: 5 }]]);

    it('takes exactly one unit per booked sub-order (S2)', async () => {
      const slotAvailabilityRepository = slotRepo();

      await buildUseCase({
        resolveSlotSelectionUseCase: slotSelectionUseCase(slotFor(vendorId)),
        slotAvailabilityRepository,
      }).execute(input);

      expect(slotAvailabilityRepository.consume).toHaveBeenCalledTimes(1);
      expect(slotAvailabilityRepository.consume).toHaveBeenCalledWith(vendorId, {
        date: '2026-08-18',
        startMinute: 540,
        endMinute: 660,
        capacity: 5,
      });
    });

    it('consumes nothing when no vendor offers a window', async () => {
      const slotAvailabilityRepository = slotRepo();

      await buildUseCase({ slotAvailabilityRepository }).execute(input);

      expect(slotAvailabilityRepository.consume).not.toHaveBeenCalled();
    });

    it('refuses the whole order when the window filled first', async () => {
      // The expected outcome of losing the atomic conditional update's race,
      // not an exceptional one — it is how the design refuses to overbook.
      const orderRepository = orderRepo();

      await expect(
        buildUseCase({
          orderRepository,
          resolveSlotSelectionUseCase: slotSelectionUseCase(slotFor(vendorId)),
          slotAvailabilityRepository: slotRepo(false),
        }).execute(input),
      ).rejects.toThrow(OrderSlotUnavailableError);
      expect(orderRepository.create).not.toHaveBeenCalled();
    });

    it('snapshots the window onto the sub-order', async () => {
      const orderRepository = orderRepo();

      await buildUseCase({
        orderRepository,
        resolveSlotSelectionUseCase: slotSelectionUseCase(slotFor(vendorId)),
      }).execute(input);

      const order = (orderRepository.create as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as Order;
      expect(order.subOrders[0]?.slot).toEqual({
        date: '2026-08-18',
        startMinute: 540,
        endMinute: 660,
      });
    });

    it('leaves the sub-order slot null when the vendor offers no window', async () => {
      const orderRepository = orderRepo();

      await buildUseCase({ orderRepository }).execute(input);

      const order = (orderRepository.create as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as Order;
      expect(order.subOrders[0]?.slot).toBeNull();
    });

    it('applies to a PICKUP sub-order exactly as to a DELIVERY one (S4)', async () => {
      // Business hours are DELIVERY-only (H2-A); slot capacity is not.
      const slotAvailabilityRepository = slotRepo();

      await buildUseCase({
        resolveSlotSelectionUseCase: slotSelectionUseCase(slotFor(pickupVendorId)),
        slotAvailabilityRepository,
      }).execute({ ...input, pickupVendorIds: [pickupVendorId] });

      expect(slotAvailabilityRepository.consume).toHaveBeenCalledWith(
        pickupVendorId,
        expect.objectContaining({ startMinute: 540 }),
      );
    });

    it('runs the slot check after the hours check, per SDD 4.2 step 4c', async () => {
      const calls: string[] = [];
      const resolveBusinessHoursUseCase = {
        execute: vi.fn().mockImplementation(() => {
          calls.push('hours');
          return Promise.resolve([]);
        }),
      } as unknown as ResolveBusinessHoursUseCase;
      const resolveSlotSelectionUseCase = {
        execute: vi.fn().mockImplementation(() => {
          calls.push('slots');
          return Promise.resolve(new Map());
        }),
      } as unknown as ResolveSlotSelectionUseCase;

      await buildUseCase({ resolveBusinessHoursUseCase, resolveSlotSelectionUseCase }).execute(
        input,
      );

      expect(calls).toEqual(['hours', 'slots']);
    });

    it('validates the slot before any pricing work is done', async () => {
      // An unrecognised slot must cost no tax or commission work — the same
      // ordering rule serviceability and hours already follow.
      const resolveSlotSelectionUseCase = {
        execute: vi.fn().mockRejectedValue(new OrderSlotUnavailableError()),
      } as unknown as ResolveSlotSelectionUseCase;
      const taxSpy = vi.fn();

      await expect(
        buildUseCase({
          resolveSlotSelectionUseCase,
          resolveTaxUseCase: { execute: taxSpy } as unknown as ResolveTaxUseCase,
        }).execute(input),
      ).rejects.toThrow(OrderSlotUnavailableError);
      expect(taxSpy).not.toHaveBeenCalled();
    });
  });
});
