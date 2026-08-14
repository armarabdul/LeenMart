import type { Clock } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import { CartItemNotFoundError } from '../../domain/errors/cart-errors.js';
import type { CartItemRepository } from '../../domain/repositories/cart-item.repository.js';
import type { CartRepository } from '../../domain/repositories/cart.repository.js';
import type { CartItemId } from '../../domain/value-objects/cart-item-id.value-object.js';
import type { CartView } from './get-cart.use-case.js';

export interface RemoveCartItemInput {
  readonly principal: Principal;
  readonly itemId: CartItemId;
}

export interface RemoveCartItemDeps {
  readonly cartRepository: CartRepository;
  readonly cartItemRepository: CartItemRepository;
  readonly clock: Clock;
}

export class RemoveCartItemUseCase {
  constructor(private readonly deps: RemoveCartItemDeps) {}

  async execute(input: RemoveCartItemInput): Promise<CartView> {
    const { cartRepository, cartItemRepository, clock } = this.deps;
    const { principal, itemId } = input;

    const cart = await cartRepository.findByUserId(principal.userId);
    if (!cart) {
      throw new CartItemNotFoundError();
    }
    const ok = await cartItemRepository.softDelete(itemId, cart.id, clock.now());
    if (!ok) {
      throw new CartItemNotFoundError();
    }

    const items = await cartItemRepository.listByCartId(cart.id);
    return { cart, items };
  }
}
