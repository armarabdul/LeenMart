import type { VendorId } from '../../../identity/index.js';
import { InvalidProductMediaOperationError } from '../errors/catalogue-errors.js';
import type { ProductMediaId } from '../value-objects/product-media-id.value-object.js';
import type { ProductMediaVariantId } from '../value-objects/product-media-variant-id.value-object.js';

/** SDD 12.2's fixed variant matrix (D-S2-6-F) — no other width is ever legitimately generated. */
export const PRODUCT_MEDIA_VARIANT_WIDTHS = [200, 400, 800, 1600] as const;
export type ProductMediaVariantWidth = (typeof PRODUCT_MEDIA_VARIANT_WIDTHS)[number];

export type ProductMediaVariantFormat = 'WEBP' | 'AVIF';

export const PRODUCT_MEDIA_VARIANT_FORMATS: readonly ProductMediaVariantFormat[] = ['WEBP', 'AVIF'];

export interface ProductMediaVariantProps {
  readonly id: ProductMediaVariantId;
  readonly mediaId: ProductMediaId;
  readonly vendorId: VendorId;
  readonly width: ProductMediaVariantWidth;
  readonly format: ProductMediaVariantFormat;
  readonly objectKey: string;
  readonly sizeBytes: number;
  readonly createdAt: Date;
}

/**
 * One generated variant of a `ProductMedia` (S2-6b, SDD 12.2 step 5f). Write-
 * once and immutable — unlike `ProductMedia` itself, this entity has no
 * transitions: a worker either finds the `(mediaId, width, format)` row
 * already there (idempotent skip) or creates a fresh one, and there is never
 * a reason to edit one afterwards. `PrismaProductMediaVariantRepository`
 * enforces "write-once" with `INSERT ... ON CONFLICT DO NOTHING` against the
 * database's own unique index — never a read-then-write existence check —
 * the same "the database decides" discipline every other conditional write
 * in this module keeps.
 */
export class ProductMediaVariant {
  private constructor(private readonly props: ProductMediaVariantProps) {}

  static create(props: {
    id: ProductMediaVariantId;
    mediaId: ProductMediaId;
    vendorId: VendorId;
    width: ProductMediaVariantWidth;
    format: ProductMediaVariantFormat;
    objectKey: string;
    sizeBytes: number;
    now: Date;
  }): ProductMediaVariant {
    if (props.objectKey.trim().length === 0) {
      throw new InvalidProductMediaOperationError('objectKey', 'Must not be blank.');
    }
    if (!Number.isInteger(props.sizeBytes) || props.sizeBytes <= 0) {
      throw new InvalidProductMediaOperationError('sizeBytes', 'Must be a positive integer.');
    }

    return new ProductMediaVariant({
      id: props.id,
      mediaId: props.mediaId,
      vendorId: props.vendorId,
      width: props.width,
      format: props.format,
      objectKey: props.objectKey,
      sizeBytes: props.sizeBytes,
      createdAt: props.now,
    });
  }

  static reconstitute(props: ProductMediaVariantProps): ProductMediaVariant {
    return new ProductMediaVariant(props);
  }

  get id(): ProductMediaVariantId {
    return this.props.id;
  }

  get mediaId(): ProductMediaId {
    return this.props.mediaId;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get width(): ProductMediaVariantWidth {
    return this.props.width;
  }

  get format(): ProductMediaVariantFormat {
    return this.props.format;
  }

  get objectKey(): string {
    return this.props.objectKey;
  }

  get sizeBytes(): number {
    return this.props.sizeBytes;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
