import type { TransactionScope } from '@leen-mart/domain-kit';
import type { ProductMediaVariant } from '../entities/product-media-variant.entity.js';
import type { ProductMediaId } from '../value-objects/product-media-id.value-object.js';

export interface ProductMediaVariantRepository {
  /** Re-binds this repository to a transaction the caller already opened. See `ProductRepository.withTransaction`. */
  withTransaction(scope: TransactionScope): ProductMediaVariantRepository;

  /**
   * Writes the variant, unless a row for its `(mediaId, width, format)`
   * already exists — the worker's idempotency guard for a redelivered or
   * retried job (S2-6b). `true` when this call actually wrote the row,
   * `false` when it was already there; either way the row exists once this
   * resolves. Arbitrated by `uq_product_media_variants_media_width_format`
   * via `INSERT ... ON CONFLICT DO NOTHING`, never a read-then-write
   * existence check — two workers racing to write the same pair leave
   * exactly one row, not a duplicate and not an error.
   */
  createIfAbsent(variant: ProductMediaVariant): Promise<boolean>;

  /** Every variant of one media item, however many exist yet — a partially-processed item legitimately has fewer than 8. */
  listByMediaId(mediaId: ProductMediaId): Promise<readonly ProductMediaVariant[]>;

  /** Cheap existence check the worker uses to decide whether a `(mediaId, width, format)` pair still needs generating, without reading every column. */
  countByMediaId(mediaId: ProductMediaId): Promise<number>;
}
