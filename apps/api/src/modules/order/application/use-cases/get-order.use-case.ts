import type { Principal } from '../../../identity/index.js';
import type { Order } from '../../domain/entities/order.entity.js';
import { OrderNotFoundError } from '../../domain/errors/order-errors.js';
import type { OrderRepository } from '../../domain/repositories/order.repository.js';
import type { OrderId } from '../../domain/value-objects/order-id.value-object.js';

export interface GetOrderInput {
  readonly principal: Principal;
  readonly orderId: OrderId;
}

export interface GetOrderDeps {
  readonly orderRepository: OrderRepository;
}

/**
 * Ownership-scoped order lookup (`VIEW_OWN_ORDERS`, SDD 8.2: `CUSTOMER` ->
 * `OWN`). Scoped by `id` + `customerId` at the repository, never a bare
 * `id` lookup — a client-supplied order id can never reach another
 * customer's order (SEC-06), the same discipline every ownership-scoped
 * read in this codebase already follows.
 *
 * Returns the order's own snapshot data directly — no
 * `known-variants`-style display bridge is needed here, unlike Cart:
 * `OrderItem` is an immutable snapshot by design (SDD 6.3), so the product/
 * variant/vendor names it carries are always genuinely resolvable from the
 * row itself.
 */
export class GetOrderUseCase {
  constructor(private readonly deps: GetOrderDeps) {}

  async execute(input: GetOrderInput): Promise<Order> {
    const order = await this.deps.orderRepository.findByIdAndCustomerId(
      input.orderId,
      input.principal.userId,
    );
    if (!order) {
      throw new OrderNotFoundError();
    }
    return order;
  }
}
