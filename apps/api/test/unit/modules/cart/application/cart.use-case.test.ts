import { describe, expect, it, vi } from 'vitest';
import { FixedClock, Money, UuidV7Generator } from '@leen-mart/domain-kit';
import type {
  InventoryRepository,
  ProductVariantRepository,
} from '../../../../../src/modules/catalogue/index.js';
import { Inventory } from '../../../../../src/modules/catalogue/domain/entities/inventory.entity.js';
import { ProductVariant } from '../../../../../src/modules/catalogue/domain/entities/product-variant.entity.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import { AddCartItemUseCase } from '../../../../../src/modules/cart/application/use-cases/add-cart-item.use-case.js';
import { ClearCartUseCase } from '../../../../../src/modules/cart/application/use-cases/clear-cart.use-case.js';
import { GetCartUseCase } from '../../../../../src/modules/cart/application/use-cases/get-cart.use-case.js';
import { RemoveCartItemUseCase } from '../../../../../src/modules/cart/application/use-cases/remove-cart-item.use-case.js';
import { UpdateCartItemQuantityUseCase } from '../../../../../src/modules/cart/application/use-cases/update-cart-item-quantity.use-case.js';
import { Cart } from '../../../../../src/modules/cart/domain/entities/cart.entity.js';
import { CartItem } from '../../../../../src/modules/cart/domain/entities/cart-item.entity.js';
import {
  CartItemNotFoundError,
  InsufficientInventoryError,
  InvalidCartQuantityError,
  ProductNotEligibleForCartError,
} from '../../../../../src/modules/cart/domain/errors/cart-errors.js';
import type { CartItemRepository } from '../../../../../src/modules/cart/domain/repositories/cart-item.repository.js';
import type { CartRepository } from '../../../../../src/modules/cart/domain/repositories/cart.repository.js';
import { toCartId } from '../../../../../src/modules/cart/domain/value-objects/cart-id.value-object.js';
import { toCartItemId } from '../../../../../src/modules/cart/domain/value-objects/cart-item-id.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-14T00:00:00.000Z');
const clock = new FixedClock(NOW);

const principal: Principal = {
  userId: toUserId(ids.generate()),
  sessionId: toSessionId(ids.generate()),
  role: 'CUSTOMER',
};
const vendorId = toVendorId(ids.generate());
const productId = toProductId(ids.generate());
const variantId = toProductVariantId(ids.generate());
const cartId = toCartId(ids.generate());

const variant = (quantityStep = 1): ProductVariant =>
  ProductVariant.create({
    id: variantId,
    productId,
    vendorId,
    sku: 'SKU-1',
    name: 'Default',
    price: Money.fromMinor(19900n, 'INR'),
    unitOfMeasure: 'per piece',
    quantityStep,
    now: NOW,
  });

const inventory = (available: number): Inventory =>
  Inventory.reconstitute({
    variantId,
    vendorId,
    available,
    reserved: 0,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });

const cart = (): Cart => Cart.open({ id: cartId, userId: principal.userId, now: NOW });

const cartItem = (quantity: number, id = toCartItemId(ids.generate())): CartItem =>
  CartItem.add({ id, cartId, variantId, quantity, now: NOW });

const cartRepo = (overrides: Partial<CartRepository> = {}): CartRepository => {
  const repository: CartRepository = {
    withTransaction: () => repository,
    findByUserId: vi.fn().mockResolvedValue(null),
    upsertForUser: vi.fn().mockResolvedValue(cart()),
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
    listByCartId: vi.fn().mockResolvedValue([]),
    updateQuantityIfOwned: vi.fn().mockResolvedValue(true),
    softDelete: vi.fn().mockResolvedValue(true),
    softDeleteAllForCart: vi.fn().mockResolvedValue(0),
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
    findById: vi.fn().mockResolvedValue(variant()),
    findByProductAndId: vi.fn().mockResolvedValue(null),
    listByProductId: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(true),
    countLiveForProduct: vi.fn().mockResolvedValue(1),
    softDelete: vi.fn().mockResolvedValue(true),
    softDeleteAllForProduct: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return repository;
};

const inventoryRepo = (overrides: Partial<InventoryRepository> = {}): InventoryRepository => {
  const repository: InventoryRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByProductAndVariant: vi.fn().mockResolvedValue(inventory(100)),
    setIfVersionMatches: vi.fn().mockResolvedValue(true),
    deleteForVariants: vi.fn().mockResolvedValue(0),
    deleteForProduct: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return repository;
};

describe('GetCartUseCase', () => {
  it('returns an empty view without creating a cart when the caller has none', async () => {
    const cartRepository = cartRepo({ findByUserId: vi.fn().mockResolvedValue(null) });
    const useCase = new GetCartUseCase({ cartRepository, cartItemRepository: cartItemRepo() });

    const view = await useCase.execute({ principal });

    expect(view).toEqual({ cart: null, items: [] });
    expect(cartRepository.upsertForUser).not.toHaveBeenCalled();
  });

  it('lists items for an existing cart', async () => {
    const item = cartItem(2);
    const cartRepository = cartRepo({ findByUserId: vi.fn().mockResolvedValue(cart()) });
    const cartItemRepository = cartItemRepo({ listByCartId: vi.fn().mockResolvedValue([item]) });
    const useCase = new GetCartUseCase({ cartRepository, cartItemRepository });

    const view = await useCase.execute({ principal });

    expect(view.cart?.id).toBe(cartId);
    expect(view.items).toEqual([item]);
  });
});

describe('AddCartItemUseCase', () => {
  const build = (
    deps: {
      cartRepository?: CartRepository;
      cartItemRepository?: CartItemRepository;
      productVariantRepository?: ProductVariantRepository;
      inventoryRepository?: InventoryRepository;
    } = {},
  ): AddCartItemUseCase =>
    new AddCartItemUseCase({
      cartRepository: deps.cartRepository ?? cartRepo(),
      cartItemRepository: deps.cartItemRepository ?? cartItemRepo(),
      productVariantRepository: deps.productVariantRepository ?? variantRepo(),
      inventoryRepository: deps.inventoryRepository ?? inventoryRepo(),
      idGenerator: ids,
      clock,
    });

  it('creates a new item when the variant is not already in the cart', async () => {
    const cartItemRepository = cartItemRepo();
    const useCase = build({ cartItemRepository });

    await useCase.execute({ principal, variantId, quantity: 3 });

    expect(cartItemRepository.create).toHaveBeenCalledTimes(1);
    expect(cartItemRepository.updateQuantityIfOwned).not.toHaveBeenCalled();
  });

  it('increments the existing item instead of creating a second row', async () => {
    const existing = cartItem(2);
    const cartItemRepository = cartItemRepo({
      findByCartAndVariant: vi.fn().mockResolvedValue(existing),
    });
    const useCase = build({ cartItemRepository });

    await useCase.execute({ principal, variantId, quantity: 3 });

    expect(cartItemRepository.create).not.toHaveBeenCalled();
    expect(cartItemRepository.updateQuantityIfOwned).toHaveBeenCalledTimes(1);
    const [updated] = vi.mocked(cartItemRepository.updateQuantityIfOwned).mock.calls[0]!;
    expect(updated.quantity).toBe(5);
  });

  it('throws ProductNotEligibleForCartError when the variant does not resolve under publicPrisma', async () => {
    const useCase = build({
      productVariantRepository: variantRepo({ findById: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute({ principal, variantId, quantity: 1 })).rejects.toBeInstanceOf(
      ProductNotEligibleForCartError,
    );
  });

  it('throws InvalidCartQuantityError when the quantity is not a multiple of quantityStep', async () => {
    const useCase = build({
      productVariantRepository: variantRepo({ findById: vi.fn().mockResolvedValue(variant(250)) }),
    });

    await expect(useCase.execute({ principal, variantId, quantity: 100 })).rejects.toBeInstanceOf(
      InvalidCartQuantityError,
    );
  });

  it('throws InsufficientInventoryError when the requested quantity exceeds availability', async () => {
    const useCase = build({
      inventoryRepository: inventoryRepo({
        findByProductAndVariant: vi.fn().mockResolvedValue(inventory(2)),
      }),
    });

    await expect(useCase.execute({ principal, variantId, quantity: 3 })).rejects.toBeInstanceOf(
      InsufficientInventoryError,
    );
  });

  it('treats a missing inventory row as zero available', async () => {
    const useCase = build({
      inventoryRepository: inventoryRepo({
        findByProductAndVariant: vi.fn().mockResolvedValue(null),
      }),
    });

    await expect(useCase.execute({ principal, variantId, quantity: 1 })).rejects.toBeInstanceOf(
      InsufficientInventoryError,
    );
  });

  it('sums existing and requested quantities against availability, not the requested amount alone', async () => {
    const existing = cartItem(8);
    const cartItemRepository = cartItemRepo({
      findByCartAndVariant: vi.fn().mockResolvedValue(existing),
    });
    const useCase = build({
      cartItemRepository,
      inventoryRepository: inventoryRepo({
        findByProductAndVariant: vi.fn().mockResolvedValue(inventory(10)),
      }),
    });

    await expect(useCase.execute({ principal, variantId, quantity: 5 })).rejects.toBeInstanceOf(
      InsufficientInventoryError,
    );
  });
});

describe('UpdateCartItemQuantityUseCase', () => {
  const itemId = toCartItemId(ids.generate());
  const build = (
    deps: {
      cartRepository?: CartRepository;
      cartItemRepository?: CartItemRepository;
      productVariantRepository?: ProductVariantRepository;
      inventoryRepository?: InventoryRepository;
    } = {},
  ): UpdateCartItemQuantityUseCase =>
    new UpdateCartItemQuantityUseCase({
      cartRepository:
        deps.cartRepository ?? cartRepo({ findByUserId: vi.fn().mockResolvedValue(cart()) }),
      cartItemRepository:
        deps.cartItemRepository ??
        cartItemRepo({ findByCartAndId: vi.fn().mockResolvedValue(cartItem(2, itemId)) }),
      productVariantRepository: deps.productVariantRepository ?? variantRepo(),
      inventoryRepository: deps.inventoryRepository ?? inventoryRepo(),
      clock,
    });

  it('throws CartItemNotFoundError when the caller has no cart at all', async () => {
    const useCase = build({
      cartRepository: cartRepo({ findByUserId: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute({ principal, itemId, quantity: 5 })).rejects.toBeInstanceOf(
      CartItemNotFoundError,
    );
  });

  it("throws CartItemNotFoundError when the item does not belong to the caller's cart", async () => {
    const useCase = build({
      cartItemRepository: cartItemRepo({ findByCartAndId: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute({ principal, itemId, quantity: 5 })).rejects.toBeInstanceOf(
      CartItemNotFoundError,
    );
  });

  it('re-validates eligibility and availability, not just the stored item', async () => {
    const useCase = build({
      productVariantRepository: variantRepo({ findById: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute({ principal, itemId, quantity: 5 })).rejects.toBeInstanceOf(
      ProductNotEligibleForCartError,
    );
  });

  it('writes the absolute new quantity, not a delta', async () => {
    const cartItemRepository = cartItemRepo({
      findByCartAndId: vi.fn().mockResolvedValue(cartItem(2, itemId)),
    });
    const useCase = build({ cartItemRepository });

    await useCase.execute({ principal, itemId, quantity: 7 });

    const [updated] = vi.mocked(cartItemRepository.updateQuantityIfOwned).mock.calls[0]!;
    expect(updated.quantity).toBe(7);
  });

  it('throws CartItemNotFoundError when the conditional write loses its race', async () => {
    const useCase = build({
      cartItemRepository: cartItemRepo({
        findByCartAndId: vi.fn().mockResolvedValue(cartItem(2, itemId)),
        updateQuantityIfOwned: vi.fn().mockResolvedValue(false),
      }),
    });

    await expect(useCase.execute({ principal, itemId, quantity: 7 })).rejects.toBeInstanceOf(
      CartItemNotFoundError,
    );
  });
});

describe('RemoveCartItemUseCase', () => {
  const itemId = toCartItemId(ids.generate());

  it('throws CartItemNotFoundError when the caller has no cart', async () => {
    const useCase = new RemoveCartItemUseCase({
      cartRepository: cartRepo({ findByUserId: vi.fn().mockResolvedValue(null) }),
      cartItemRepository: cartItemRepo(),
      clock,
    });

    await expect(useCase.execute({ principal, itemId })).rejects.toBeInstanceOf(
      CartItemNotFoundError,
    );
  });

  it('throws CartItemNotFoundError when nothing matched the scoped delete', async () => {
    const useCase = new RemoveCartItemUseCase({
      cartRepository: cartRepo({ findByUserId: vi.fn().mockResolvedValue(cart()) }),
      cartItemRepository: cartItemRepo({ softDelete: vi.fn().mockResolvedValue(false) }),
      clock,
    });

    await expect(useCase.execute({ principal, itemId })).rejects.toBeInstanceOf(
      CartItemNotFoundError,
    );
  });

  it('soft-deletes the item scoped to (id, cartId) and returns the remaining items', async () => {
    const cartItemRepository = cartItemRepo({ softDelete: vi.fn().mockResolvedValue(true) });
    const useCase = new RemoveCartItemUseCase({
      cartRepository: cartRepo({ findByUserId: vi.fn().mockResolvedValue(cart()) }),
      cartItemRepository,
      clock,
    });

    await useCase.execute({ principal, itemId });

    expect(cartItemRepository.softDelete).toHaveBeenCalledWith(itemId, cartId, NOW);
  });
});

describe('ClearCartUseCase', () => {
  it('is a no-op when the caller has no cart', async () => {
    const cartItemRepository = cartItemRepo();
    const useCase = new ClearCartUseCase({
      cartRepository: cartRepo({ findByUserId: vi.fn().mockResolvedValue(null) }),
      cartItemRepository,
      clock,
    });

    await useCase.execute({ principal });

    expect(cartItemRepository.softDeleteAllForCart).not.toHaveBeenCalled();
  });

  it("soft-deletes every live item in the caller's cart", async () => {
    const cartItemRepository = cartItemRepo();
    const useCase = new ClearCartUseCase({
      cartRepository: cartRepo({ findByUserId: vi.fn().mockResolvedValue(cart()) }),
      cartItemRepository,
      clock,
    });

    await useCase.execute({ principal });

    expect(cartItemRepository.softDeleteAllForCart).toHaveBeenCalledWith(cartId, NOW);
  });
});
