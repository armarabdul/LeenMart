import type { PrismaClient } from '@prisma/client';
import type { NotificationRecipientResolver } from '../../application/ports/notification-recipient-resolver.port.js';

/**
 * Resolves an order's vendor recipients (S6-NOTIFY-INAPP).
 *
 * **Bound to `leenmart_checkout`, and that is the security-relevant part.** One
 * order can carry sub-orders for several vendors (ASM-03), and
 * `leenmart_app`'s policies are scoped to a single `app.vendor_id` — a
 * vendor-scoped credential would return whichever subset matched the ambient
 * context, or nothing at all in a worker that has no context. `leenmart_checkout`
 * is the existing credential with cross-vendor reach, already used by
 * `PlaceOrderUseCase` for exactly this reason, and it is read-only here.
 *
 * No vendor RLS is widened to make this convenient, and no event producer is
 * changed to carry the ids instead.
 */
export class PrismaNotificationRecipientResolver implements NotificationRecipientResolver {
  constructor(private readonly checkoutPrisma: PrismaClient) {}

  /**
   * Two bounded queries: the order's vendors, then those vendors' owning users.
   *
   * `vendors.user_id` is the owner — the person who receives "New order
   * (vendor)". Vendor staff and managers are not resolved: SDD 8.2 gives them
   * their own permission rows, and deciding that a `VENDOR_STAFF` account also
   * gets an inbox is a decision no document makes.
   */
  async vendorUserIdsForOrder(orderId: string): Promise<readonly string[]> {
    const subOrders = await this.checkoutPrisma.subOrder.findMany({
      where: { orderId },
      select: { vendorId: true },
    });
    const vendorIds = [...new Set(subOrders.map((subOrder) => subOrder.vendorId))];
    if (vendorIds.length === 0) return [];

    const vendors = await this.checkoutPrisma.vendorProfile.findMany({
      where: { id: { in: vendorIds } },
      select: { userId: true },
    });
    return vendors.map((vendor) => vendor.userId);
  }
}
