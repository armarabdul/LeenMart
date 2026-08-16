import { AppError } from '@leen-mart/domain-kit';

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
