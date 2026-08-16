import { Money } from '@leen-mart/domain-kit';
import type { Prisma, PrismaClient } from '@prisma/client';
import { toVendorId, type VendorId } from '../../../identity/index.js';
import type {
  VendorEarningsLine,
  VendorEarningsLinesPage,
  VendorEarningsQueryPort,
  VendorEarningsSummary,
} from '../../application/ports/vendor-earnings-query.port.js';

const CAPTURE_ENTRIES_SELECT = {
  id: true,
  kind: true,
  orderId: true,
  subOrderId: true,
  paymentAttemptId: true,
  vendorId: true,
  currency: true,
  occurredAt: true,
  entries: {
    where: { accountCode: 'VENDOR_PAYABLE', direction: 'CREDIT' },
    select: { amountMinor: true },
  },
} satisfies Prisma.LedgerJournalSelect;

type CaptureJournalRow = Prisma.LedgerJournalGetPayload<{ select: typeof CAPTURE_ENTRIES_SELECT }>;

/**
 * The vendor-facing read path over the S3-7 ledger (S3-8), on the
 * tenant-scoped `leenmart_app` credential. Constructed with the same `prisma`
 * client `vendor-order.routes.ts` reads `sub_orders` through — RLS
 * (`ledger_journals_vendor_select`/`ledger_entries_vendor_select`) is what
 * confines every query here to the caller's own `app.vendor_id`, the same
 * defence-in-depth the application-level `vendorId` filters below are
 * layered on top of, never a substitute for.
 *
 * **Read-only.** There is no write method on this class or its port — S3-8
 * is strictly a reporting surface (locked decision #12), and the database
 * itself grants `leenmart_app` no INSERT/UPDATE/DELETE on either ledger
 * table (`20260817090001_narrow_ledger_grants`).
 */
export class PrismaVendorEarningsQuery implements VendorEarningsQueryPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Two scalar aggregates, not a join: `VENDOR_PAYABLE` credits (gross,
   * locked decision #5) and `PLATFORM_COMMISSION_INCOME` credits (commission)
   * are independent sums over `ledger_entries`, each already narrowed to the
   * originating journal kind so a future account/kind cannot be
   * miscounted into either bucket by accident.
   */
  async getSummary(vendorId: VendorId): Promise<VendorEarningsSummary> {
    const [grossAgg, commissionAgg] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({
        where: {
          accountCode: 'VENDOR_PAYABLE',
          direction: 'CREDIT',
          journal: { vendorId, kind: 'PAYMENT_CAPTURED' },
        },
        _sum: { amountMinor: true },
      }),
      this.prisma.ledgerEntry.aggregate({
        where: {
          accountCode: 'PLATFORM_COMMISSION_INCOME',
          direction: 'CREDIT',
          journal: { vendorId, kind: 'COMMISSION_ACCRUED' },
        },
        _sum: { amountMinor: true },
      }),
    ]);

    const grossMinor = grossAgg._sum.amountMinor ?? 0n;
    const commissionMinor = commissionAgg._sum.amountMinor ?? 0n;

    return {
      vendorId,
      grossAccrued: Money.fromMinor(grossMinor, 'INR'),
      commission: Money.fromMinor(commissionMinor, 'INR'),
      netAccrued: Money.fromMinor(grossMinor - commissionMinor, 'INR'),
    };
  }

  /**
   * Anchored on each sub-order's `PAYMENT_CAPTURED` journal — every accrual
   * event has exactly one (`PostOrderPaymentJournalsUseCase` always posts
   * it), while `COMMISSION_ACCRUED` is optional (omitted for zero
   * commission), so paginating the capture journals never skips a sub-order
   * whose commission happens to be zero.
   *
   * `take + 1`/keyset-cursor shape mirrors `PrismaProductReviewQuery.listForReview`
   * exactly, ordered newest-first for a statement rather than oldest-first
   * for a queue.
   */
  async listLines(input: {
    vendorId: VendorId;
    limit: number;
    cursor?: string | undefined;
  }): Promise<VendorEarningsLinesPage> {
    const take = input.limit + 1;

    const captureJournals = await this.prisma.ledgerJournal.findMany({
      where: { vendorId: input.vendorId, kind: 'PAYMENT_CAPTURED' },
      select: CAPTURE_ENTRIES_SELECT,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });

    const hasMore = captureJournals.length > input.limit;
    const page: CaptureJournalRow[] = hasMore
      ? captureJournals.slice(0, input.limit)
      : captureJournals;

    const commissionBySubOrder = await this.commissionBySubOrder(input.vendorId, page);
    const items = page.map((journal) => toLine(journal, commissionBySubOrder));

    return {
      items,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  /** One `COMMISSION_ACCRUED` lookup for the whole page, keyed by sub-order — split out purely to keep `listLines` under this file's function-length budget. */
  private async commissionBySubOrder(
    vendorId: VendorId,
    page: readonly CaptureJournalRow[],
  ): Promise<Map<string, bigint>> {
    const subOrderIds = page.map((journal) => journal.subOrderId);
    if (subOrderIds.length === 0) {
      return new Map();
    }

    const commissionJournals = await this.prisma.ledgerJournal.findMany({
      where: { vendorId, kind: 'COMMISSION_ACCRUED', subOrderId: { in: subOrderIds } },
      select: {
        subOrderId: true,
        entries: {
          where: { accountCode: 'PLATFORM_COMMISSION_INCOME', direction: 'CREDIT' },
          select: { amountMinor: true },
        },
      },
    });

    return new Map(
      commissionJournals.map((journal) => [
        journal.subOrderId,
        journal.entries.reduce((sum, entry) => sum + entry.amountMinor, 0n),
      ]),
    );
  }
}

/** One capture journal + its looked-up commission -> one statement line. Split out for the same reason `commissionBySubOrder` is. */
const toLine = (
  journal: CaptureJournalRow,
  commissionBySubOrder: ReadonlyMap<string, bigint>,
): VendorEarningsLine => {
  const grossMinor = journal.entries.reduce((sum, entry) => sum + entry.amountMinor, 0n);
  const commissionMinor = commissionBySubOrder.get(journal.subOrderId) ?? 0n;
  const currency = journal.currency as 'INR';

  return {
    subOrderId: journal.subOrderId,
    orderId: journal.orderId,
    paymentAttemptId: journal.paymentAttemptId,
    vendorId: toVendorId(journal.vendorId),
    occurredAt: journal.occurredAt,
    grossAmount: Money.fromMinor(grossMinor, currency),
    commissionAmount: Money.fromMinor(commissionMinor, currency),
    netAmount: Money.fromMinor(grossMinor - commissionMinor, currency),
  };
};
