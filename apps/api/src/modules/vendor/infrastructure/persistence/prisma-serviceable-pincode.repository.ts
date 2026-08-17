import type { TransactionScope } from '@leen-mart/domain-kit';
import type { PrismaClient } from '@prisma/client';
import type { VendorId } from '../../../identity/index.js';
import type { ServiceablePincodeRepository } from '../../domain/repositories/serviceable-pincode.repository.js';

/**
 * Maps `serviceable_pincodes` rows for the vendor-facing management path
 * (S4-SERV).
 *
 * Bound to the tenant-scoped `leenmart_app` client, so
 * `serviceable_pincodes_vendor_*` confines every statement to the caller's own
 * `app.vendor_id` — the `vendorId` this class passes is belt-and-braces on top
 * of that, not the enforcement.
 */
export class PrismaServiceablePincodeRepository implements ServiceablePincodeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): ServiceablePincodeRepository {
    return new PrismaServiceablePincodeRepository(scope as unknown as PrismaClient);
  }

  async findAllByVendor(vendorId: VendorId): Promise<readonly string[]> {
    const rows = await this.prisma.serviceablePincode.findMany({
      where: { vendorId },
      select: { pincode: true },
      orderBy: { pincode: 'asc' },
    });
    return rows.map((row) => row.pincode);
  }

  async replaceForVendor(vendorId: VendorId, pincodes: readonly string[]): Promise<void> {
    await this.prisma.serviceablePincode.deleteMany({ where: { vendorId } });
    if (pincodes.length === 0) {
      return;
    }
    // One statement for the whole set. `skipDuplicates` is belt-and-braces:
    // the use case already de-duplicates, and the composite primary key would
    // refuse a repeat anyway.
    await this.prisma.serviceablePincode.createMany({
      data: pincodes.map((pincode) => ({ vendorId, pincode })),
      skipDuplicates: true,
    });
  }
}
