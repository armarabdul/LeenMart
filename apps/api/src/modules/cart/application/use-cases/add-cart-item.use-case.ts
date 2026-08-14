import type { Clock, IdGenerator } from '@leen-mart/domain-kit';
import type {
  InventoryRepository,
  ProductVariantId,
  ProductVariantRepository,
} from '../../../catalogue/index.js';
import type { Principal } from '../../../identity/index.js';
import { Cart } from '../../domain/entities/cart.entity.js';
import { CartItem } from '../../domain/entities/cart-item.entity.js';
import {
  InsufficientInventoryError,
  InvalidCartQuantityError,
  ProductNotEligibleForCartError,
} from '../../domain/errors/cart-errors.js';
import type { CartItemRepository } from '../../domain/repositories/cart-item.repository.js';
import type { CartRepository } from '../../domain/repositories/cart.repository.js';
import { toCartId } from '../../domain/value-objects/cart-id.value-object.js';
import { toCartItemId } from '../../domain/value-objects/cart-item-id.value-object.js';
import type { CartView } from './get-cart.use-case.js';

export interface AddCartItemInput {
  readonly principal: Principal;
  readonly variantId: ProductVariantId;
  readonly quantity: number;
}

export interface AddCartItemDeps {
  readonly cartRepository: CartRepository;
  readonly cartItemRepository: CartItemRepository;
  /**
   * Catalogue's own port, bound (at the composition root) to `publicPrisma`
   * rather than the vendor-tenant client — a customer session carries no
   * vendor tenant, and `leenmart_public`'s RLS is what confines every read
   * here to `APPROVED`, non-deleted rows regardless of which vendor owns
   * them (S3-1, mirroring S2-7's public search).
   */
  readonly productVariantRepository: ProductVariantRepository;
  readonly inventoryRepository: InventoryRepository;
  readonly idGenerator: IdGenerator;
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
 * Adds an item to the caller's cart, creating the cart on first use
 * (`upsertForUser`). Adding a variant already present increments its
 * quantity rather than creating a second row — `uq_cart_items_cart_variant`
 * is the actual arbiter (see `PrismaCartItemRepository.create`), this is
 * just the ordinary path where no race is in play.
 *
 * Eligibility and availability are both re-checked here, live, against
 * `publicPrisma` — never trusted from a prior read: a `findById` returning
 * non-null *is* the eligibility proof (RLS already confines it to
 * `APPROVED`, non-deleted rows), and `Inventory.available` is read, never
 * written — S3-1 has no reservation/decrement (that is SDD 14.4's later
 * checkout slice).
 */
export class AddCartItemUseCase {
  constructor(private readonly deps: AddCartItemDeps) {}

  async execute(input: AddCartItemInput): Promise<CartView> {
    const {
      cartRepository,
      cartItemRepository,
      productVariantRepository,
      inventoryRepository,
      idGenerator,
      clock,
    } = this.deps;
    const { principal, variantId, quantity } = input;

    const variant = await productVariantRepository.findById(variantId);
    if (!variant) {
      throw new ProductNotEligibleForCartError();
    }
    assertValidQuantity(quantity, variant.quantityStep);

    const inventory = await inventoryRepository.findByProductAndVariant(
      variant.productId,
      variant.id,
    );
    const available = inventory?.available ?? 0;

    const now = clock.now();
    const candidate = Cart.open({
      id: toCartId(idGenerator.generate()),
      userId: principal.userId,
      now,
    });
    const cart = await cartRepository.upsertForUser(candidate);
    const existing = await cartItemRepository.findByCartAndVariant(cart.id, variant.id);
    const combinedQuantity = (existing?.quantity ?? 0) + quantity;

    if (combinedQuantity > available) {
      throw new InsufficientInventoryError();
    }

    if (existing) {
      const updated = existing.changeQuantity(combinedQuantity, now);
      await cartItemRepository.updateQuantityIfOwned(updated, cart.id);
    } else {
      const item = CartItem.add({
        id: toCartItemId(idGenerator.generate()),
        cartId: cart.id,
        variantId: variant.id,
        quantity: combinedQuantity,
        now,
      });
      await cartItemRepository.create(item);
    }

    const items = await cartItemRepository.listByCartId(cart.id);
    return { cart, items };
  }
}
