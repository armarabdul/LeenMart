import type { VendorId } from '../../../identity/index.js';

/**
 * What one vendor's `serviceable_pincodes` rows say about a single delivery
 * pincode (S4-SERV).
 *
 * Two independent facts rather than one boolean, because "this vendor does
 * not serve 560001" and "this vendor has told us nothing" are different
 * situations with different answers under locked decision D7.
 */
export interface VendorServiceability {
  /**
   * Whether this vendor has declared *any* serviceable pincodes at all.
   *
   * Currently derived from "does it have rows?". D7 makes an unconfigured
   * vendor serve everywhere, and keeping that as its own field — rather than
   * folding it into `servesPincode` — is what lets a future explicit
   * `configured` flag replace this one predicate without touching the table,
   * the query, or any caller.
   */
  readonly configured: boolean;
  /** Whether the vendor declared this specific pincode. Meaningless when `configured` is false. */
  readonly servesPincode: boolean;
}

export interface ServiceabilityRepository {
  /**
   * Resolves every vendor's serviceability for one delivery pincode in a
   * **single** round trip.
   *
   * Batched by contract, not by convention: a multi-vendor cart must not cost
   * one query per vendor, and the signature makes the N+1 shape unspellable —
   * there is no single-vendor variant to reach for.
   *
   * Vendors with no rows are still present in the result, reported as
   * `configured: false`, so the caller never has to distinguish "absent from
   * the map" from "absent from the database".
   */
  resolveForPincode(
    pincode: string,
    vendorIds: readonly VendorId[],
  ): Promise<ReadonlyMap<VendorId, VendorServiceability>>;
}
