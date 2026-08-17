import type { PrismaClient } from '@prisma/client';
import type { VendorId } from '../../../identity/index.js';
import type {
  ServiceabilityRepository,
  VendorServiceability,
} from '../../domain/repositories/serviceability.repository.js';

/**
 * Reads `serviceable_pincodes` for checkout (S4-SERV).
 *
 * Bound to `leenmart_checkout`, the only credential granted SELECT on this
 * table besides the owning vendor's own `leenmart_app` policy — a multi-vendor
 * cart has to evaluate vendors the caller has no tenant context for, which is
 * exactly the reach `vendors_checkout_read` already exists to provide.
 *
 * **Two queries, both bounded, never one per vendor.** The question has two
 * halves — "which of these vendors declared this pincode?" and "which of them
 * have declared anything at all?" — and each is a single statement over the
 * whole vendor list. Cost is constant in the size of the cart, which is what
 * the N+1 prohibition is actually about; a third round trip saved by hand-
 * written SQL would not be worth stepping outside the typed client, which
 * `tenant-transaction-convention.test.ts` records as an unused escape hatch.
 *
 * `groupBy` rather than `findMany` for the second half: a vendor may
 * legitimately declare hundreds of pincodes, and only the *existence* of rows
 * matters here, so the database collapses them to one row per vendor rather
 * than shipping the whole set back to be counted in memory.
 */
export class PrismaServiceabilityRepository implements ServiceabilityRepository {
  constructor(private readonly checkoutPrisma: PrismaClient) {}

  async resolveForPincode(
    pincode: string,
    vendorIds: readonly VendorId[],
  ): Promise<ReadonlyMap<VendorId, VendorServiceability>> {
    const resolved = new Map<VendorId, VendorServiceability>();
    if (vendorIds.length === 0) {
      return resolved;
    }

    const ids = [...vendorIds];
    const [matching, configured] = await Promise.all([
      this.checkoutPrisma.serviceablePincode.findMany({
        where: { vendorId: { in: ids }, pincode },
        select: { vendorId: true },
      }),
      this.checkoutPrisma.serviceablePincode.groupBy({
        by: ['vendorId'],
        where: { vendorId: { in: ids } },
      }),
    ]);

    const servesPincode = new Set(matching.map((row) => row.vendorId));
    const hasAnyRows = new Set(configured.map((row) => row.vendorId));

    // Every requested vendor appears in the result, per the port's contract —
    // a vendor with no rows is reported as unconfigured rather than omitted,
    // so the caller never has to distinguish a missing key from a missing row.
    for (const vendorId of vendorIds) {
      resolved.set(vendorId, {
        configured: hasAnyRows.has(vendorId),
        servesPincode: servesPincode.has(vendorId),
      });
    }
    return resolved;
  }
}
