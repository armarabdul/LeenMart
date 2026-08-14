import type { TransactionScope } from '@leen-mart/domain-kit';
import type { ProductMedia } from '../entities/product-media.entity.js';
import type { ProductId } from '../value-objects/product-id.value-object.js';
import type { ProductMediaId } from '../value-objects/product-media-id.value-object.js';

export interface ProductMediaRepository {
  /** Re-binds this repository to a transaction the caller already opened. See `ProductRepository.withTransaction`. */
  withTransaction(scope: TransactionScope): ProductMediaRepository;

  create(media: ProductMedia): Promise<void>;

  /** Scoped to the caller's own vendor by RLS, the same as `ProductRepository.findById`. */
  findById(id: ProductMediaId): Promise<ProductMedia | null>;

  /**
   * Scoped by **both** ids. A media id that is real but belongs to a
   * different product — even one of the same vendor's — must read as absent
   * rather than as a hint that a valid id was supplied against the wrong
   * parent, the same reasoning `ProductVariantRepository.findByProductAndId`
   * gives.
   */
  findByProductAndId(productId: ProductId, id: ProductMediaId): Promise<ProductMedia | null>;

  /** Every live media item of one product, oldest first. Not paginated — S2-6a D-S2-6-I caps this at `MAX_IMAGES_PER_PRODUCT`. */
  listByProductId(productId: ProductId): Promise<readonly ProductMedia[]>;

  /**
   * How many live media items the product still has, regardless of their
   * processing status — an `AWAITING_UPLOAD` row still reserves a slot
   * against the cap. Read under the parent's lock, never on its own, the
   * same discipline `ProductVariantRepository.countLiveForProduct` keeps.
   */
  countLiveForProduct(productId: ProductId): Promise<number>;

  /**
   * Moves a media item into `PROCESSING`, but only if it is still
   * `AWAITING_UPLOAD`. The arbiter of concurrent completion attempts — the
   * same "database decides who wins" pattern
   * `ProductRepository.submitForReviewIfEligible` uses, one aggregate over.
   */
  completeIfAwaitingUpload(media: ProductMedia): Promise<boolean>;

  /**
   * Moves a media item into `READY`, but only if it is still `PROCESSING`
   * (S2-6b). The arbiter when two workers race to finish the same item —
   * whichever `UPDATE` reaches PostgreSQL first wins; the other's `false`
   * means its own work was redundant, not that anything is wrong. Also what
   * makes a late, redelivered completion of an already-`READY` item a safe
   * no-op rather than a corruption: the `WHERE status = 'PROCESSING'` simply
   * matches nothing.
   */
  markReadyIfProcessing(media: ProductMedia): Promise<boolean>;

  /**
   * Moves a media item into `FAILED` with its reason, but only if it is
   * still `PROCESSING` (S2-6b). Same arbitration shape as
   * `markReadyIfProcessing`, one outcome over.
   */
  markFailedIfProcessing(media: ProductMedia): Promise<boolean>;

  /**
   * Re-enters `PROCESSING` from `FAILED` (S2-6b D-S2-6-K's retry arrow), but
   * only if it is still `FAILED` — guards a retry racing a second retry of
   * the same item the same way every other transition here guards its own
   * precondition against the database, not just the in-memory entity.
   */
  markProcessingIfFailed(media: ProductMedia): Promise<boolean>;

  /** `false` when the row is gone — a caller turns that into the same 404 a missing id gets. */
  softDelete(media: ProductMedia): Promise<boolean>;
}
