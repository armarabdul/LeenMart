/**
 * The domain events this module publishes to the transactional outbox
 * (S6-NOTIFY-LIFECYCLE, SDD 11.2's "KYC status" row).
 *
 * Separate constants from `VENDOR_AUDIT_ACTIONS` for the reason
 * `CATALOGUE_OUTBOX_EVENTS` gives at length: the audit actions have read
 * `vendor.kyc.approved`/`.rejected` since KYC-6 and are already written across
 * the audit history, while the published event names are
 * `kyc.approved`/`kyc.rejected`.
 *
 * Only the *decisions* are published. `KYC_SUBMITTED`, `KYC_REVIEW_STARTED`,
 * `KYC_DOCUMENT_ACCESSED` and `ACTIVATED` stay audit-only: SDD 11.2 gives a
 * row to "KYC status", which is the outcome the vendor is told about, and
 * publishing a reviewer's internal progress would tell a vendor when a human
 * opened their file.
 */
export const VENDOR_OUTBOX_EVENTS = {
  KYC_APPROVED: 'kyc.approved',
  KYC_REJECTED: 'kyc.rejected',
} as const;

export type VendorOutboxEvent = (typeof VENDOR_OUTBOX_EVENTS)[keyof typeof VENDOR_OUTBOX_EVENTS];
