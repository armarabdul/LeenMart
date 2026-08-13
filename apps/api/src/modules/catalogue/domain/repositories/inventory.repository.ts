import type { TransactionScope } from '@leen-mart/domain-kit';
import type { Inventory } from '../entities/inventory.entity.js';
import type { ProductId } from '../value-objects/product-id.value-object.js';
import type { ProductVariantId } from '../value-objects/product-variant-id.value-object.js';

export interface InventoryRepository {
  /**
   * Re-binds to a transaction the caller already opened, so a variant and its
   * counter commit or roll back together. Same shape every other catalogue
   * repository publishes.
   */
  withTransaction(scope: TransactionScope): InventoryRepository;

  create(inventory: Inventory): Promise<void>;

  /**
   * Scoped to the caller's own vendor by RLS and `tenantContext`, like every
   * other read in this module. `null` for "the variant does not exist",
   * "it belongs to another vendor" and "it hangs off a different product"
   * alike.
   *
   * Takes the product id as well as the variant id so a variant addressed
   * under the wrong product reads as absent — the same scoping
   * `ProductVariantRepository.findByProductAndId` applies.
   */
  findByProductAndVariant(
    productId: ProductId,
    variantId: ProductVariantId,
  ): Promise<Inventory | null>;

  /**
   * Writes the new stock level **only if** the row still carries
   * `expectedVersion` (S2-4 D-B).
   *
   * `false` means someone else moved first — a caller turns that into a 409.
   * Conditional rather than read-then-write for the reason every other
   * conditional write in this codebase is: the read would already be stale.
   *
   * This is the *vendor-facing* set. Stage 3's checkout decrement is a
   * different statement entirely (SDD 14.4's `WHERE available >= :qty`) and
   * must not route through here — a version guard there would make concurrent
   * buyers collide with each other rather than with the stock figure.
   */
  setIfVersionMatches(inventory: Inventory, expectedVersion: number): Promise<boolean>;

  /**
   * Removes the counters for a set of variants outright.
   *
   * A genuine `DELETE`, not a soft one: inventory carries no `deleted_at`
   * because it is a counter belonging to a variant rather than an entity with
   * its own lifecycle. Called in the same transaction as the variant removal
   * that prompted it, so a counter is never orphaned.
   */
  deleteForVariants(variantIds: readonly ProductVariantId[]): Promise<number>;

  /** Every counter belonging to one product, for product deletion. Returns how many went. */
  deleteForProduct(productId: ProductId): Promise<number>;
}
