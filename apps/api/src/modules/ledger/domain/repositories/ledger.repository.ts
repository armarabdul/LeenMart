import type { TransactionScope } from '@leen-mart/domain-kit';
import type { LedgerJournal } from '../entities/ledger-journal.entity.js';

export interface LedgerRepository {
  /** Re-binds this repository to a transaction the caller already opened. See `OrderRepository.withTransaction`. */
  withTransaction(scope: TransactionScope): LedgerRepository;

  /**
   * Appends journals and their entries. Insert-only by design — there is no
   * `update`, no `delete` and no `reverse` on this port, because SDD 10.3
   * makes the ledger append-only and the database enforces the same thing
   * with `trg_ledger_*_immutable` plus the absence of any UPDATE/DELETE
   * grant or policy.
   *
   * Writes every journal in one call so the whole posting for one payment
   * lands or none of it does, inside whatever transaction the caller has
   * already opened.
   */
  append(journals: readonly LedgerJournal[]): Promise<void>;

  /** Every journal posted for one sub-order, for verification and future statements. */
  listBySubOrderId(subOrderId: string): Promise<readonly LedgerJournal[]>;
}
