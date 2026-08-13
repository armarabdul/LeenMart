import type { TransactionScope } from '@leen-mart/domain-kit';
import type { ProductVariant } from '../entities/product-variant.entity.js';
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
}
