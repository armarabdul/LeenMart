import type { Principal } from '../../../identity/index.js';
import type { Cart } from '../../domain/entities/cart.entity.js';
import type { CartItem } from '../../domain/entities/cart-item.entity.js';
import type { CartItemRepository } from '../../domain/repositories/cart-item.repository.js';
import type { CartRepository } from '../../domain/repositories/cart.repository.js';

export interface GetCartInput {
  readonly principal: Principal;
}

export interface CartView {
  readonly cart: Cart | null;
  readonly items: readonly CartItem[];
}

export interface GetCartDeps {
  readonly cartRepository: CartRepository;
  readonly cartItemRepository: CartItemRepository;
}

/**
 * Read-only — deliberately never creates a cart just because it was viewed.
 * `AddCartItemUseCase` is the one place `upsertForUser` runs; a `GET` with a
 * write side effect would be a worse REST citizen for no benefit here.
 */
export class GetCartUseCase {
  constructor(private readonly deps: GetCartDeps) {}

  async execute(input: GetCartInput): Promise<CartView> {
    const cart = await this.deps.cartRepository.findByUserId(input.principal.userId);
    if (!cart) {
      return { cart: null, items: [] };
    }
    const items = await this.deps.cartItemRepository.listByCartId(cart.id);
    return { cart, items };
  }
}
