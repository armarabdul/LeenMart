/**
 * The catalogue module's audit vocabulary (SDD 18.4 — the immutable admin
 * action log), following the same dotted, bounded-context-scoped convention
 * `identity/domain/audit-actions.ts` and `vendor/domain/audit-actions.ts`
 * established.
 *
 * Only the five taxonomy actions this chunk actually writes are listed.
 * Category *reads* — the admin list and detail, and the whole public tree —
 * are not here and will not be: SDD 18.4 logs admin actions, and reading a
 * taxonomy changes nothing. That is the same line KYC-6 drew for the review
 * queue, for the same reason.
 *
 * Attribute actions (S2-2b) are absent until the code that writes them exists;
 * an unused constant here would be a guess about a feature that does not exist
 * yet.
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
  /** A category was soft-deleted. */
  CATEGORY_DELETED: 'catalogue.category.deleted',
} as const;

export type CatalogueAuditAction =
  (typeof CATALOGUE_AUDIT_ACTIONS)[keyof typeof CATALOGUE_AUDIT_ACTIONS];

/**
 * Stable domain entity names, not table names — see
 * `IDENTITY_AUDIT_ENTITY_TYPES` for why. Every action above is recorded
 * against the category itself: that is the entity whose configuration or
 * position in the tree the action changed.
 */
export const CATALOGUE_AUDIT_ENTITY_TYPES = {
  CATEGORY: 'Category',
} as const;

export type CatalogueAuditEntityType =
  (typeof CATALOGUE_AUDIT_ENTITY_TYPES)[keyof typeof CATALOGUE_AUDIT_ENTITY_TYPES];
