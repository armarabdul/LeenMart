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
