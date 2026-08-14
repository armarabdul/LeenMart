import type { VendorId } from '../../../identity/index.js';
import { InvalidProductOperationError } from '../errors/catalogue-errors.js';
import type { CategoryId } from '../value-objects/category-id.value-object.js';
import type { ProductId } from '../value-objects/product-id.value-object.js';
import type { ProductRejectionReason } from '../value-objects/product-rejection-reason.value-object.js';

const NAME_MAX_LENGTH = 200;
const BRAND_MAX_LENGTH = 120;
const HSN_CODE_MAX_LENGTH = 8;
const COUNTRY_OF_ORIGIN_MAX_LENGTH = 2;
const NET_QUANTITY_MAX_LENGTH = 40;
const REJECTION_NOTE_MAX_LENGTH = 1000;

/** Whatever a product's category attribute definitions allow (SDD 6.1's JSONB principle). */
export type ProductAttributeValues = Readonly<Record<string, unknown>>;

/**
 * The moderation lifecycle (SDD 15.2), as far as S2-5/S2-6a/S2-8 build it:
 * `DRAFT ─► PENDING_REVIEW ─► APPROVED` and `PENDING_REVIEW ─► REJECTED ─►
 * (edit, resubmit) ─► PENDING_REVIEW`, plus `APPROVED ─► PENDING_REVIEW` on a
 * media change (ASM-14, S2-6a D-S2-6-L) or a name/category/brand edit
 * (ASM-14, S2-8). `PUBLISHED`/`UNPUBLISHED`/`DELISTED` are not declared — see
 * `ProductStatus` in `schema.prisma` for why.
 */
export type ProductStatusName = 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

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
  /** Set together, and only while `status` is `REJECTED` — see `reject()`. */
  readonly rejectionReason: ProductRejectionReason | null;
  readonly rejectionNote: string | null;
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
 *
 * **The moderation transitions this class enforces (S2-5) are legality only.**
 * `submitForReview`/`approve`/`reject` refuse a status their current state
 * forbids, the same way `assertLive` already refuses an edit to a deleted
 * product — but none of them is the arbiter of a race between two callers who
 * both loaded a legal state. That arbitration is
 * `ProductRepository.submitForReviewIfEligible`/`decideIfPendingReview`'s job,
 * a conditional database write, mirroring `VendorKyc`'s
 * `startReview`/`claimForReviewIfUnclaimed` split exactly.
 *
 * **No separate draft/published version.** SDD 15.2 draws one for an already
 * *published* product ("a published version and a draft version are tracked
 * separately so a pending edit never takes a live listing down") — S2-5 never
 * reaches `PUBLISHED`, so there is nothing yet for a second version to
 * protect. One row, one status.
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
      rejectionReason: null,
      rejectionNote: null,
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

  get rejectionReason(): ProductRejectionReason | null {
    return this.props.rejectionReason;
  }

  get rejectionNote(): string | null {
    return this.props.rejectionNote;
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

  /**
   * A vendor asks for their product to be reviewed (S2-5). Reachable from
   * `DRAFT` on a first attempt and from `REJECTED` on a resubmission — both
   * are the same act, and SDD 15.2's diagram draws exactly those two arrows
   * into `PENDING_REVIEW`.
   *
   * **Mandatory-field completeness (BR-15/BR-21) is not checked here.**
   * Whether HSN/country of origin/net quantity are required is a question
   * about this product's *category*, which this aggregate holds only an id
   * for — `SubmitProductForReviewUseCase` reads the category and refuses the
   * request before ever calling this method, the same division `S2-3 D-2`
   * always intended.
   *
   * Clears any prior rejection: a fresh review cycle does not carry the
   * verdict on the attempt before it.
   */
  submitForReview(now: Date): Product {
    this.assertLive('submitForReview');
    if (this.props.status !== 'DRAFT' && this.props.status !== 'REJECTED') {
      throw new InvalidProductOperationError(
        'submitForReview',
        `A product in ${this.props.status} cannot be submitted for review.`,
      );
    }
    return new Product({
      ...this.props,
      status: 'PENDING_REVIEW',
      rejectionReason: null,
      rejectionNote: null,
      updatedAt: now,
    });
  }

  /** An administrator approves the submission (SDD 15.2). Reachable only from `PENDING_REVIEW`. */
  approve(now: Date): Product {
    this.assertLive('approve');
    this.assertPendingReview('approve');
    return new Product({
      ...this.props,
      status: 'APPROVED',
      rejectionReason: null,
      rejectionNote: null,
      updatedAt: now,
    });
  }

  /**
   * An administrator refuses the submission with a structured reason and
   * **optional** free text (SDD 15.2, verbatim: "always carries a structured
   * reason code plus optional free text"). Reachable only from
   * `PENDING_REVIEW`.
   *
   * `reason` is required — the one thing SDD 15.2 does not make optional.
   * `note` may be omitted (`null`); when supplied it is trimmed and must be
   * non-blank and within `REJECTION_NOTE_MAX_LENGTH` — a caller that *chose*
   * to write something is still held to the same shape rules as any other
   * free-text field, but choosing to write nothing at all is legitimate.
   */
  reject(reason: ProductRejectionReason, note: string | null, now: Date): Product {
    this.assertLive('reject');
    this.assertPendingReview('reject');
    const trimmed = note?.trim() ?? null;
    if (trimmed === '') {
      throw new InvalidProductOperationError(
        'reject',
        'A rejection note, if supplied, must not be blank.',
      );
    }
    assertWithinLength('rejectionNote', trimmed, REJECTION_NOTE_MAX_LENGTH);
    return new Product({
      ...this.props,
      status: 'REJECTED',
      rejectionReason: reason,
      rejectionNote: trimmed,
      updatedAt: now,
    });
  }

  /**
   * The trust hole ASM-14 exists to close (SDD 15.2, S2-6a D-S2-6-L):
   * "editing an approved product... Title, images, category, brand,
   * restricted attributes | Re-enters PENDING_REVIEW". S2-6a wires only the
   * *images* row of that table; S2-8 adds the title/category/brand row via
   * `reenterReviewForDetailChange` below. Restricted attributes, the price
   * band, and the `NEW`-tier-vendor row remain deferred.
   *
   * Reachable only from `APPROVED`. Distinct from `submitForReview` on
   * purpose: this is a **system-triggered** side effect of a vendor's media
   * change, never a vendor action in its own right, so it does not accept
   * `DRAFT`/`REJECTED` the way `submitForReview` does, and there is no HTTP
   * route that calls it directly — `CompleteProductMediaUploadUseCase`/
   * `RemoveProductMediaUseCase` call it internally, atomically, in the same
   * transaction as the media write.
   *
   * Clears nothing that isn't already null: `APPROVED` never carries a
   * rejection, so there is nothing here for `submitForReview`'s "clears any
   * prior rejection" comment to apply to.
   */
  reenterReviewForMediaChange(now: Date): Product {
    this.assertLive('reenterReviewForMediaChange');
    if (this.props.status !== 'APPROVED') {
      throw new InvalidProductOperationError(
        'reenterReviewForMediaChange',
        `A product in ${this.props.status} cannot be returned to review this way; it must be APPROVED.`,
      );
    }
    return new Product({ ...this.props, status: 'PENDING_REVIEW', updatedAt: now });
  }

  /**
   * ASM-14's detail-edit trigger (SDD 15.2, S2-8): the name/title, category
   * or brand changed on an `APPROVED` product. Reachable only from
   * `APPROVED` — the identical shape `reenterReviewForMediaChange`
   * establishes for the media trigger; this is the same rule, a different
   * cause. Restricted attributes, the price band, and the `NEW`-tier-vendor
   * row are explicitly deferred (S2-8 decision) — this method exists for
   * exactly the three fields `UpdateProductUseCase` checks and no others.
   *
   * Called on the *already field-updated* product (the result of
   * `updateDetails`), never on the pre-edit one — the returned instance
   * carries both the new field values and the new status, so one repository
   * call persists both.
   */
  reenterReviewForDetailChange(now: Date): Product {
    this.assertLive('reenterReviewForDetailChange');
    if (this.props.status !== 'APPROVED') {
      throw new InvalidProductOperationError(
        'reenterReviewForDetailChange',
        `A product in ${this.props.status} cannot be returned to review this way; it must be APPROVED.`,
      );
    }
    return new Product({ ...this.props, status: 'PENDING_REVIEW', updatedAt: now });
  }

  private assertPendingReview(operation: string): void {
    if (this.props.status !== 'PENDING_REVIEW') {
      throw new InvalidProductOperationError(
        operation,
        `A product in ${this.props.status} cannot be decided; it must be in PENDING_REVIEW.`,
      );
    }
  }

  private assertLive(field: string): void {
    if (this.isDeleted) {
      throw new InvalidProductOperationError(field, 'This product has been deleted.');
    }
  }
}
