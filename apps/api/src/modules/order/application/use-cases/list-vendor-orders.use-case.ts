import type { Principal } from '../../../identity/index.js';
import type { VendorRepository } from '../../../vendor/domain/repositories/vendor.repository.js';
import type {
  VendorOrderRepository,
  VendorSubOrderSummary,
} from '../../domain/repositories/vendor-order.repository.js';
import { requireActiveVendor } from '../support/require-active-vendor.js';

export interface ListVendorOrdersInput {
  readonly principal: Principal;
}

export interface ListVendorOrdersDeps {
  readonly vendorRepository: VendorRepository;
  readonly vendorOrderRepository: VendorOrderRepository;
}

/**
 * "Vendor Orders" (S3-5, `VIEW_VENDOR_ORDERS`). Bounded to the caller's most
 * recent sub-orders — no cursor — mirroring `ListOrdersUseCase`'s own
 * bounded, no-cursor shape (S3-4) rather than the admin/vendor cursor-queue
 * convention: this is a personal, owner-scoped list, not a cross-tenant
 * admin queue.
 */
const MAX_VENDOR_ORDERS = 50;

export class ListVendorOrdersUseCase {
  constructor(private readonly deps: ListVendorOrdersDeps) {}

  async execute(input: ListVendorOrdersInput): Promise<readonly VendorSubOrderSummary[]> {
    const { vendorRepository, vendorOrderRepository } = this.deps;
    await requireActiveVendor(vendorRepository, input.principal.userId);
    return vendorOrderRepository.findAllByVendor(MAX_VENDOR_ORDERS);
  }
}
