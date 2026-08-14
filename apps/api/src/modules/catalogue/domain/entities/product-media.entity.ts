import type { VendorId } from '../../../identity/index.js';
import { InvalidProductMediaOperationError } from '../errors/catalogue-errors.js';
import type { ProductId } from '../value-objects/product-id.value-object.js';
import type { ProductMediaId } from '../value-objects/product-media-id.value-object.js';

const CONTENT_TYPE_MAX_LENGTH = 100;

/**
 * The upload/processing lifecycle (S2-6a, SDD 12.2), as far as this
 * milestone builds it. `READY`/`FAILED` are S2-6b's (the async worker,
 * D-S2-6-A/K) — see `ProductMediaStatus` in `schema.prisma` for why they are
 * not declared yet.
 */
export type ProductMediaStatusName = 'AWAITING_UPLOAD' | 'PROCESSING';

export interface ProductMediaProps {
  readonly id: ProductMediaId;
  readonly productId: ProductId;
  readonly vendorId: VendorId;
  readonly objectKey: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly status: ProductMediaStatusName;
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
 * One uploaded media asset for a product (S2-6a, SDD 12.1/12.2). Vendor-owned
 * and tenant-scoped, always reached through its parent `Product` — SDD 6.2's
 * entity diagram draws `product_media` as a child of `products`, a sibling of
 * `product_variants`, never nested under a variant.
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
 * these are SDD-specified (S2-6 inspection R5) and S2-6a's API surface has
 * nothing that would read them.
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
