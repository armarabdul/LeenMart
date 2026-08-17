import type { TransactionScope } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';
import type { VendorBusinessHours } from '../services/business-hours-policy.js';

/**
 * A vendor's own operating schedule (S4-HOURS), for the management path.
 *
 * The vendor-facing half. Checkout reads the same tables through
 * `BusinessHoursLookupRepository`, which answers a different question
 * (batched, for many vendors, on a different credential) — deliberately two
 * ports, exactly as `serviceable_pincodes` already splits them.
 */
export interface BusinessHoursRepository {
  /** Re-binds to an open transaction. See `VendorRepository.withTransaction`. */
  withTransaction(scope: TransactionScope): BusinessHoursRepository;

  /** The vendor's whole schedule. Empty `intervals` means unconfigured — H4-A. */
  findByVendor(vendorId: VendorId): Promise<VendorBusinessHours>;

  /**
   * Replaces the vendor's whole schedule.
   *
   * Delete-then-insert rather than a diff: the schedule is small, replacement
   * is the only operation the contract offers, and a minimal delta would add
   * reconciliation logic with nothing to gain. Callers run this inside a
   * transaction, so a partially-replaced schedule is never observable — which
   * matters more here than for pincodes, since a half-applied schedule would
   * silently change when a vendor appears open.
   */
  replaceForVendor(vendorId: VendorId, hours: VendorBusinessHours): Promise<void>;
}

/**
 * The checkout-side read (S4-HOURS): every vendor's schedule for one instant,
 * in a bounded number of queries.
 *
 * Batched by contract, not by convention — a multi-vendor cart must not cost
 * one round trip per vendor, and the signature makes the N+1 shape
 * unspellable because there is no single-vendor variant to reach for.
 */
export interface BusinessHoursLookupRepository {
  /**
   * Resolves the schedules of many vendors at once.
   *
   * `weekday` and `isoDate` are supplied by the caller (derived from the
   * injected `Clock`, converted to IST) so the query can filter server-side to
   * just the rows that could possibly matter today, rather than loading every
   * vendor's whole week.
   *
   * Every requested vendor appears in the result — a vendor with no rows is
   * returned with empty collections rather than omitted, so the caller never
   * has to distinguish a missing key from a missing row.
   */
  findForVendors(
    vendorIds: readonly VendorId[],
    today: { readonly weekday: number; readonly isoDate: string },
  ): Promise<ReadonlyMap<VendorId, VendorBusinessHours>>;
}
