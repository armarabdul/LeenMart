import type { PrismaClient } from '@prisma/client';
import { toOrderItemId, toSubOrderId } from '../../../order/index.js';
import { toProductId, toProductVariantId } from '../../../catalogue/index.js';
import type { UserId } from '../../../identity/index.js';
import type { OrderItemId } from '../../../order/index.js';
import type {
  VerifiedPurchase,
  VerifiedPurchaseQuery,
} from '../../application/ports/verified-purchase-query.port.js';

/**
 * `VerifiedPurchaseQuery` on `leenmart_checkout` (S8-REVIEWS).
 *
 * **Bound to `leenmart_checkout`, and that is the security-relevant part.**
 * `leenmart_app`'s RLS policies on `orders`/`sub_orders`/`order_items`
 * (`TENANT_SCOPED_MODELS`) are scoped by `app.vendor_id` — the *vendor*
 * portal's own reach into its orders — and a customer verifying their own
 * purchase has no vendor at all. `leenmart_checkout`'s policies on these
 * three tables are `USING (true)` (20260816130000's own comment: "preserve
 * its existing, unrestricted reach exactly"), which is what
 * `PrismaOrderRepository.findByIdAndCustomerId` already relies on for the
 * identical reason — this query joins the same tables the same way, scoped
 * by an explicit `WHERE`, never by RLS.
 */
export class PrismaVerifiedPurchaseQuery implements VerifiedPurchaseQuery {
  constructor(private readonly checkoutPrisma: PrismaClient) {}

  async findEligiblePurchase(
    orderItemId: OrderItemId,
    customerId: UserId,
  ): Promise<VerifiedPurchase | null> {
    const row = await this.checkoutPrisma.orderItem.findFirst({
      where: {
        id: orderItemId,
        subOrder: {
          status: { in: ['DELIVERED', 'COMPLETED'] },
          order: { customerId },
        },
      },
      select: { id: true, subOrderId: true, productId: true, variantId: true },
    });
    if (!row) {
      return null;
    }

    return {
      orderItemId: toOrderItemId(row.id),
      subOrderId: toSubOrderId(row.subOrderId),
      productId: toProductId(row.productId),
      variantId: toProductVariantId(row.variantId),
    };
  }
}
