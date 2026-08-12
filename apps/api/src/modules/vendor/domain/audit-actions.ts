/**
 * The audit vocabulary for this bounded context (SDD 18.4's `action` and
 * `entityType`), following the same dotted, bounded-context-scoped
 * convention `identity/domain/audit-actions.ts` established.
 *
 * Five actions this chunk actually writes are listed: the four KYC-6
 * lifecycle events (submission, review claim, approval, rejection) plus
 * KYC-7's document access — SDD 12.1/12.3 name "every KYC document access"
 * as its own mandatory audit write, distinct from a lifecycle transition.
 * Upload intents and queue/detail reads remain unlisted: an upload intent
 * commits nothing yet, and a metadata read is an application-log event
 * (`GetKycReviewSubmissionUseCase`'s own comment says so), not one of these —
 * an unused constant here would be a guess about a feature that does not
 * exist yet.
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
  /** An administrator was granted access to one uploaded document. */
  KYC_DOCUMENT_ACCESSED: 'vendor.kyc.document.accessed',
} as const;

export type VendorAuditAction = (typeof VENDOR_AUDIT_ACTIONS)[keyof typeof VENDOR_AUDIT_ACTIONS];

/**
 * Stable domain entity names, not table names — see
 * `IDENTITY_AUDIT_ENTITY_TYPES` for why. All five actions above are recorded
 * against the KYC submission itself, not the vendor: that is the aggregate
 * whose lifecycle the action changes, or whose evidence a document access
 * discloses.
 */
export const VENDOR_AUDIT_ENTITY_TYPES = {
  KYC: 'VendorKyc',
} as const;

export type VendorAuditEntityType =
  (typeof VENDOR_AUDIT_ENTITY_TYPES)[keyof typeof VENDOR_AUDIT_ENTITY_TYPES];
