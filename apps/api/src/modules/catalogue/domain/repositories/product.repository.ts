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

  /**
   * The same lock, for the same reason, one aggregate over (S2-6a). "At most
   * `MAX_IMAGES_PER_PRODUCT` media items" spans rows exactly the way "at
   * least one live variant" does, so it needs the identical serialisation
   * point: two concurrent uploads that each count seven live media items and
   * each proceed would leave nine. A distinct method from
   * `lockForVariantChange` rather than a shared one — they lock the same row
   * for the same mechanical reason, but conflating the two names would blur
   * which invariant a caller is actually protecting.
   */
  lockForMediaChange(id: ProductId, now: Date): Promise<boolean>;

  /**
   * Returns a product to `PENDING_REVIEW`, but only if it is still `APPROVED`
   * (S2-6a, ASM-14). The arbiter of a media change racing a second one, or
   * racing an admin decision that just approved the product — mirrors
   * `submitForReviewIfEligible`'s "database decides who wins" exactly, one
   * transition later and with `APPROVED` playing the role `DRAFT`/`REJECTED`
   * play there.
   */
  reenterReviewIfApproved(product: Product): Promise<boolean>;

  /**
   * Persists a detail edit together with the ASM-14 detail-change reopening
   * (S2-8), atomically and conditional on the product still being
   * `APPROVED` — the same "database decides who wins" arbitration
   * `reenterReviewIfApproved` uses, extended to also carry the edited fields
   * in the one conditional write. Unlike the media trigger, the write that
   * must reopen the product *is* the edit itself: there is no separate row
   * whose change can be persisted first.
   *
   * `false` means the product was no longer `APPROVED` by the time this
   * write reached PostgreSQL (or the row is gone) — the caller's edit is not
   * applied at all in that case, not partially.
   */
  updateAndReenterReviewIfApproved(product: Product): Promise<boolean>;

  /**
   * Moves a product into `PENDING_REVIEW`, but only if it is still `DRAFT` or
   * `REJECTED` (S2-5).
   *
   * The arbiter of concurrent submissions. `Product.submitForReview` already
   * refuses the ordinary case where the *loaded* status forbids it; this
   * conditional write is the race the aggregate cannot see — two callers may
   * both have loaded an eligible row before either wrote, and only one
   * `UPDATE ... WHERE status IN (...)` can affect it. `false` means someone
   * else changed the status first, mirroring
   * `VendorKycRepository.claimForReviewIfUnclaimed`'s "not an error here; the
   * caller decides what to do about it."
   */
  submitForReviewIfEligible(product: Product): Promise<boolean>;

  /**
   * Records an administrator's decision, but only if the product is still
   * `PENDING_REVIEW` (S2-5).
   *
   * The arbiter of concurrent approve/reject decisions — the same
   * "database decides who wins" reasoning `VendorKycRepository.saveDecisionIfUndecided`
   * gives, with `PENDING_REVIEW` playing the role `decided_at IS NULL` plays
   * there. There is deliberately no claim step ahead of this (S2-5 D-5-D): a
   * lost race here is the *only* thing that needs arbitrating, so the decision
   * itself is where the conditional write lives.
   */
  decideIfPendingReview(product: Product): Promise<boolean>;
}
