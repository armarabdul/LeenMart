import type { Money } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';
import {
  DegenerateJournalError,
  DormantAccountError,
  InvalidLedgerEntryError,
  UnbalancedJournalError,
} from '../errors/ledger-errors.js';
import {
  REACHABLE_ACCOUNT_CODES,
  isVendorOwnedAccount,
  type LedgerAccountCode,
  type LedgerDirection,
  type LedgerJournalKind,
} from '../value-objects/ledger-account.value-object.js';
import type { LedgerEntryId, LedgerJournalId } from '../value-objects/ledger-ids.value-object.js';

export interface LedgerEntryProps {
  readonly id: LedgerEntryId;
  readonly accountCode: LedgerAccountCode;
  readonly vendorId: VendorId | null;
  readonly direction: LedgerDirection;
  readonly amount: Money;
  readonly orderItemId: string | null;
}

/**
 * One line of a journal. Immutable by construction — there is no setter and
 * no transition method, because SDD 10.3 makes the ledger append-only: a
 * correction is a new compensating journal, never an edit.
 */
export class LedgerEntry {
  private constructor(private readonly props: LedgerEntryProps) {}

  static create(props: LedgerEntryProps): LedgerEntry {
    if (props.amount.amountMinor <= 0n) {
      // Direction carries the sign, so the magnitude is always positive.
      // Without this, a "negative debit" could fake a balanced journal.
      throw new InvalidLedgerEntryError(
        `amount must be a positive number of minor units, received ${props.amount.amountMinor.toString()}`,
      );
    }
    if (!(REACHABLE_ACCOUNT_CODES as readonly string[]).includes(props.accountCode)) {
      throw new DormantAccountError(props.accountCode);
    }
    if (isVendorOwnedAccount(props.accountCode) && props.vendorId === null) {
      throw new InvalidLedgerEntryError(
        `${props.accountCode} is vendor-owned and requires a vendorId`,
      );
    }
    if (!isVendorOwnedAccount(props.accountCode) && props.vendorId !== null) {
      throw new InvalidLedgerEntryError(
        `${props.accountCode} is platform-owned and must not carry a vendorId`,
      );
    }
    return new LedgerEntry(props);
  }

  static reconstitute(props: LedgerEntryProps): LedgerEntry {
    return new LedgerEntry(props);
  }

  get id(): LedgerEntryId {
    return this.props.id;
  }

  get accountCode(): LedgerAccountCode {
    return this.props.accountCode;
  }

  get vendorId(): VendorId | null {
    return this.props.vendorId;
  }

  get direction(): LedgerDirection {
    return this.props.direction;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get orderItemId(): string | null {
    return this.props.orderItemId;
  }
}

export interface LedgerJournalProps {
  readonly id: LedgerJournalId;
  readonly kind: LedgerJournalKind;
  readonly orderId: string;
  readonly subOrderId: string;
  readonly paymentAttemptId: string;
  readonly vendorId: VendorId;
  readonly entries: readonly LedgerEntry[];
  readonly occurredAt: Date;
}

/**
 * One balanced double-entry journal (SDD 10.3), scoped to a single
 * `SubOrder`.
 *
 * **The zero-sum invariant is enforced here, at construction**, so an
 * unbalanced journal is not merely rejected on the way to the database — it
 * cannot be represented as a `LedgerJournal` at all. `create` is the only
 * way to build one from new lines, and it throws before any repository sees
 * it, which is what makes the "unbalanced journals fail atomically"
 * requirement true regardless of which caller is posting.
 *
 * Scoped to a sub-order rather than an order because financial ownership in
 * a multi-vendor order is per vendor: one order-wide journal would mix
 * Vendor A's payable with Vendor B's indistinguishably.
 *
 * Append-only: no mutator, no `reverse()`. A future refund posts a *new*
 * compensating journal.
 */
export class LedgerJournal {
  private constructor(private readonly props: LedgerJournalProps) {}

  static create(props: LedgerJournalProps): LedgerJournal {
    const { entries } = props;
    if (entries.length === 0) {
      throw new DegenerateJournalError('a journal must have at least one debit and one credit');
    }

    const currencies = new Set(entries.map((entry) => entry.amount.currency));
    if (currencies.size > 1) {
      throw new InvalidLedgerEntryError(
        `all entries in a journal must share one currency, found ${[...currencies].join(', ')}`,
      );
    }

    const debits = entries.filter((entry) => entry.direction === 'DEBIT');
    const credits = entries.filter((entry) => entry.direction === 'CREDIT');
    if (debits.length === 0 || credits.length === 0) {
      throw new DegenerateJournalError(
        `a journal must have at least one debit and one credit, found ${debits.length} debit(s) and ${credits.length} credit(s)`,
      );
    }

    const total = (side: readonly LedgerEntry[]): bigint =>
      side.reduce((sum, entry) => sum + entry.amount.amountMinor, 0n);
    const debitTotal = total(debits);
    const creditTotal = total(credits);
    if (debitTotal !== creditTotal) {
      throw new UnbalancedJournalError(debitTotal, creditTotal);
    }

    return new LedgerJournal(props);
  }

  static reconstitute(props: LedgerJournalProps): LedgerJournal {
    return new LedgerJournal(props);
  }

  get id(): LedgerJournalId {
    return this.props.id;
  }

  get kind(): LedgerJournalKind {
    return this.props.kind;
  }

  get orderId(): string {
    return this.props.orderId;
  }

  get subOrderId(): string {
    return this.props.subOrderId;
  }

  get paymentAttemptId(): string {
    return this.props.paymentAttemptId;
  }

  get vendorId(): VendorId {
    return this.props.vendorId;
  }

  get entries(): readonly LedgerEntry[] {
    return this.props.entries;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }

  /** The journal's currency — single by construction (`create` refuses a mixed set). */
  get currency(): string {
    return this.props.entries[0]?.amount.currency ?? 'INR';
  }

  /** Equal to `creditTotalMinor` by construction; both are exposed so a test or a reconciliation report can assert it rather than trust it. */
  get debitTotalMinor(): bigint {
    return this.props.entries
      .filter((entry) => entry.direction === 'DEBIT')
      .reduce((sum, entry) => sum + entry.amount.amountMinor, 0n);
  }

  get creditTotalMinor(): bigint {
    return this.props.entries
      .filter((entry) => entry.direction === 'CREDIT')
      .reduce((sum, entry) => sum + entry.amount.amountMinor, 0n);
  }
}
