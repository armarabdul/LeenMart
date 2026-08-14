import {
  type AppErrorOptions,
  ConflictError,
  DomainRuleError,
  NotFoundError,
} from '@leen-mart/domain-kit';

/**
 * No category exists with the requested id or slug.
 *
 * Covers "never existed", "soft-deleted" and "you asked by slug and got
 * nothing" identically. Categories are platform-owned rather than tenant-owned
 * so there is no cross-tenant leak to worry about here, but the uniform answer
 * still matters: a distinguishable "this was deleted" would let anyone
 * enumerate the taxonomy's history from the public surface.
 */
export class CategoryNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('This category does not exist.', { ...options, code: 'CATEGORY_NOT_FOUND' });
  }
}

/**
 * Another live category already holds this slug.
 *
 * The arbiter is `idx_categories_slug_unique`, not a read-then-write check —
 * the same "database decides who wins" pattern `AddressDefaultConflictError`
 * and `consumeIfActive` established. A pre-check would still lose a race with
 * a concurrent create.
 */
export class CategorySlugConflictError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('A category with this slug already exists.', {
      ...options,
      code: 'CATEGORY_SLUG_CONFLICT',
    });
  }
}

/**
 * A sibling already carries this name.
 *
 * Scoped to siblings, not global: "Accessories" under Electronics and
 * "Accessories" under Apparel are different categories and both are
 * legitimate. Arbitrated by `idx_categories_child_name_unique` and
 * `idx_categories_root_name_unique`.
 */
export class CategoryNameConflictError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('A sibling category with this name already exists.', {
      ...options,
      code: 'CATEGORY_NAME_CONFLICT',
    });
  }
}

/**
 * Deletion refused because the category still has live children.
 *
 * There is deliberately no cascade. Deleting a branch of the taxonomy by
 * deleting its root would remove categories an admin never looked at, and —
 * once products exist — orphan every listing beneath them. The admin must
 * empty the branch deliberately, one level at a time.
 *
 * The category's own attributes are *not* what this refers to: those belong to
 * it and are soft-deleted alongside it in the same transaction.
 */
export class CategoryNotEmptyError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This category still has subcategories and cannot be deleted.', {
      ...options,
      code: 'CATEGORY_NOT_EMPTY',
    });
  }
}

/**
 * An operation asked of a category that its own shape forbids — nesting past
 * the depth ceiling, moving a category beneath itself, editing a deleted row.
 *
 * Mirrors `InvalidKycOperationError` exactly, including why the message is
 * uniform (SEC-15): what names the broken rule is `details[0]`, so a caller
 * learns which rule failed without the message itself becoming a place where
 * internal structure leaks.
 */
export class InvalidCategoryOperationError extends DomainRuleError {
  constructor(operation: string, issue: string, options: AppErrorOptions = {}) {
    super('INVALID_CATEGORY_OPERATION', 'This action is not permitted for this category.', {
      ...options,
      details: [{ field: operation, issue }],
    });
  }
}

/**
 * No attribute exists with the requested id under the requested category.
 *
 * Mirrors `CategoryNotFoundError`, including why it draws no distinction
 * between "never existed", "was deleted" and "belongs to a different
 * category" — the same reasoning as `KycDocumentNotFoundError`, one level
 * deeper: an id that names another category's attribute must read as absent,
 * not as a hint that a valid id was supplied against the wrong parent.
 */
export class CategoryAttributeNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('This category attribute does not exist.', {
      ...options,
      code: 'CATEGORY_ATTRIBUTE_NOT_FOUND',
    });
  }
}

/**
 * The category already defines a live attribute with this key.
 *
 * Arbitrated by `idx_category_attributes_key_unique`, not by a read-then-write
 * check — the same "database decides who wins" pattern the rest of this module
 * uses, because a pre-check still loses to a concurrent create.
 *
 * Scoped per category: two categories may both define `weight`, and both are
 * legitimate.
 */
export class CategoryAttributeKeyConflictError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This category already defines an attribute with that key.', {
      ...options,
      code: 'CATEGORY_ATTRIBUTE_KEY_CONFLICT',
    });
  }
}

/**
 * An operation an attribute's own shape forbids — options on a non-ENUM, a
 * unit on a non-NUMBER, a negative position, editing a deleted definition.
 *
 * Mirrors `InvalidCategoryOperationError` exactly, including the uniform
 * message (SEC-15): what names the broken rule is `details[0]`.
 */
export class InvalidCategoryAttributeOperationError extends DomainRuleError {
  constructor(operation: string, issue: string, options: AppErrorOptions = {}) {
    super(
      'INVALID_CATEGORY_ATTRIBUTE_OPERATION',
      'This action is not permitted for this category attribute.',
      { ...options, details: [{ field: operation, issue }] },
    );
  }
}

/**
 * Another live variant of this vendor's already holds this SKU.
 *
 * Arbitrated by `uq_product_variants_vendor_sku`, not by a read-then-write
 * check — the same "database decides who wins" pattern every other catalogue
 * conflict error uses, because a pre-check still loses to a concurrent
 * create.
 *
 * Scoped per vendor (S2-3 D-5): two different vendors may both use `SKU-001`,
 * and both are legitimate.
 */
export class ProductVariantSkuConflictError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This vendor already has a variant with that SKU.', {
      ...options,
      code: 'PRODUCT_VARIANT_SKU_CONFLICT',
    });
  }
}

/**
 * An operation a product or variant's own shape forbids — a blank name, a
 * statutory field or SKU or unit of measure longer than its column, a
 * non-positive price or quantity step.
 *
 * Mirrors `InvalidCategoryOperationError` exactly, including the uniform
 * message (SEC-15): what names the broken rule is `details[0]`.
 */
export class InvalidProductOperationError extends DomainRuleError {
  constructor(operation: string, issue: string, options: AppErrorOptions = {}) {
    super('INVALID_PRODUCT_OPERATION', 'This action is not permitted for this product.', {
      ...options,
      details: [{ field: operation, issue }],
    });
  }
}

/**
 * No product exists with the requested id, as far as this caller is
 * concerned.
 *
 * Covers "never existed", "soft-deleted" and **"belongs to another vendor"**
 * identically, and that third case is the one that matters: a vendor learning
 * that *a* product exists at an id, just not theirs, is exactly the
 * cross-tenant existence leak SDD 6.6 exists to prevent. The repository
 * returns `null` for all three because RLS and the tenant context make them
 * indistinguishable there too — this error simply does not undo that.
 */
export class ProductNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('This product does not exist.', { ...options, code: 'PRODUCT_NOT_FOUND' });
  }
}

/**
 * No variant exists with the requested id under the requested product.
 *
 * Mirrors `ProductNotFoundError`, and adds one more case that must read the
 * same way: a variant id that is real but belongs to a *different product* of
 * the same vendor. The same reasoning `KycDocumentNotFoundError` records one
 * level deeper.
 */
export class ProductVariantNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('This product variant does not exist.', {
      ...options,
      code: 'PRODUCT_VARIANT_NOT_FOUND',
    });
  }
}

/**
 * Refused: this is the product's last live variant.
 *
 * SDD 6.3 makes the variant the sellable unit and states that every product
 * has at least one. `CreateProductUseCase` is what makes that true at the
 * start (S2-3 D-7); this is what keeps it true — a product stripped of its
 * last variant is a listing nobody can buy, which is worse than a deleted one
 * because it still appears to exist.
 *
 * Arbitrated against the database under a lock on the parent product row,
 * never by a read-then-delete check: two concurrent deletes would otherwise
 * both observe two live variants and both proceed.
 */
export class ProductLastVariantError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('A product must keep at least one variant.', {
      ...options,
      code: 'PRODUCT_LAST_VARIANT',
    });
  }
}

/**
 * No inventory row exists for the requested variant, as far as this caller is
 * concerned.
 *
 * Covers "the variant does not exist", "it belongs to another vendor" and
 * "it hangs off a different product" identically — the same non-disclosure
 * `ProductVariantNotFoundError` records, for the same reason.
 *
 * A variant that exists but has no counter is *not* one of the cases: every
 * variant is created with one, in the same transaction (S2-4 D-E). Reaching
 * this error that way would mean the invariant had already been broken.
 */
export class InventoryNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('No inventory exists for this variant.', {
      ...options,
      code: 'INVENTORY_NOT_FOUND',
    });
  }
}

/**
 * The stock level moved between the vendor reading it and writing it back.
 *
 * The `version` a `PATCH` carries is what makes this detectable: the
 * conditional write matches on it, and a stale one affects zero rows. Without
 * it two vendor staff editing the same variant would silently overwrite each
 * other and the last writer would win — which for a stock figure means
 * quietly wrong numbers rather than a visible failure.
 *
 * Distinct from `InventoryNotFoundError` on purpose: the row is real and the
 * caller may reach it, so re-reading and retrying is the correct response.
 */
export class InventoryVersionConflictError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This stock level was changed by someone else. Please reload and try again.', {
      ...options,
      code: 'INVENTORY_VERSION_CONFLICT',
    });
  }
}

/**
 * A stock figure that is not a whole number of zero or more.
 *
 * Mirrors `InvalidProductOperationError`, including the uniform message
 * (SEC-15): what names the broken rule is `details[0]`. The database says the
 * same thing in `chk_inventory_available_non_negative`, which is the copy that
 * survives an application bug (SDD 14.4).
 */
export class InvalidInventoryOperationError extends DomainRuleError {
  constructor(operation: string, issue: string, options: AppErrorOptions = {}) {
    super('INVALID_INVENTORY_OPERATION', 'This action is not permitted for this inventory.', {
      ...options,
      details: [{ field: operation, issue }],
    });
  }
}

/**
 * A submission for review (S2-5) is missing a field its category requires —
 * SDD 15.2's mandatory-field completeness pre-screen (HSN, country of origin,
 * net quantity — BR-15/BR-21), made category-conditional by
 * `CategoryRequirements`.
 *
 * A `DomainRuleError` rather than a validation failure, mirroring
 * `IncompleteKycSubmissionError`: every individual field was well-formed
 * shape-wise when the product was created or edited, and it is only *this
 * category's* requirements that make the gap a problem — a `DRAFT` may carry
 * exactly the same gap indefinitely (S2-3 D-2).
 */
export class IncompleteProductSubmissionError extends DomainRuleError {
  constructor(issue: string, options: AppErrorOptions = {}) {
    super('INCOMPLETE_PRODUCT_SUBMISSION', 'This product is not ready for review.', {
      ...options,
      details: [{ field: 'mandatoryFields', issue }],
    });
  }
}

/**
 * The product's moderation status changed underneath a vendor's submit
 * attempt, between the read and the conditional write.
 *
 * Distinct from `InvalidProductOperationError`, which `Product.submitForReview`
 * raises when the *loaded* status already forbids submission — this is the
 * race the aggregate cannot see: two concurrent submissions both loaded an
 * eligible `DRAFT`/`REJECTED` row, and only one conditional update could win.
 * Mirrors `KycAlreadyDecidedError`'s reasoning exactly, one transition
 * earlier.
 */
export class ProductSubmissionConflictError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This product cannot be submitted for review right now. Please reload and try again.', {
      ...options,
      code: 'PRODUCT_SUBMISSION_CONFLICT',
    });
  }
}

/**
 * The product was already decided by another administrator between this
 * reviewer loading it and deciding it.
 *
 * Mirrors `KycAlreadyDecidedError` exactly: `Product.approve`/`Product.reject`
 * catch the ordinary case where the loaded status already forbids a decision;
 * this is the race they cannot see, arbitrated by
 * `ProductRepository.decideIfPendingReview`'s conditional write. There is
 * deliberately no claim step ahead of it (S2-5 D-5-D) — the decision itself is
 * the only thing conditional writes need to arbitrate.
 */
export class ProductAlreadyDecidedError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This product has already been decided.', {
      ...options,
      code: 'PRODUCT_ALREADY_DECIDED',
    });
  }
}

/**
 * An operation a media item's own shape forbids — a blank object key or
 * content type, a non-positive size, completing or deleting an already-
 * deleted item, or completing an item that is not `AWAITING_UPLOAD`.
 *
 * Mirrors `InvalidProductOperationError` exactly, including the uniform
 * message (SEC-15): what names the broken rule is `details[0]`.
 */
export class InvalidProductMediaOperationError extends DomainRuleError {
  constructor(operation: string, issue: string, options: AppErrorOptions = {}) {
    super('INVALID_PRODUCT_MEDIA_OPERATION', 'This action is not permitted for this media item.', {
      ...options,
      details: [{ field: operation, issue }],
    });
  }
}

/**
 * No media item exists with the requested id under the requested product, as
 * far as this caller is concerned.
 *
 * Mirrors `ProductVariantNotFoundError` exactly, including why it draws no
 * distinction between "never existed", "was deleted" and "belongs to a
 * different product (even one of the same vendor's)" — the same
 * cross-tenant-existence-leak reasoning `ProductNotFoundError` gives, one
 * level deeper.
 */
export class ProductMediaNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('This product media item does not exist.', {
      ...options,
      code: 'PRODUCT_MEDIA_NOT_FOUND',
    });
  }
}

/**
 * The product already has `MAX_IMAGES_PER_PRODUCT` live media items.
 *
 * Arbitrated under `ProductRepository.lockForMediaChange`'s exclusive row
 * lock, never by a read-then-write count check on its own — the same
 * "the parent row is the serialisation point" reasoning
 * `ProductLastVariantError`/`lockForVariantChange` already establish, one
 * invariant over: two concurrent uploads that each count seven live items
 * and each proceed would leave nine.
 */
export class ProductMediaLimitExceededError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This product already has the maximum number of media items allowed.', {
      ...options,
      code: 'PRODUCT_MEDIA_LIMIT_EXCEEDED',
    });
  }
}

/**
 * The media item's upload could not be completed because its status changed
 * underneath this call, between the read and the conditional write.
 *
 * Distinct from `InvalidProductMediaOperationError`, which
 * `ProductMedia.completeUpload` raises when the *loaded* status already
 * forbids completion — this is the race the aggregate cannot see, arbitrated
 * by `ProductMediaRepository.completeIfAwaitingUpload`'s conditional write.
 * Mirrors `ProductSubmissionConflictError`'s reasoning exactly, one aggregate
 * over.
 */
export class ProductMediaUploadConflictError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This media item cannot be completed right now. Please reload and try again.', {
      ...options,
      code: 'PRODUCT_MEDIA_UPLOAD_CONFLICT',
    });
  }
}

/**
 * The object this media row names is not there, or is not what the presigned
 * URL promised — the file was never uploaded, or a different one landed.
 *
 * Mirrors `IncompleteKycSubmissionError`/`SubmitVendorKycUseCase`'s own
 * `documentSetError` exactly: `CompleteProductMediaUploadUseCase` never
 * trusts a client's claim that an upload succeeded — it verifies with
 * `ObjectStore.head()` and compares the answer to what this row already
 * records, the same discipline that use case applies to each KYC document.
 */
export class IncompleteProductMediaUploadError extends DomainRuleError {
  constructor(issue: string, options: AppErrorOptions = {}) {
    super('INCOMPLETE_PRODUCT_MEDIA_UPLOAD', 'This media upload is not complete.', {
      ...options,
      details: [{ field: 'upload', issue }],
    });
  }
}
