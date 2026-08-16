import { Money, type TransactionScope } from '@leen-mart/domain-kit';
import type { PrismaClient } from '@prisma/client';
import { toVendorId } from '../../../identity/index.js';
import { LedgerEntry, LedgerJournal } from '../../domain/entities/ledger-journal.entity.js';
import type { LedgerRepository } from '../../domain/repositories/ledger.repository.js';
import {
  toLedgerEntryId,
  toLedgerJournalId,
} from '../../domain/value-objects/ledger-ids.value-object.js';
import type {
  LedgerAccountCode,
  LedgerDirection,
  LedgerJournalKind,
} from '../../domain/value-objects/ledger-account.value-object.js';

interface LedgerEntryRow {
  readonly id: string;
  readonly accountCode: string;
  readonly vendorId: string | null;
  readonly direction: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly orderItemId: string | null;
}

interface LedgerJournalRow {
  readonly id: string;
  readonly kind: string;
  readonly orderId: string;
  readonly subOrderId: string;
  readonly paymentAttemptId: string;
  readonly vendorId: string;
  readonly occurredAt: Date;
  readonly entries: readonly LedgerEntryRow[];
}

const toDomain = (row: LedgerJournalRow): LedgerJournal =>
  LedgerJournal.reconstitute({
    id: toLedgerJournalId(row.id),
    kind: row.kind as LedgerJournalKind,
    orderId: row.orderId,
    subOrderId: row.subOrderId,
    paymentAttemptId: row.paymentAttemptId,
    vendorId: toVendorId(row.vendorId),
    occurredAt: row.occurredAt,
    entries: row.entries.map((entry) =>
      LedgerEntry.reconstitute({
        id: toLedgerEntryId(entry.id),
        accountCode: entry.accountCode as LedgerAccountCode,
        vendorId: entry.vendorId === null ? null : toVendorId(entry.vendorId),
        direction: entry.direction as LedgerDirection,
        amount: Money.fromMinor(entry.amountMinor, entry.currency as 'INR'),
        orderItemId: entry.orderItemId,
      }),
    ),
  });

/**
 * Maps rows to `LedgerJournal` at the boundary; Prisma types never escape
 * this file (SDD 3.4).
 *
 * **Insert-only.** There is no update, delete or upsert anywhere in this
 * class, matching the port. The database enforces the same thing
 * independently — `trg_ledger_journals_immutable`/`trg_ledger_entries_immutable`
 * refuse UPDATE and DELETE outright, and no runtime role holds either
 * privilege after `20260817090001_narrow_ledger_grants`.
 *
 * Runs on whichever client it is constructed with. In production that is the
 * checkout client (`leenmart_checkout`), the only role granted INSERT, since
 * payment confirmation is the sole posting path in S3-7.
 */
export class PrismaLedgerRepository implements LedgerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): LedgerRepository {
    return new PrismaLedgerRepository(scope as unknown as PrismaClient);
  }

  /**
   * `createMany` for the journals, then one for all their entries — two
   * statements rather than a nested write per journal, and both inside the
   * caller's transaction so a failure anywhere leaves no partial posting.
   *
   * A replayed payment confirmation collides with
   * `uq_ledger_journals_sub_order_kind` and the whole transaction aborts,
   * which is the intended outcome: the ledger refuses the duplicate rather
   * than silently skipping it, so the caller cannot mistake a no-op for a
   * successful second posting.
   */
  async append(journals: readonly LedgerJournal[]): Promise<void> {
    if (journals.length === 0) {
      return;
    }

    await this.prisma.ledgerJournal.createMany({
      data: journals.map((journal) => ({
        id: journal.id,
        kind: journal.kind,
        orderId: journal.orderId,
        subOrderId: journal.subOrderId,
        paymentAttemptId: journal.paymentAttemptId,
        vendorId: journal.vendorId,
        currency: journal.currency,
        occurredAt: journal.occurredAt,
      })),
    });

    await this.prisma.ledgerEntry.createMany({
      data: journals.flatMap((journal) =>
        journal.entries.map((entry) => ({
          id: entry.id,
          journalId: journal.id,
          accountCode: entry.accountCode,
          vendorId: entry.vendorId,
          direction: entry.direction,
          amountMinor: entry.amount.amountMinor,
          currency: entry.amount.currency,
          orderItemId: entry.orderItemId,
        })),
      ),
    });
  }

  async listBySubOrderId(subOrderId: string): Promise<readonly LedgerJournal[]> {
    const rows = await this.prisma.ledgerJournal.findMany({
      where: { subOrderId },
      orderBy: { createdAt: 'asc' },
      include: { entries: { orderBy: { createdAt: 'asc' } } },
    });
    return rows.map((row) => toDomain(row as unknown as LedgerJournalRow));
  }
}
