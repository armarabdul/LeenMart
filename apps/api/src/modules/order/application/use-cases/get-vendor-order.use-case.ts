import type { Principal } from '../../../identity/index.js';
import type { VendorRepository } from '../../../vendor/domain/repositories/vendor.repository.js';
import { SubOrderNotFoundError } from '../../domain/errors/order-errors.js';
import type {
  VendorOrderRepository,
  VendorSubOrderDetail,
} from '../../domain/repositories/vendor-order.repository.js';
import type { SubOrderId } from '../../domain/value-objects/sub-order-id.value-object.js';
import { requireActiveVendor } from '../support/require-active-vendor.js';

export interface GetVendorOrderInput {
  readonly principal: Principal;
  readonly subOrderId: SubOrderId;
}

export interface GetVendorOrderDeps {
  readonly vendorRepository: VendorRepository;
  readonly vendorOrderRepository: VendorOrderRepository;
}

/**
 * Ownership-scoped sub-order lookup (`VIEW_VENDOR_ORDERS`). Addressed by
 * `SubOrderId`, never `OrderId` (locked decision #5): a vendor does not own
 * the whole multi-vendor order, only their own slice, so `findDetailById`
 * naming a sub-order directly makes "vendor doesn't own this row → 404" a
 * clean, single-entity check — the same shape `GetOrderUseCase` gives the
 * customer surface, one level down.
 */
export class GetVendorOrderUseCase {
  constructor(private readonly deps: GetVendorOrderDeps) {}

  async execute(input: GetVendorOrderInput): Promise<VendorSubOrderDetail> {
    const { vendorRepository, vendorOrderRepository } = this.deps;
    await requireActiveVendor(vendorRepository, input.principal.userId);
    const detail = await vendorOrderRepository.findDetailById(input.subOrderId);
    if (!detail) {
      throw new SubOrderNotFoundError();
    }
    return detail;
  }
}
