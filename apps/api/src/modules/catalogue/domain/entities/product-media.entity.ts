import type { VendorId } from '../../../identity/index.js';
import { InvalidProductMediaOperationError } from '../errors/catalogue-errors.js';
import type { ProductId } from '../value-objects/product-id.value-object.js';
import type { ProductMediaId } from '../value-objects/product-media-id.value-object.js';

const CONTENT_TYPE_MAX_LENGTH = 100;
const FAILURE_REASON_MAX_LENGTH = 64;

/**
 * The upload/processing lifecycle (S2-6a/S2-6b, SDD 12.2).
 *
 * Only `AWAITING_UPLOAD` and `READY` are named by the SDD — 12.2's own
 * pipeline: a pending row, then, after the worker finishes, `status =
 * READY`. `PROCESSING` and `FAILED` are **implementation states** this
 * codebase adds to represent asynchronous processing honestly: the SDD's
 * pipeline is not instantaneous, and a column that could only ever say
 * "pending" or "done" would be lying about every upload while its worker job
 * is actually running or has genuinely failed. Kept distinguished in this
 * comment because it is a real modelling decision, not an oversight.
 */
export type ProductMediaStatusName = 'AWAITING_UPLOAD' | 'PROCESSING' | 'READY' | 'FAILED';

/**
 * A closed, internal vocabulary of short failure codes (S2-6b) — never a raw
 * exception message or stack trace. Safe to eventually surface to the vendor
 * who owns the row, unlike the exception text that produced it.
 *
 * `OBJECT_NOT_FOUND`/`CONTENT_TYPE_MISMATCH`/`SVG_REJECTED`/`DECODE_FAILED`
 * are permanent — retrying changes nothing about a spoofed or malformed
 * upload, so the worker marks these immediately, without spending BullMQ's
 * retry budget. `PROCESSING_ERROR` is the generic bucket for a transient
 * failure (store outage, an unexpected exception) that already exhausted
 * BullMQ's own attempts — see `product-media-worker.ts`.
 */
export type ProductMediaFailureReason =
  | 'OBJECT_NOT_FOUND'
  | 'CONTENT_TYPE_MISMATCH'
  | 'SVG_REJECTED'
  | 'DECODE_FAILED'
  | 'PROCESSING_ERROR';

export interface ProductMediaProps {
  readonly id: ProductMediaId;
  readonly productId: ProductId;
  readonly vendorId: VendorId;
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly status: ProductMediaStatusName;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

const assertNotBlank = (field: string, value: string): void => {
  if (value.trim().length === 0) {
    throw new InvalidProductMediaOperationError(field, 'Must not be blank.');
  }
};

/**
 * One uploaded media asset for a product (S2-6a/S2-6b, SDD 12.1/12.2).
 * Vendor-owned and tenant-scoped, always reached through its parent
 * `Product` — SDD 6.2's entity diagram draws `product_media` as a child of
 * `products`, a sibling of `product_variants`, never nested under a variant.
 *
 * **`objectKey`/`contentType`/`sizeBytes` are shape-checked here only** — not
 * blank, and `sizeBytes` a positive integer. The MIME allowlist and the size
 * cap are `S3ObjectStore.presignPut`'s job (S2-6a D-S2-6-I): this entity is
 * constructed *after* a presign has already succeeded, so duplicating those
 * specific business rules here would be a second copy of them, free to drift
 * from the first. What this class owns is the shape a row must have to be
 * coherent at all, the same division `Product`'s own shape checks keep from
 * `SubmitProductForReviewUseCase`'s category-conditional ones.
 *
 * Carries no filename, caption, display position or dimensions — none of
 * these are SDD-specified (S2-6 inspection R5) and no API surface reads them.
 * The 8 derived variants a READY item owns live in `ProductMediaVariant`
 * rows of their own (S2-6b), not on this entity — `objectKey` here always
 * names the original upload, never republished as-is (SDD 12.2: every served
 * file is freshly re-encoded).
 */
export class ProductMedia {
  private constructor(private readonly props: ProductMediaProps) {}

  static create(props: {
    id: ProductMediaId;
    productId: ProductId;
    vendorId: VendorId;
    objectKey: string;
    contentType: string;
    sizeBytes: number;
    now: Date;
  }): ProductMedia {
    assertNotBlank('objectKey', props.objectKey);
    assertNotBlank('contentType', props.contentType);
    if (props.contentType.length > CONTENT_TYPE_MAX_LENGTH) {
      throw new InvalidProductMediaOperationError(
        'contentType',
        `Must be at most ${CONTENT_TYPE_MAX_LENGTH} characters.`,
      );
    }
    if (!Number.isInteger(props.sizeBytes) || props.sizeBytes <= 0) {
      throw new InvalidProductMediaOperationError('sizeBytes', 'Must be a positive integer.');
    }

    return new ProductMedia({
      id: props.id,
      productId: props.productId,
      vendorId: props.vendorId,
      objectKey: props.objectKey,
      contentType: props.contentType,
      sizeBytes: props.sizeBytes,
      status: 'AWAITING_UPLOAD',
      failureReason: null,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: ProductMediaProps): ProductMedia {
    return new ProductMedia(props);
  }

  get id(): ProductMediaId {
    return this.props.id;
  }

  get productId(): ProductId {
    return this.props.productId;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get objectKey(): string {
    return this.props.objectKey;
  }

  get contentType(): string {
    return this.props.contentType;
  }

  get sizeBytes(): number {
    return this.props.sizeBytes;
  }

  get status(): ProductMediaStatusName {
    return this.props.status;
  }

  get failureReason(): string | null {
    return this.props.failureReason;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }

  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /**
   * The vendor's client confirmed the upload landed (SDD 12.2 step 4).
   * Reachable only from `AWAITING_UPLOAD` — `CompleteProductMediaUploadUseCase`
   * has already verified the object genuinely exists via `ObjectStore.head()`
   * before calling this; this method only enforces that the *status* permits
   * the transition, the same division `Product.submitForReview` keeps from
   * its own use case's mandatory-field pre-screen.
   */
  completeUpload(now: Date): ProductMedia {
    this.assertLive('completeUpload');
    if (this.props.status !== 'AWAITING_UPLOAD') {
      throw new InvalidProductMediaOperationError(
        'completeUpload',
        `Media in ${this.props.status} cannot be completed; it must be AWAITING_UPLOAD.`,
      );
    }
    return new ProductMedia({ ...this.props, status: 'PROCESSING', updatedAt: now });
  }

  /**
   * The worker finished the whole pipeline: re-encode, EXIF/GPS strip, all 8
   * variants generated and stored (S2-6b, SDD 12.2 step 5i). Reachable only
   * from `PROCESSING` — this method enforces the status precondition; the
   * conditional `UPDATE ... WHERE status = 'PROCESSING'`
   * (`ProductMediaRepository.markReadyIfProcessing`) is what actually
   * arbitrates two workers racing to finish the same item, the same "database
   * decides who wins" split every other transition in this module keeps
   * between the entity and its repository.
   */
  markReady(now: Date): ProductMedia {
    this.assertLive('markReady');
    if (this.props.status !== 'PROCESSING') {
      throw new InvalidProductMediaOperationError(
        'markReady',
        `Media in ${this.props.status} cannot become READY; it must be PROCESSING.`,
      );
    }
    return new ProductMedia({
      ...this.props,
      status: 'READY',
      failureReason: null,
      updatedAt: now,
    });
  }

  /**
   * The worker could not complete the pipeline (S2-6b). Reachable only from
   * `PROCESSING` — a `READY` item is never demoted, and an already-`FAILED`
   * one is retried via `retryProcessing`, not failed again in place.
   */
  markFailed(reason: ProductMediaFailureReason, now: Date): ProductMedia {
    this.assertLive('markFailed');
    if (this.props.status !== 'PROCESSING') {
      throw new InvalidProductMediaOperationError(
        'markFailed',
        `Media in ${this.props.status} cannot become FAILED; it must be PROCESSING.`,
      );
    }
    if (reason.length > FAILURE_REASON_MAX_LENGTH) {
      throw new InvalidProductMediaOperationError(
        'markFailed',
        `Failure reason must be at most ${FAILURE_REASON_MAX_LENGTH} characters.`,
      );
    }
    return new ProductMedia({
      ...this.props,
      status: 'FAILED',
      failureReason: reason,
      updatedAt: now,
    });
  }

  /**
   * Re-enters processing after a failure (S2-6b D-S2-6-K:
   * `PROCESSING → FAILED → retry → PROCESSING`). Reachable only from
   * `FAILED`; clears the prior `failureReason` the same way
   * `Product.submitForReview` clears a prior rejection on resubmission — a
   * fresh attempt is not still carrying the verdict on the one before it.
   */
  retryProcessing(now: Date): ProductMedia {
    this.assertLive('retryProcessing');
    if (this.props.status !== 'FAILED') {
      throw new InvalidProductMediaOperationError(
        'retryProcessing',
        `Media in ${this.props.status} cannot be retried; it must be FAILED.`,
      );
    }
    return new ProductMedia({
      ...this.props,
      status: 'PROCESSING',
      failureReason: null,
      updatedAt: now,
    });
  }

  /** Soft delete (SDD 6.1), the same convention every other catalogue entity uses. */
  softDelete(now: Date): ProductMedia {
    this.assertLive('deletedAt');
    return new ProductMedia({ ...this.props, deletedAt: now, updatedAt: now });
  }

  private assertLive(field: string): void {
    if (this.isDeleted) {
      throw new InvalidProductMediaOperationError(field, 'This media item has been deleted.');
    }
  }
}
