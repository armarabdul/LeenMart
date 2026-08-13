import type { Money } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';
import { InvalidProductOperationError } from '../errors/catalogue-errors.js';
import type { ProductId } from '../value-objects/product-id.value-object.js';
import type { ProductVariantId } from '../value-objects/product-variant-id.value-object.js';
import { toSku, type Sku } from '../value-objects/sku.value-object.js';

const NAME_MAX_LENGTH = 120;
const UNIT_OF_MEASURE_MAX_LENGTH = 40;

export interface ProductVariantProps {
  readonly id: ProductVariantId;
  readonly productId: ProductId;
  readonly vendorId: VendorId;
  readonly sku: Sku;
  readonly name: string;
  readonly price: Money;
  readonly unitOfMeasure: string;
  readonly quantityStep: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

const assertNotBlank = (field: string, value: string): void => {
  if (value.trim().length === 0) {
    throw new InvalidProductOperationError(field, 'Must not be blank.');
  }
};

const assertWithinLength = (field: string, value: string, max: number): void => {
  if (value.length > max) {
    throw new InvalidProductOperationError(field, `Must be at most ${max} characters.`);
  }
};

/**
 * The fields a vendor may edit after creation (S2-3b).
 *
 * `sku`, `productId` and `vendorId` are absent by construction — see
 * `updateDetails` for why.
 */
export interface ProductVariantDetailChanges {
  readonly name?: string | undefined;
  readonly price?: Money | undefined;
  readonly unitOfMeasure?: string | undefined;
  readonly quantityStep?: number | undefined;
}

/**
 * The sellable unit (SDD 6.3 "Product ↔ Variant", ASM-15, FR-10/11). Vendor-
 * owned and tenant-scoped, always reached through its parent `Product`.
 *
 * `unitOfMeasure` is free text (S2-3 D-3): the SDD gives examples ("per kg",
 * "250 g steps") but never a closed vocabulary, so this class does not
 * invent one — only shape (non-blank, within the column) is enforced.
 *
 * `sku` is a `Sku` value object rather than a plain string for the same
 * reason `CategorySlug` is branded — it is a stable business identifier,
 * arbitrated by `uq_product_variants_vendor_sku` (S2-3 D-5) exactly the way
 * `idx_categories_slug_unique` arbitrates a category's slug.
 *
 * Carries no stock. SDD 6.3's own decision keeps stock in a separate
 * `inventory` row per variant — a later chunk this class does not
 * anticipate.
 */
export class ProductVariant {
  private constructor(private readonly props: ProductVariantProps) {}

  static create(props: {
    id: ProductVariantId;
    productId: ProductId;
    vendorId: VendorId;
    sku: string;
    name: string;
    price: Money;
    unitOfMeasure: string;
    quantityStep: number;
    now: Date;
  }): ProductVariant {
    const sku = toSku(props.sku);

    const name = props.name.trim();
    assertNotBlank('name', name);
    assertWithinLength('name', name, NAME_MAX_LENGTH);

    const unitOfMeasure = props.unitOfMeasure.trim();
    assertNotBlank('unitOfMeasure', unitOfMeasure);
    assertWithinLength('unitOfMeasure', unitOfMeasure, UNIT_OF_MEASURE_MAX_LENGTH);

    if (props.price.isNegative()) {
      throw new InvalidProductOperationError('price', 'Must not be negative.');
    }
    if (!Number.isInteger(props.quantityStep) || props.quantityStep <= 0) {
      throw new InvalidProductOperationError('quantityStep', 'Must be a positive integer.');
    }

    return new ProductVariant({
      id: props.id,
      productId: props.productId,
      vendorId: props.vendorId,
      sku,
      name,
      price: props.price,
      unitOfMeasure,
      quantityStep: props.quantityStep,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: ProductVariantProps): ProductVariant {
    return new ProductVariant(props);
  }

  get id(): ProductVariantId {
    return this.props.id;
  }

  get productId(): ProductId {
    return this.props.productId;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get sku(): Sku {
    return this.props.sku;
  }

  get name(): string {
    return this.props.name;
  }

  get price(): Money {
    return this.props.price;
  }

  get unitOfMeasure(): string {
    return this.props.unitOfMeasure;
  }

  get quantityStep(): number {
    return this.props.quantityStep;
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
   * A partial edit (S2-3b). Only the supplied fields change, and each goes
   * through the same checks `create` applies.
   *
   * **`sku` is absent, and there is no mutator for it anywhere on this
   * class.** S2-3a made it a branded, index-arbitrated business identifier
   * and gave it no way to change; S2-3b preserves that rather than inventing
   * mutation behaviour the earlier chunk deliberately left out. `productId`
   * and `vendorId` are likewise fixed — a variant does not move between
   * products or vendors.
   */
  updateDetails(changes: ProductVariantDetailChanges, now: Date): ProductVariant {
    this.assertLive('updateDetails');

    const name = (changes.name ?? this.props.name).trim();
    assertNotBlank('name', name);
    assertWithinLength('name', name, NAME_MAX_LENGTH);

    const unitOfMeasure = (changes.unitOfMeasure ?? this.props.unitOfMeasure).trim();
    assertNotBlank('unitOfMeasure', unitOfMeasure);
    assertWithinLength('unitOfMeasure', unitOfMeasure, UNIT_OF_MEASURE_MAX_LENGTH);

    const price = changes.price ?? this.props.price;
    if (price.isNegative()) {
      throw new InvalidProductOperationError('price', 'Must not be negative.');
    }

    const quantityStep = changes.quantityStep ?? this.props.quantityStep;
    if (!Number.isInteger(quantityStep) || quantityStep <= 0) {
      throw new InvalidProductOperationError('quantityStep', 'Must be a positive integer.');
    }

    return new ProductVariant({
      ...this.props,
      name,
      price,
      unitOfMeasure,
      quantityStep,
      updatedAt: now,
    });
  }

  /**
   * Soft delete (SDD 6.1).
   *
   * Whether this is the product's *last* live variant is deliberately not
   * asked here: an aggregate holding only its own state cannot see its
   * siblings, and a check performed here would still lose to a variant
   * deleted a millisecond later. `ProductVariantRepository.softDeleteIfNotLast`
   * settles it against the database, the same division
   * `Category.softDelete`/`softDeleteIfEmpty` already established.
   */
  softDelete(now: Date): ProductVariant {
    this.assertLive('deletedAt');
    return new ProductVariant({ ...this.props, deletedAt: now, updatedAt: now });
  }

  private assertLive(field: string): void {
    if (this.isDeleted) {
      throw new InvalidProductOperationError(field, 'This variant has been deleted.');
    }
  }
}
