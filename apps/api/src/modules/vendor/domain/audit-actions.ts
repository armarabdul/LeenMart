/**
 * The audit vocabulary for this bounded context (SDD 18.4's `action` and
 * `entityType`), following the same dotted, bounded-context-scoped
 * convention `identity/domain/audit-actions.ts` established.
 *
 * Only the four completed KYC lifecycle actions this chunk actually writes
 * are listed (KYC-6: submission, review claim, approval, rejection). Upload
 * intents, queue reads, and document access are not lifecycle events in this
 * sense and belong to other chunks — an unused constant here would be a
 * guess about a feature that does not exist yet.
 */
export const VENDOR_AUDIT_ACTIONS = {
  /** A vendor's KYC documents and identifiers were submitted for review. */
  KYC_SUBMITTED: 'vendor.kyc.submitted',
  /** An administrator claimed an unclaimed submission for review. */
  KYC_REVIEW_STARTED: 'vendor.kyc.review.started',
  /** An administrator approved a claimed submission. */
  KYC_APPROVED: 'vendor.kyc.approved',
  /** An administrator rejected a claimed submission. */
  KYC_REJECTED: 'vendor.kyc.rejected',
} as const;

export type VendorAuditAction = (typeof VENDOR_AUDIT_ACTIONS)[keyof typeof VENDOR_AUDIT_ACTIONS];

/**
 * Stable domain entity names, not table names — see
 * `IDENTITY_AUDIT_ENTITY_TYPES` for why. All four actions above are recorded
 * against the KYC submission itself, not the vendor: that is the aggregate
 * whose lifecycle the action changes.
 */
export const VENDOR_AUDIT_ENTITY_TYPES = {
  KYC: 'VendorKyc',
} as const;

export type VendorAuditEntityType =
  (typeof VENDOR_AUDIT_ENTITY_TYPES)[keyof typeof VENDOR_AUDIT_ENTITY_TYPES];
