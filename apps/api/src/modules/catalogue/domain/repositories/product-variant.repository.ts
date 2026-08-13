import type { TransactionScope } from '@leen-mart/domain-kit';
import type { ProductVariant } from '../entities/product-variant.entity.js';
import type { ProductId } from '../value-objects/product-id.value-object.js';
import type { ProductVariantId } from '../value-objects/product-variant-id.value-object.js';

export interface ProductVariantRepository {
  /** Re-binds this repository to a transaction the caller already opened. See `ProductRepository.withTransaction`. */
  withTransaction(scope: TransactionScope): ProductVariantRepository;

  /**
   * Throws `ProductVariantSkuConflictError` if this vendor already has a
   * live variant with this SKU — arbitrated by `uq_product_variants_vendor_sku`,
   * never by a read-then-write check (S2-3 D-5).
   */
  create(variant: ProductVariant): Promise<void>;

  /** Scoped to the caller's own vendor by RLS, the same as `ProductRepository.findById`. */
  findById(id: ProductVariantId): Promise<ProductVariant | null>;

  /**
   * Scoped by **both** ids. A variant id that is real but belongs to a
   * different product — even one of the same vendor's — must read as absent
   * rather than as a hint that a valid id was supplied against the wrong
   * parent.
   */
  findByProductAndId(productId: ProductId, id: ProductVariantId): Promise<ProductVariant | null>;

  /**
   * Every live variant of one product, oldest first.
   *
   * Not paginated: a product's variant set is small and only useful whole —
   * the same reasoning `CategoryAttributeRepository.listByCategoryId` records.
   */
  listByProductId(productId: ProductId): Promise<readonly ProductVariant[]>;

  /** `false` when the row is gone. Also throws `ProductVariantSkuConflictError` if a rename ever collided. */
  update(variant: ProductVariant): Promise<boolean>;

  /** How many live variants the product still has. Read under the parent's lock, never on its own. */
  countLiveForProduct(productId: ProductId): Promise<number>;

  /**
   * Soft-deletes one variant. The caller must already hold the parent
   * product's lock (`ProductRepository.lockForVariantChange`) and have
   * checked `countLiveForProduct` — this method does not re-check, because
   * the count and the delete are only meaningful together and the lock is
   * what makes them atomic.
   */
  softDelete(variant: ProductVariant): Promise<boolean>;

  /** Soft-deletes every live variant of one product, for product deletion. Returns how many. */
  softDeleteAllForProduct(productId: ProductId, now: Date): Promise<number>;
}
