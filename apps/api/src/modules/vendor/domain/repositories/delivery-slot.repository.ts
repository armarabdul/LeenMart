import type { TransactionScope } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';
import type {
  DeliverySlotTemplate,
  SlotBooking,
  SlotSelection,
} from '../services/delivery-slot-policy.js';

/**
 * A vendor's own slot offer (S4-SLOTS), for the management path.
 *
 * The vendor-facing half. Checkout reads the same table through
 * `SlotAvailabilityRepository`, which answers a different question (batched,
 * for many vendors, on a different credential) — deliberately two ports,
 * exactly as `serviceable_pincodes` and `business_hours` already split them.
 */
export interface DeliverySlotRepository {
  /** Re-binds to an open transaction. See `VendorRepository.withTransaction`. */
  withTransaction(scope: TransactionScope): DeliverySlotRepository;

  /** Every window the vendor offers. Empty means the vendor takes orders without a slot. */
  findByVendor(vendorId: VendorId): Promise<readonly DeliverySlotTemplate[]>;

  /**
   * Replaces the vendor's whole offer.
   *
   * Delete-then-insert rather than a diff, for the reason
   * `BusinessHoursRepository.replaceForVendor` states: replacement is the only
   * operation the contract offers and a minimal delta would add reconciliation
   * logic with nothing to gain. Callers run this inside a transaction.
   *
   * **Bookings already taken are untouched.** `slot_capacity` rows carry their
   * own snapshotted `capacity` and are never rewritten from the templates, so
   * withdrawing a window cannot retroactively invalidate an order that already
   * booked it.
   */
  replaceForVendor(vendorId: VendorId, slots: readonly DeliverySlotTemplate[]): Promise<void>;

  /** Bookings the vendor can see for its own windows, for the "3 of 8 booked" view. */
  findBookingsByVendor(
    vendorId: VendorId,
    range: { readonly fromDate: string; readonly toDate: string },
  ): Promise<readonly SlotBooking[]>;
}

/**
 * The checkout-side read and write (S4-SLOTS).
 *
 * Batched by contract, not by convention — a multi-vendor cart must not cost
 * one round trip per vendor, and the signatures make the N+1 shape unspellable
 * because there is no single-vendor variant to reach for.
 *
 * Bound to `leenmart_checkout`, the only credential besides the owning vendor
 * granted reach into these tables, and the only one that may move `booked`.
 */
export interface SlotAvailabilityRepository {
  /** Re-binds to an open transaction, so consumption joins the placement's own commit. */
  withTransaction(scope: TransactionScope): SlotAvailabilityRepository;

  /**
   * Every requested vendor's templates. A vendor with no rows appears with an
   * empty array rather than being omitted, so the caller never has to
   * distinguish a missing key from a missing row.
   */
  findTemplatesForVendors(
    vendorIds: readonly VendorId[],
  ): Promise<ReadonlyMap<VendorId, readonly DeliverySlotTemplate[]>>;

  /** Bookings for those vendors inside a bounded date range, for the availability view only. */
  findBookingsForVendors(
    vendorIds: readonly VendorId[],
    range: { readonly fromDate: string; readonly toDate: string },
  ): Promise<ReadonlyMap<VendorId, readonly SlotBooking[]>>;

  /**
   * **The correctness-bearing operation** (locked decision S12).
   *
   * Materialises the dated row if it does not exist yet (locked decision S3 —
   * lazily, at booking time, with no generator job), then takes one unit with a
   * **single atomic conditional UPDATE**. Never a read-then-write: the
   * `booked < capacity` guard lives in the statement's own `WHERE`, so
   * PostgreSQL evaluates it against whatever the row holds at execution time.
   *
   * Returns `false` when the window is full — the caller aborts the whole
   * placement rather than substituting another slot.
   *
   * `capacity` is the value snapshotted into the row when it is first created;
   * an existing row keeps the capacity it was created with.
   */
  consume(
    vendorId: VendorId,
    slot: SlotSelection & { readonly endMinute: number; readonly capacity: number },
  ): Promise<boolean>;

  /**
   * Returns one unit on cancellation (locked decision S8), the exact inverse of
   * `consume` and on the same credential — so a release failure rolls the
   * cancellation back rather than leaving a window permanently short.
   *
   * Conditional on `booked > 0` for the same reason `consume` is conditional:
   * a replayed release must not drive the counter negative, and the CHECK
   * constraint would abort the transaction if it tried.
   */
  release(vendorId: VendorId, slot: SlotSelection): Promise<void>;
}
