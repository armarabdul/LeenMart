import type { TransactionScope } from '@leen-mart/domain-kit';
import type { Product } from '../entities/product.entity.js';
import type { ProductId } from '../value-objects/product-id.value-object.js';

export interface ProductRepository {
  /**
   * Re-binds this repository to a transaction the caller already opened, so
   * a product write and its first variant's write commit or roll back
   * together. Same shape `CategoryRepository.withTransaction` publishes.
   */
  withTransaction(scope: TransactionScope): ProductRepository;

  create(product: Product): Promise<void>;

  /**
   * Scoped to the caller's own vendor by RLS and by `tenantContext`, not by
   * this method taking a `vendorId` parameter — the same reason
   * `VendorKycRepository`'s reads never do either. `null` for "never
   * existed", "soft-deleted" and "belongs to another vendor" alike.
   */
  findById(id: ProductId): Promise<Product | null>;
}
