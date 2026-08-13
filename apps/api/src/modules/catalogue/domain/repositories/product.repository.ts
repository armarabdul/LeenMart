import type { TransactionScope } from '@leen-mart/domain-kit';
import type { Product } from '../entities/product.entity.js';
import type { ProductId } from '../value-objects/product-id.value-object.js';

export interface ProductPage {
  readonly items: readonly Product[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

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

  /** `false` when the row is gone — a caller turns that into the same 404 a missing id gets. */
  update(product: Product): Promise<boolean>;

  /**
   * One page of the caller's own products, on the platform's cursor
   * convention (SDD 9.2). Tenant-scoped like every other read here, so it
   * takes no `vendorId` parameter.
   */
  listPage(input: { limit: number; cursor?: string | undefined }): Promise<ProductPage>;

  /**
   * Soft-deletes the product itself, conditional on it still being live — a
   * caller that lost a race to a concurrent delete gets `false` rather than
   * appearing to succeed twice.
   */
  softDelete(product: Product): Promise<boolean>;

  /**
   * Takes an exclusive row lock on the product for the rest of the caller's
   * transaction, and reports whether the product is still there.
   *
   * This is what serialises variant changes for one product. "A product keeps
   * at least one variant" spans rows, so no single-statement condition can
   * enforce it: two concurrent deletes would each count two live variants and
   * each proceed, leaving none. Locking the parent first makes the second
   * transaction wait and then observe the first's committed result.
   */
  lockForVariantChange(id: ProductId, now: Date): Promise<boolean>;
}
