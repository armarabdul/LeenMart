import type { PrismaClient } from '@prisma/client';
import { toVendorId, type VendorId } from '../../../identity/index.js';
import type { OrderVendorResolver } from '../../application/ports/order-vendor-resolver.port.js';

/**
 * Resolves an order's distinct vendors (S4-SSE).
 *
 * **Bound to `leenmart_checkout`, for the identical reason
 * `PrismaNotificationRecipientResolver` is.** One order can carry sub-orders
 * for several vendors (ASM-03); `leenmart_app`'s policies are scoped to a
 * single `app.vendor_id`, so a tenant-scoped credential would return
 * whichever subset matched the ambient context — nothing at all in a worker,
 * which has none. `leenmart_checkout` is the existing credential with
 * cross-vendor reach, already used by `PlaceOrderUseCase` and by the
 * notification resolver for this same reason, and it is read-only here.
 */
export class PrismaOrderVendorResolver implements OrderVendorResolver {
  constructor(private readonly checkoutPrisma: PrismaClient) {}

  async vendorIdsForOrder(orderId: string): Promise<readonly VendorId[]> {
    const subOrders = await this.checkoutPrisma.subOrder.findMany({
      where: { orderId },
      select: { vendorId: true },
    });
    return [...new Set(subOrders.map((subOrder) => subOrder.vendorId))].map(toVendorId);
  }
}
