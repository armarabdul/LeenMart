import { AppError, DomainRuleError, type AppErrorOptions } from '@leen-mart/domain-kit';

/**
 * A journal whose debits and credits do not agree. A 500, not a 4xx: no
 * request shape can cause this — it means the posting code itself computed
 * an unbalanced set, which is a defect, not caller error. Raised before any
 * row is written, so an unbalanced journal is never persisted.
 */
export class UnbalancedJournalError extends AppError {
  readonly kind = 'INTERNAL' as const;
  readonly code = 'LEDGER_UNBALANCED_JOURNAL';

  constructor(debitMinor: bigint, creditMinor: bigint) {
    super(
      `A ledger journal must balance: debits ${debitMinor.toString()} != credits ${creditMinor.toString()}.`,
    );
  }
}

/** A journal with no lines, or one side entirely missing. Same reasoning as `UnbalancedJournalError`. */
export class DegenerateJournalError extends AppError {
  readonly kind = 'INTERNAL' as const;
  readonly code = 'LEDGER_DEGENERATE_JOURNAL';

  constructor(issue: string) {
    super(`A ledger journal is malformed: ${issue}`);
  }
}

/** A line amount that is zero, negative, or mixes currencies within one journal. */
export class InvalidLedgerEntryError extends AppError {
  readonly kind = 'INTERNAL' as const;
  readonly code = 'LEDGER_INVALID_ENTRY';

  constructor(issue: string) {
    super(`A ledger entry is invalid: ${issue}`);
  }
}

/**
 * An account with no posting event in this milestone was asked to receive
 * one. Exists so that "dormant" is enforced rather than merely documented —
 * a future milestone that wants to post to `HOLD_SUSPENSE` must add it to
 * `REACHABLE_ACCOUNT_CODES` deliberately, not by accident.
 */
export class DormantAccountError extends AppError {
  readonly kind = 'INTERNAL' as const;
  readonly code = 'LEDGER_DORMANT_ACCOUNT';

  constructor(code: string) {
    super(
      `Account ${code} has no posting event in this milestone and must not receive entries. See REACHABLE_ACCOUNT_CODES.`,
    );
  }
}

/**
 * S3-8's vendor-earnings ACTIVE gate. Mirrors `order`'s own
 * `VendorNotActiveForOrdersError` exactly — the same reasoning applied to a
 * different surface: every `/vendor/*` route in this codebase gates on the
 * *acting* vendor's own `ACTIVE` status (S3-5's discovery §A.3), and the
 * earnings statement is deliberately kept consistent with that rather than
 * inventing a laxer rule for a read-only surface.
 */
export class VendorNotActiveForEarningsError extends DomainRuleError {
  constructor(options: AppErrorOptions = {}) {
    super(
      'VENDOR_NOT_ACTIVE',
      'Your vendor account is not active yet, so you cannot view earnings.',
      options,
    );
  }
}
