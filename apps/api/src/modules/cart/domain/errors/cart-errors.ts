import {
  type AppErrorOptions,
  ConflictError,
  DomainRuleError,
  NotFoundError,
} from '@leen-mart/domain-kit';

/**
 * Covers both "this item never existed" and "it exists but belongs to
 * someone else's cart" — identically, on purpose. Mirrors SDD 6.6's
 * cross-tenant testing convention (`AddressNotFoundError`'s own reasoning):
 * a caller learning that *an* item exists at a given id, just not in their
 * cart, is exactly the kind of resource-existence leak ownership scoping
 * exists to prevent.
 */
export class CartItemNotFoundError extends NotFoundError {
  constructor(options: AppErrorOptions = {}) {
    super('This cart item does not exist.', { ...options, code: 'CART_ITEM_NOT_FOUND' });
  }
}

/**
 * The requested variant does not exist, as far as this caller is concerned —
 * covers "never existed", "soft-deleted" and "belongs to a product that
 * isn't `APPROVED`" identically. All three read as absent because the check
 * runs entirely through the `leenmart_public` RLS policies (added in
 * `20260814160000_add_cart`): a `findById` returning non-null on
 * `publicPrisma` **is** the eligibility proof, so there is nothing further
 * for this error to distinguish.
 */
export class ProductNotEligibleForCartError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super('PRODUCT_NOT_ELIGIBLE_FOR_CART', 'This product is not available to add to a cart.', {
      ...options,
      details: [{ field: 'variantId', issue: 'No eligible variant exists at this id.' }],
    });
  }
}

/**
 * The quantity requested (added to whatever is already in the cart for this
 * variant, for an add) exceeds `Inventory.available`. A best-effort,
 * read-only check — S3-1 does not reserve or decrement stock (SDD 14.4's
 * atomic decrement is Stage 3's later checkout slice), so this can still be
 * stale by the time checkout runs its own re-check.
 */
export class InsufficientInventoryError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super('INSUFFICIENT_INVENTORY', 'The requested quantity is not available.', {
      ...options,
      details: [{ field: 'quantity', issue: 'Requested quantity exceeds available stock.' }],
    });
  }
}

/**
 * Not a positive integer, or not a whole multiple of the variant's own
 * `quantityStep` (e.g. "250 g steps") — an existing, non-invented constraint
 * already carried on `ProductVariant`, not a new business rule.
 */
export class InvalidCartQuantityError extends DomainRuleError {
  constructor(issue: string, options: AppErrorOptions = {}) {
    super('INVALID_CART_QUANTITY', 'This quantity is not valid for this item.', {
      ...options,
      details: [{ field: 'quantity', issue }],
    });
  }
}

/**
 * Thrown when a conditional cart-item write (`updateQuantityIfOwned`) or the
 * cart's own `upsertForUser` loses a race — "database decides who wins", the
 * same pattern `AddressDefaultConflictError`/`ProductSubmissionConflictError`
 * already establish elsewhere in this codebase.
 */
export class CartWriteConflictError extends ConflictError {
  constructor(options: AppErrorOptions = {}) {
    super('This cart changed concurrently. Please reload and try again.', {
      ...options,
      code: 'CART_WRITE_CONFLICT',
    });
  }
}
