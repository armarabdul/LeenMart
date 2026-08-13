import type { VendorId } from '../../../identity/index.js';
import type { ProductAttributeValues } from '../../domain/entities/product.entity.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';
import type { ProductId } from '../../domain/value-objects/product-id.value-object.js';

/**
 * The moderation phase of a product's lifecycle (SDD 15.2) — the states this
 * queue reads. `DRAFT` is excluded: a product that was never submitted has
 * nothing for a reviewer to do.
 */
export type ProductReviewStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

/** One queue row: enough to triage, nothing more. */
export interface ProductReviewQueueItem {
  readonly productId: ProductId;
  readonly vendorId: VendorId;
  readonly categoryId: CategoryId;
  readonly name: string;
  readonly status: ProductReviewStatus;
  /**
   * When the row's `status` last changed. There is no separate `submittedAt`
   * column (S2-5 D-5-C defers a tracked submission history) — `updatedAt` is
   * an honest stand-in exactly because nothing else touches a product's
   * `status` column, so for a row that has never been edited since entering
   * `PENDING_REVIEW` the two coincide.
   */
  readonly updatedAt: Date;
}

/** One product in full, as a reviewer sees it. */
export interface ProductReviewDetail extends ProductReviewQueueItem {
  readonly brand: string | null;
  readonly description: string | null;
  readonly hsnCode: string | null;
  readonly countryOfOrigin: string | null;
  readonly netQuantity: string | null;
  readonly attributeValues: ProductAttributeValues;
  readonly rejectionReason: string | null;
  readonly rejectionNote: string | null;
  readonly createdAt: Date;
}

export interface ProductReviewQueuePage {
  readonly items: readonly ProductReviewQueueItem[];
  /** The cursor to pass for the next page, or `null` at the end. */
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * The administrator's read-only view of products under moderation, **across
 * every vendor**.
 *
 * A separate port from `ProductRepository` rather than more methods on it,
 * for the exact reason `KycReviewQueryPort` is separate from
 * `VendorKycRepository`: the two answer to different authorities.
 * `ProductRepository` is tenant-scoped — every query it issues runs under RLS
 * policies comparing `vendor_id` to the caller's own. This one is
 * deliberately cross-tenant and runs on `leenmart_admin`, whose `SELECT`
 * policy (`products_admin_read`) permits reading every vendor's rows.
 *
 * **Read-only by construction.** There is no `approve`/`reject` here —
 * deciding runs through the domain aggregate and `ProductRepository`'s
 * conditional writes, not through a query port, mirroring KYC-5 Commit 3's
 * exact separation.
 */
export interface ProductReviewQueryPort {
  /**
   * The review queue, oldest waiting first.
   *
   * `cursor` is the `productId` of the last row of the previous page —
   * opaque to the caller, keyset rather than offset (SDD 9.2), so a
   * submission arriving mid-pagination cannot shift rows onto a page already
   * read.
   */
  listForReview(input: {
    statuses: readonly ProductReviewStatus[];
    limit: number;
    cursor?: string | undefined;
  }): Promise<ProductReviewQueuePage>;

  /** One product by id, whatever its lifecycle state. `null` when absent. */
  findDetailById(productId: ProductId): Promise<ProductReviewDetail | null>;
}
