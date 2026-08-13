/**
 * The catalogue module's audit vocabulary (SDD 18.4 — the immutable admin
 * action log), following the same dotted, bounded-context-scoped convention
 * `identity/domain/audit-actions.ts` and `vendor/domain/audit-actions.ts`
 * established.
 *
 * Only the actions this module actually writes are listed. Category and
 * attribute *reads* — the admin list and detail, and the whole public tree —
 * are not here and will not be: SDD 18.4 logs admin actions, and reading a
 * taxonomy changes nothing. That is the same line KYC-6 drew for the review
 * queue, for the same reason.
 */
export const CATALOGUE_AUDIT_ACTIONS = {
  /** A new category was added to the taxonomy. */
  CATEGORY_CREATED: 'catalogue.category.created',
  /** A category's display name changed. */
  CATEGORY_RENAMED: 'catalogue.category.renamed',
  /** Risk level, statutory requirements or active flag changed. */
  CATEGORY_SETTINGS_UPDATED: 'catalogue.category.settings_updated',
  /** A category — and with it, its whole subtree — moved to a new parent. */
  CATEGORY_REPARENTED: 'catalogue.category.reparented',
  /** A category was soft-deleted, taking its own attribute definitions with it. */
  CATEGORY_DELETED: 'catalogue.category.deleted',
  /** An attribute definition was added to a category. */
  CATEGORY_ATTRIBUTE_ADDED: 'catalogue.category.attribute_added',
  /** An attribute definition's label, requiredness, position, unit or options changed. */
  CATEGORY_ATTRIBUTE_UPDATED: 'catalogue.category.attribute_updated',
  /** An attribute definition was soft-deleted on its own. */
  CATEGORY_ATTRIBUTE_REMOVED: 'catalogue.category.attribute_removed',
  /**
   * A vendor created a product, together with its first variant (S2-3 D-7 —
   * one atomic act, so one audit entry; the variant's own fields travel in
   * the payload rather than getting a second entry of their own).
   */
  PRODUCT_CREATED: 'catalogue.product.created',
  /** A vendor edited one of their own products. */
  PRODUCT_UPDATED: 'catalogue.product.updated',
  /** A vendor soft-deleted a product, taking its variants with it. */
  PRODUCT_DELETED: 'catalogue.product.deleted',
  /** A variant was added to an existing product. */
  PRODUCT_VARIANT_ADDED: 'catalogue.product.variant_added',
  /** A variant's name, price, unit of measure or quantity step changed. */
  PRODUCT_VARIANT_UPDATED: 'catalogue.product.variant_updated',
  /** A variant was soft-deleted on its own. */
  PRODUCT_VARIANT_REMOVED: 'catalogue.product.variant_removed',
} as const;

export type CatalogueAuditAction =
  (typeof CATALOGUE_AUDIT_ACTIONS)[keyof typeof CATALOGUE_AUDIT_ACTIONS];

/**
 * Stable domain entity names, not table names — see
 * `IDENTITY_AUDIT_ENTITY_TYPES` for why. Every action above is recorded
 * against the category itself, attribute actions included: the category is the
 * entity whose configuration changed, and recording attributes against it
 * keeps a category's whole configuration history reachable from one id. The
 * attribute's own id and key travel in the payload.
 *
 * `PRODUCT_CREATED` is recorded against the product, for the same reason —
 * one entity, one reachable history, with the first variant's fields in the
 * payload rather than a second entity type.
 */
export const CATALOGUE_AUDIT_ENTITY_TYPES = {
  CATEGORY: 'Category',
  PRODUCT: 'Product',
} as const;

export type CatalogueAuditEntityType =
  (typeof CATALOGUE_AUDIT_ENTITY_TYPES)[keyof typeof CATALOGUE_AUDIT_ENTITY_TYPES];
