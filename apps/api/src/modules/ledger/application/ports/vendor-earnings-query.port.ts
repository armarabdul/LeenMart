import type { Money } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';

/**
 * A vendor's accrued-earnings position, derived entirely from posted ledger
 * rows (S3-8, locked decisions #3/#5). Never persisted — recomputed from
 * `ledger_journals`/`ledger_entries` on every read, so it can never drift
 * from the ledger that is its only source of truth.
 *
 * Deliberately not called "balance" or "payable": S3-8's scope boundary
 * (locked decision #1) is an accrual statement, not a payout ledger — no
 * settlement, hold, or payout timing is represented here.
 */
export interface VendorEarningsSummary {
  readonly vendorId: VendorId;
  /** Sum of `VENDOR_PAYABLE` credits posted by `PAYMENT_CAPTURED` journals. */
  readonly grossAccrued: Money;
  /** Sum of `PLATFORM_COMMISSION_INCOME` credits posted by this vendor's `COMMISSION_ACCRUED` journals. */
  readonly commission: Money;
  /** `grossAccrued - commission`, computed once so the response and the two inputs it derives from can never disagree. */
  readonly netAccrued: Money;
}

/**
 * One accrual event — the pairing of a sub-order's `PAYMENT_CAPTURED`
 * journal with its (optional) sibling `COMMISSION_ACCRUED` journal, so a
 * statement row can show gross/commission/net together rather than as two
 * disconnected raw journal rows.
 */
export interface VendorEarningsLine {
  readonly subOrderId: string;
  readonly orderId: string;
  readonly paymentAttemptId: string;
  readonly vendorId: VendorId;
  /** The `PAYMENT_CAPTURED` journal's own `occurredAt` — when this accrual was posted. */
  readonly occurredAt: Date;
  readonly grossAmount: Money;
  /** Zero (not absent) when the sub-order had no commission — mirrors `PostOrderPaymentJournalsUseCase` omitting a zero-value journal. */
  readonly commissionAmount: Money;
  readonly netAmount: Money;
}

export interface VendorEarningsLinesPage {
  readonly items: readonly VendorEarningsLine[];
  /** The cursor to pass for the next page, or `null` at the end. */
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * The vendor-facing read path over the ledger (S3-8). A query port, not more
 * methods on `LedgerRepository`: that port's reach is posting and
 * per-sub-order verification (SDD 10.3's own writer contract), while this
 * one answers a different question — "what has this vendor earned so far,
 * across every posting" — the same separation `ProductReviewQueryPort` draws
 * from `ProductRepository`.
 *
 * **Read-only by construction.** No method here can write a ledger row —
 * S3-8 is strictly a reporting surface (locked decision #12).
 */
export interface VendorEarningsQueryPort {
  /** The vendor's whole accrued position — unbounded, not paginated: one row of arithmetic over every posted journal. */
  getSummary(vendorId: VendorId): Promise<VendorEarningsSummary>;

  /**
   * The statement, most recent accrual first.
   *
   * `cursor` is the `LedgerJournal.id` of the last `PAYMENT_CAPTURED` journal
   * of the previous page — opaque to the caller, keyset rather than offset
   * (SDD 9.2), the same reasoning `ProductReviewQueryPort.listForReview`
   * documents for its own cursor.
   */
  listLines(input: {
    vendorId: VendorId;
    limit: number;
    cursor?: string | undefined;
  }): Promise<VendorEarningsLinesPage>;
}
