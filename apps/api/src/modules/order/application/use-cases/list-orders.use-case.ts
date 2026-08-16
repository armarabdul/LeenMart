import type { Principal } from '../../../identity/index.js';
import type { OrderRepository, OrderSummary } from '../../domain/repositories/order.repository.js';

export interface ListOrdersInput {
  readonly principal: Principal;
}

export interface ListOrdersDeps {
  readonly orderRepository: OrderRepository;
}

/**
 * "My Orders" (S3-4, `VIEW_OWN_ORDERS`). Bounded to the caller's most recent
 * orders — no cursor, no query params to trust or validate — the same
 * "personal, bounded history" shape `AuditLogRepository.findByActor` already
 * uses, not the admin/vendor cursor-queue convention (see
 * `OrderRepository.findAllByCustomerId`'s own doc comment for why).
 */
const MAX_ORDERS = 50;

export class ListOrdersUseCase {
  constructor(private readonly deps: ListOrdersDeps) {}

  async execute(input: ListOrdersInput): Promise<readonly OrderSummary[]> {
    return this.deps.orderRepository.findAllByCustomerId(input.principal.userId, MAX_ORDERS);
  }
}
