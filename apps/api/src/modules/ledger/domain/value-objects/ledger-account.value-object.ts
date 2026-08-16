/**
 * SDD 10.3's chart of accounts. Every account the SDD names is declared, so
 * the taxonomy is complete and no future milestone has to widen this union —
 * but only the three in `REACHABLE_ACCOUNT_CODES` can actually receive a
 * posting in S3-7.
 */
export type LedgerAccountCode =
  | 'GATEWAY_CLEARING'
  | 'VENDOR_PAYABLE'
  | 'PLATFORM_COMMISSION_INCOME'
  | 'GST_OUTPUT'
  | 'TCS_PAYABLE'
  | 'TDS_PAYABLE'
  | 'REFUND_CLEARING'
  | 'HOLD_SUSPENSE'
  | 'VENDOR_RECEIVABLE_COD';

/**
 * The accounts a posting event exists for today. Everything outside this set
 * is provisioned-but-dormant, and deliberately so:
 *
 *   `GST_OUTPUT`/`TCS_PAYABLE`/`TDS_PAYABLE` — BR-13 (GST/TCS/TDS) is an
 *     unresolved P0 legal question. This repository holds no authoritative
 *     rate for GST-on-commission or TCS, and S3-7 refuses to invent one:
 *     a fabricated tax figure in an append-only accounting record is worse
 *     than an absent one.
 *   `REFUND_CLEARING` — refunds do not exist (BR-06 unresolved).
 *   `VENDOR_RECEIVABLE_COD` — COD does not exist.
 *   `HOLD_SUSPENSE` — settlement holds have no release workflow, so posting
 *     one would strand every vendor balance with no supported exit.
 */
export const REACHABLE_ACCOUNT_CODES = [
  'GATEWAY_CLEARING',
  'VENDOR_PAYABLE',
  'PLATFORM_COMMISSION_INCOME',
] as const satisfies readonly LedgerAccountCode[];

export type ReachableAccountCode = (typeof REACHABLE_ACCOUNT_CODES)[number];

/**
 * Whether an account is vendor-owned. Vendor-owned lines carry a `vendorId`;
 * platform-owned ones carry `null`, which is what keeps Vendor A's payable
 * distinguishable from Vendor B's while commission income stays a single
 * platform balance.
 */
export const isVendorOwnedAccount = (code: LedgerAccountCode): boolean =>
  code === 'VENDOR_PAYABLE' || code === 'VENDOR_RECEIVABLE_COD';

/** Which side of the double entry a line sits on. Never a signed amount — see `LedgerJournal`. */
export type LedgerDirection = 'DEBIT' | 'CREDIT';

/** Why a journal was posted. New posting events add members; the journal shape never changes. */
export type LedgerJournalKind = 'PAYMENT_CAPTURED' | 'COMMISSION_ACCRUED';
