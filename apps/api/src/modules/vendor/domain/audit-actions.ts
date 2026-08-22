/**
 * The audit vocabulary for this bounded context (SDD 18.4's `action` and
 * `entityType`), following the same dotted, bounded-context-scoped
 * convention `identity/domain/audit-actions.ts` established.
 *
 * Only actions this chunk actually writes are listed: the four KYC-6
 * lifecycle events (submission, review claim, approval, rejection) plus
 * KYC-7's document access — SDD 12.1/12.3 name "every KYC document access"
 * as its own mandatory audit write, distinct from a lifecycle transition —
 * plus S3-3A's activation and Phase L.4's suspension/reinstatement, the
 * `VendorProfile` aggregate's own lifecycle writes. Upload intents and
 * queue/detail reads remain unlisted: an upload intent commits nothing yet,
 * and a metadata read is an application-log event
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
  /**
   * An administrator activated a KYC-approved vendor (S3-3A, decision
   * D-S3-04) — the minimal application path `VendorProfile.activate()`
   * needed to ever have a caller.
   */
  ACTIVATED: 'vendor.activated',
  /**
   * An administrator suspended a vendor (SDD §15.1/§16.1, Phase L.4). Always
   * carries a `reason` — SDD §16.1 requires one for every suspension.
   */
  SUSPENDED: 'vendor.suspended',
  /** An administrator reinstated a suspended vendor (SDD §15.1, Phase L.4). */
  REINSTATED: 'vendor.reinstated',
} as const;

export type VendorAuditAction = (typeof VENDOR_AUDIT_ACTIONS)[keyof typeof VENDOR_AUDIT_ACTIONS];

/**
 * Stable domain entity names, not table names — see
 * `IDENTITY_AUDIT_ENTITY_TYPES` for why. The first five actions are recorded
 * against the KYC submission itself, not the vendor: that is the aggregate
 * whose lifecycle the action changes, or whose evidence a document access
 * discloses. `ACTIVATED` (S3-3A) is the first action recorded against the
 * vendor's own aggregate — there is no KYC row to attribute it to, since
 * activation is a `VendorProfile` transition, not a KYC decision.
 */
export const VENDOR_AUDIT_ENTITY_TYPES = {
  KYC: 'VendorKyc',
  VENDOR: 'VendorProfile',
} as const;

export type VendorAuditEntityType =
  (typeof VENDOR_AUDIT_ENTITY_TYPES)[keyof typeof VENDOR_AUDIT_ENTITY_TYPES];
