import type { Clock } from '@leen-mart/domain-kit';
import type { InventoryRepository, ProductVariantRepository } from '../../../catalogue/index.js';
import type { Principal } from '../../../identity/index.js';
import {
  CartItemNotFoundError,
  InsufficientInventoryError,
  InvalidCartQuantityError,
  ProductNotEligibleForCartError,
} from '../../domain/errors/cart-errors.js';
import type { CartItemRepository } from '../../domain/repositories/cart-item.repository.js';
import type { CartRepository } from '../../domain/repositories/cart.repository.js';
import type { CartItemId } from '../../domain/value-objects/cart-item-id.value-object.js';
import type { CartView } from './get-cart.use-case.js';

export interface UpdateCartItemQuantityInput {
  readonly principal: Principal;
  readonly itemId: CartItemId;
  readonly quantity: number;
}

export interface UpdateCartItemQuantityDeps {
  readonly cartRepository: CartRepository;
  readonly cartItemRepository: CartItemRepository;
  readonly productVariantRepository: ProductVariantRepository;
  readonly inventoryRepository: InventoryRepository;
  readonly clock: Clock;
}

const assertValidQuantity = (quantity: number, quantityStep: number): void => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new InvalidCartQuantityError('Must be a positive whole number.');
  }
  if (quantity % quantityStep !== 0) {
    throw new InvalidCartQuantityError(
      `Must be a multiple of this item's quantity step (${quantityStep}).`,
    );
  }
};

/**
 * Sets a cart item's quantity to an absolute value (not a delta), re-running
 * both checks `AddCartItemUseCase` runs — the variant may have gone
 * ineligible or stock may have moved since the item was added, and this is
 * the point a customer next touches that row.
 */
export class UpdateCartItemQuantityUseCase {
  constructor(private readonly deps: UpdateCartItemQuantityDeps) {}

  async execute(input: UpdateCartItemQuantityInput): Promise<CartView> {
    const {
      cartRepository,
      cartItemRepository,
      productVariantRepository,
      inventoryRepository,
      clock,
    } = this.deps;
    const { principal, itemId, quantity } = input;

    const cart = await cartRepository.findByUserId(principal.userId);
    if (!cart) {
      throw new CartItemNotFoundError();
    }
    const item = await cartItemRepository.findByCartAndId(itemId, cart.id);
    if (!item) {
      throw new CartItemNotFoundError();
    }

    const variant = await productVariantRepository.findById(item.variantId);
    if (!variant) {
      throw new ProductNotEligibleForCartError();
    }
    assertValidQuantity(quantity, variant.quantityStep);

    const inventory = await inventoryRepository.findByProductAndVariant(
      variant.productId,
      variant.id,
    );
    const available = inventory?.available ?? 0;
    if (quantity > available) {
      throw new InsufficientInventoryError();
    }

    const now = clock.now();
    const updated = item.changeQuantity(quantity, now);
    const ok = await cartItemRepository.updateQuantityIfOwned(updated, cart.id);
    if (!ok) {
      throw new CartItemNotFoundError();
    }

    const items = await cartItemRepository.listByCartId(cart.id);
    return { cart, items };
  }
}
