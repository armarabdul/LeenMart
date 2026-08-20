import type { PrismaClient } from '@prisma/client';
import {
  fromIst,
  toIsoDate,
} from '../../../vendor/domain/value-objects/ist-instant.value-object.js';
import type {
  PickupReminderCandidate,
  PickupReminderCandidateQuery,
} from '../../application/ports/pickup-reminder-query.port.js';

/**
 * `PickupReminderCandidateQuery` on `leenmart_checkout` (S7-SCHED).
 *
 * **Bound to `leenmart_checkout`, and that is the security-relevant part.**
 * The sweep reads across every vendor's `READY_FOR_PICKUP` sub-orders, not
 * one tenant's — the same cross-vendor reach `PrismaNotificationRecipientResolver`
 * already relies on `leenmart_checkout` for, and for the identical reason:
 * `leenmart_app`'s RLS policies are scoped to a single `app.vendor_id`, and
 * this job runs with no tenant context at all. No vendor RLS is widened to
 * make this convenient.
 *
 * The join to `orders.customer_id` is what lets the reminder resolve its
 * recipient from persisted ownership rather than trusting any input —
 * `leenmart_checkout` already holds SELECT on `orders` for the same reason
 * `PlaceOrderUseCase` does.
 */
export class PrismaPickupReminderCandidateQuery implements PickupReminderCandidateQuery {
  constructor(private readonly checkoutPrisma: PrismaClient) {}

  async findCandidates(
    fromDate: string,
    toDate: string,
  ): Promise<readonly PickupReminderCandidate[]> {
    const rows = await this.checkoutPrisma.subOrder.findMany({
      where: {
        fulfilmentMode: 'PICKUP',
        status: 'READY_FOR_PICKUP',
        slotDate: { gte: new Date(`${fromDate}T00:00:00Z`), lte: new Date(`${toDate}T00:00:00Z`) },
        slotStartMinute: { not: null },
      },
      select: {
        id: true,
        orderId: true,
        vendorId: true,
        slotDate: true,
        slotStartMinute: true,
        order: { select: { customerId: true } },
      },
    });

    return rows.map((row) => {
      const { slotDate, slotStartMinute } = row;
      // The WHERE clause above already excludes rows where either is null,
      // but Prisma's generated type cannot express that as a non-null
      // column — narrowed here with a real check rather than an assertion,
      // so a query change that ever violated the guarantee would fail loudly
      // instead of silently.
      if (slotDate === null || slotStartMinute === null) {
        throw new Error(
          `Pickup reminder candidate ${row.id} has no slot despite the query's own filter`,
        );
      }
      return {
        subOrderId: row.id,
        orderId: row.orderId,
        vendorId: row.vendorId,
        customerId: row.order.customerId,
        pickupInstant: fromIst(toIsoDate(slotDate), slotStartMinute),
      };
    });
  }
}
