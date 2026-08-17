import type { TransactionScope } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';

/**
 * A vendor's own delivery serviceability set (S4-SERV, locked decision D1).
 *
 * The vendor-facing half. Checkout reads the same table through the order
 * module's own `ServiceabilityRepository`, which answers a different question
 * (batched, per-pincode) on a different credential — deliberately two ports,
 * because a shared one would have to serve both the tenant-scoped management
 * path and the cross-tenant checkout read.
 */
export interface ServiceablePincodeRepository {
  /** Re-binds to an open transaction. See `VendorRepository.withTransaction`. */
  withTransaction(scope: TransactionScope): ServiceablePincodeRepository;

  /** Every pincode this vendor has declared, sorted ascending. Empty means unconfigured (D7). */
  findAllByVendor(vendorId: VendorId): Promise<readonly string[]>;

  /**
   * Replaces the vendor's whole set.
   *
   * Delete-then-insert rather than a diff: the set is small, replacement is
   * the only operation the contract offers, and computing a minimal delta
   * would add reconciliation logic with nothing to gain. Callers run this
   * inside a transaction so a partially-replaced set is never observable.
   */
  replaceForVendor(vendorId: VendorId, pincodes: readonly string[]): Promise<void>;
}
