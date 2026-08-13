import type { VendorId } from '../../../identity/index.js';
import { InvalidProductOperationError } from '../errors/catalogue-errors.js';
import type { CategoryId } from '../value-objects/category-id.value-object.js';
import type { ProductId } from '../value-objects/product-id.value-object.js';

const NAME_MAX_LENGTH = 200;
const BRAND_MAX_LENGTH = 120;
const HSN_CODE_MAX_LENGTH = 8;
const COUNTRY_OF_ORIGIN_MAX_LENGTH = 2;
const NET_QUANTITY_MAX_LENGTH = 40;

/** Whatever a product's category attribute definitions allow (SDD 6.1's JSONB principle). */
export type ProductAttributeValues = Readonly<Record<string, unknown>>;

/**
 * The moderation lifecycle (SDD 15.2). Only `DRAFT` is reachable in S2-3a —
 * see `ProductStatus` in `schema.prisma` for why the remaining states are not
 * declared anywhere yet.
 */
export type ProductStatusName = 'DRAFT';

export interface ProductProps {
  readonly id: ProductId;
  readonly vendorId: VendorId;
  readonly categoryId: CategoryId;
  readonly name: string;
  readonly brand: string | null;
  readonly description: string | null;
  readonly hsnCode: string | null;
  readonly countryOfOrigin: string | null;
  readonly netQuantity: string | null;
  readonly attributeValues: ProductAttributeValues;
  readonly status: ProductStatusName;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

const assertWithinLength = (field: string, value: string | null, max: number): void => {
  if (value !== null && value.length > max) {
    throw new InvalidProductOperationError(field, `Must be at most ${max} characters.`);
  }
};

const assertNotBlank = (field: string, value: string): void => {
  if (value.trim().length === 0) {
    throw new InvalidProductOperationError(field, 'Must not be blank.');
  }
};

/**
 * The fields a vendor may edit after creation (S2-3b).
 *
 * `id`, `vendorId`, `status` and the timestamps are absent by construction:
 * ownership and lifecycle are not editable, and `status` moves only through
 * the moderation flow that does not exist yet.
 */
export interface ProductDetailChanges {
  readonly categoryId?: CategoryId | undefined;
  readonly name?: string | undefined;
  readonly brand?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly hsnCode?: string | null | undefined;
  readonly countryOfOrigin?: string | null | undefined;
  readonly netQuantity?: string | null | undefined;
  readonly attributeValues?: ProductAttributeValues | undefined;
}

/** Trims, then runs the same shape checks `create` does, so both paths agree. */
const normalisedDetails = (props: {
  name: string;
  brand: string | null;
  hsnCode: string | null;
  countryOfOrigin: string | null;
  netQuantity: string | null;
}): {
  name: string;
  brand: string | null;
  hsnCode: string | null;
  countryOfOrigin: string | null;
  netQuantity: string | null;
} => {
  const name = props.name.trim();
  assertNotBlank('name', name);
  assertWithinLength('name', name, NAME_MAX_LENGTH);

  const brand = props.brand?.trim() ?? null;
  assertWithinLength('brand', brand, BRAND_MAX_LENGTH);

  const hsnCode = props.hsnCode?.trim() ?? null;
  assertWithinLength('hsnCode', hsnCode, HSN_CODE_MAX_LENGTH);

  const countryOfOrigin = props.countryOfOrigin?.trim() ?? null;
  assertWithinLength('countryOfOrigin', countryOfOrigin, COUNTRY_OF_ORIGIN_MAX_LENGTH);

  const netQuantity = props.netQuantity?.trim() ?? null;
  assertWithinLength('netQuantity', netQuantity, NET_QUANTITY_MAX_LENGTH);

  return { name, brand, hsnCode, countryOfOrigin, netQuantity };
};

/**
 * The marketing entity (SDD 5 module 4, SDD 6.3). Vendor-owned and
 * tenant-scoped — unlike `Category`, which is platform-owned.
 *
 * **Starts, and in S2-3a stays, in `DRAFT`.** No method here transitions
 * `status`; the moderation state machine (SDD 15.2) is a later chunk, and
 * this entity does not anticipate it.
 *
 * `hsnCode`/`countryOfOrigin`/`netQuantity` are validated for shape only
 * (length, non-blank-if-present) — never against the category's
 * `requirements` flags. Whether they are *required* for this product's
 * category is the product submission flow's question to ask, and that flow
 * does not exist yet (S2-3 D-2).
 *
 * Carries no reference to its variants: `ProductVariant` is a sibling
 * aggregate reached through `ProductVariantRepository`, the same separation
 * `Category`/`CategoryAttribute` already established. The invariant "every
 * product has at least one variant" is enforced by `CreateProductUseCase`
 * creating both in one transaction (S2-3 D-7), not by this class holding a
 * variant collection it would then have no way to keep in sync with the
 * database.
 */
export class Product {
  private constructor(private readonly props: ProductProps) {}

  static create(props: {
    id: ProductId;
    vendorId: VendorId;
    categoryId: CategoryId;
    name: string;
    brand: string | null;
    description: string | null;
    hsnCode: string | null;
    countryOfOrigin: string | null;
    netQuantity: string | null;
    attributeValues: ProductAttributeValues;
    now: Date;
  }): Product {
    return new Product({
      id: props.id,
      vendorId: props.vendorId,
      categoryId: props.categoryId,
      ...normalisedDetails(props),
      description: props.description,
      attributeValues: props.attributeValues,
      status: 'DRAFT',
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: ProductProps): Product {
    return new Product(props);
  }

  get id(): ProductId {
    return this.props.id;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get categoryId(): CategoryId {
    return this.props.categoryId;
  }

  get name(): string {
    return this.props.name;
  }

  get brand(): string | null {
    return this.props.brand;
  }

  get description(): string | null {
    return this.props.description;
  }

  get hsnCode(): string | null {
    return this.props.hsnCode;
  }

  get countryOfOrigin(): string | null {
    return this.props.countryOfOrigin;
  }

  get netQuantity(): string | null {
    return this.props.netQuantity;
  }

  get attributeValues(): ProductAttributeValues {
    return this.props.attributeValues;
  }

  get status(): ProductStatusName {
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
   * A partial edit (S2-3b). Only the supplied fields change; every one of
   * them goes through the same trimming and shape checks `create` applies, so
   * an edit cannot land a value creation would have refused.
   *
   * `status` is not among them and has no mutator anywhere on this class —
   * the moderation flow that moves it does not exist yet, and a setter added
   * "for later" is a setter something will call early.
   */
  updateDetails(changes: ProductDetailChanges, now: Date): Product {
    this.assertLive('updateDetails');

    return new Product({
      ...this.props,
      categoryId: changes.categoryId ?? this.props.categoryId,
      ...normalisedDetails({
        name: changes.name ?? this.props.name,
        brand: changes.brand === undefined ? this.props.brand : changes.brand,
        hsnCode: changes.hsnCode === undefined ? this.props.hsnCode : changes.hsnCode,
        countryOfOrigin:
          changes.countryOfOrigin === undefined
            ? this.props.countryOfOrigin
            : changes.countryOfOrigin,
        netQuantity:
          changes.netQuantity === undefined ? this.props.netQuantity : changes.netQuantity,
      }),
      description: changes.description === undefined ? this.props.description : changes.description,
      attributeValues: changes.attributeValues ?? this.props.attributeValues,
      updatedAt: now,
    });
  }

  /**
   * Soft delete (SDD 6.1). Whether the product's variants go with it is not
   * decided here — that is a question about other rows, which
   * `DeleteProductUseCase` settles inside one transaction, the same division
   * `Category`/`CategoryAttribute` already established.
   */
  softDelete(now: Date): Product {
    this.assertLive('deletedAt');
    return new Product({ ...this.props, deletedAt: now, updatedAt: now });
  }

  private assertLive(field: string): void {
    if (this.isDeleted) {
      throw new InvalidProductOperationError(field, 'This product has been deleted.');
    }
  }
}
