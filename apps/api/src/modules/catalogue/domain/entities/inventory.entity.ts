import type { VendorId } from '../../../identity/index.js';
import { InvalidInventoryOperationError } from '../errors/catalogue-errors.js';
import type { ProductVariantId } from '../value-objects/product-variant-id.value-object.js';

/** Every counter starts here (S2-4 D-E): a variant exists, and it has no stock yet. */
export const INITIAL_INVENTORY_VERSION = 1;

export interface InventoryProps {
  readonly variantId: ProductVariantId;
  readonly vendorId: VendorId;
  readonly available: number;
  readonly reserved: number;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const assertCount = (field: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidInventoryOperationError(field, 'Must be a whole number of zero or more.');
  }
};

/**
 * Per-variant stock (SDD 6.3 "Stock", SDD 6.4, FR-12).
 *
 * The three fields are exactly SDD 6.3's — `available`, `reserved`, `version`
 * — and nothing beyond them. There is no low-stock threshold, no back-order
 * flag and no warehouse: the SDD names none, and a counter is a place where
 * speculative fields become load-bearing very quickly.
 *
 * **`version` earns its place here rather than being decorative.** It is what
 * `set()` below is guarded by: a vendor's `PATCH` carries the version it read,
 * and a stale one affects zero rows and is refused. That is the whole of its
 * purpose in Stage 2.
 *
 * **It is deliberately not what the checkout decrement will use.** SDD 14.4
 * prescribes a single atomic conditional `UPDATE … WHERE available >= :qty`
 * for that path, which needs no version and must not acquire one — a version
 * check would make every concurrent buyer retry against each other, which is
 * precisely the oversell-or-serialise problem §14.4 exists to avoid. That path
 * is Stage 3's, and this class does not anticipate it: there is no `reserve()`
 * and no `release()`.
 *
 * `reserved` is stored and read but never moved by anything in Stage 2, for
 * the same reason — it is the column Stage 3's reservation flow will own.
 */
export class Inventory {
  private constructor(private readonly props: InventoryProps) {}

  /**
   * The counter a newly created variant gets (S2-4 D-E): zero stock, nothing
   * reserved, version 1.
   *
   * Created in the same transaction as its variant, so a variant can never
   * exist without one — the same "never half a thing" reasoning D-7 applies to
   * a product and its first variant.
   */
  static initial(props: { variantId: ProductVariantId; vendorId: VendorId; now: Date }): Inventory {
    return new Inventory({
      variantId: props.variantId,
      vendorId: props.vendorId,
      available: 0,
      reserved: 0,
      version: INITIAL_INVENTORY_VERSION,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: InventoryProps): Inventory {
    return new Inventory(props);
  }

  get variantId(): ProductVariantId {
    return this.props.variantId;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get available(): number {
    return this.props.available;
  }

  get reserved(): number {
    return this.props.reserved;
  }

  get version(): number {
    return this.props.version;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /**
   * A vendor setting their own stock level (S2-4 D-B): absolute, not relative.
   *
   * Returns the intended next state with `version` already advanced. Whether
   * that state is *allowed to land* is not decided here — the repository's
   * conditional write compares the caller's expected version against the row
   * and reports zero rows if someone else moved first. An aggregate holding
   * only its own state cannot answer that question honestly.
   *
   * `reserved` is untouched: what is reserved belongs to the reservation flow,
   * not to a vendor editing a stock figure.
   */
  set(available: number, now: Date): Inventory {
    assertCount('available', available);
    return new Inventory({
      ...this.props,
      available,
      version: this.props.version + 1,
      updatedAt: now,
    });
  }
}
