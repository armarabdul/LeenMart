import type { Clock } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import type { CartItemRepository } from '../../domain/repositories/cart-item.repository.js';
import type { CartRepository } from '../../domain/repositories/cart.repository.js';

export interface ClearCartInput {
  readonly principal: Principal;
}

export interface ClearCartDeps {
  readonly cartRepository: CartRepository;
  readonly cartItemRepository: CartItemRepository;
  readonly clock: Clock;
}

/** Idempotent: a customer with no cart yet has nothing to clear, which is not an error. */
export class ClearCartUseCase {
  constructor(private readonly deps: ClearCartDeps) {}

  async execute(input: ClearCartInput): Promise<void> {
    const cart = await this.deps.cartRepository.findByUserId(input.principal.userId);
    if (!cart) {
      return;
    }
    await this.deps.cartItemRepository.softDeleteAllForCart(cart.id, this.deps.clock.now());
  }
}
