import { Money, type IdGenerator, type TransactionScope } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';
import { LedgerEntry, LedgerJournal } from '../../domain/entities/ledger-journal.entity.js';
import type { LedgerRepository } from '../../domain/repositories/ledger.repository.js';
import {
  toLedgerEntryId,
  toLedgerJournalId,
} from '../../domain/value-objects/ledger-ids.value-object.js';

/**
 * One sub-order's worth of already-computed financial facts. Deliberately a
 * plain input rather than the `SubOrder`/`OrderItem` entities themselves:
 * the ledger module must not import the order module's internals (SDD 5.1),
 * and it must not recompute anything — `commissionAmount` is the snapshot
 * `PlaceOrderUseCase` already wrote to `order_items`.
 */
export interface SubOrderPostingInput {
  readonly subOrderId: string;
  readonly vendorId: VendorId;
  /** `SubOrder.totalAmount` — the sum of its line amounts. */
  readonly total: Money;
  /** One per `OrderItem`, carrying that line's snapshotted commission. */
  readonly commissionLines: readonly {
    readonly orderItemId: string;
    readonly commissionAmount: Money;
  }[];
}

export interface PostOrderPaymentJournalsInput {
  readonly orderId: string;
  readonly paymentAttemptId: string;
  readonly subOrders: readonly SubOrderPostingInput[];
  readonly occurredAt: Date;
}

export interface PostOrderPaymentJournalsDeps {
  readonly ledgerRepository: LedgerRepository;
  readonly idGenerator: IdGenerator;
}

/**
 * Posts the accounting for one successful payment (S3-7, SDD 10.3).
 *
 * **Per sub-order, not per order** — financial ownership in a multi-vendor
 * order is per vendor, so each vendor's postings stay independently
 * traceable and Vendor A's payable can never be mixed with Vendor B's:
 *
 * ```
 * J1  PAYMENT_CAPTURED
 *       DEBIT   GATEWAY_CLEARING            subOrder.total
 *       CREDIT  VENDOR_PAYABLE (vendor)     subOrder.total
 *
 * J2  COMMISSION_ACCRUED                    (omitted when commission is zero)
 *       DEBIT   VENDOR_PAYABLE (vendor)     Σ item.commissionAmount
 *       CREDIT  PLATFORM_COMMISSION_INCOME  Σ item.commissionAmount
 * ```
 *
 * Each journal balances on its own; the vendor's net payable is
 * `total − commission`, derivable by summing their lines.
 *
 * **What is deliberately not posted.** SDD 10.3's worked example also shows
 * GST on commission, TCS withheld, and a hold. None is posted here:
 *
 *   * GST/TCS/TDS — BR-13 is an unresolved P0 legal question and this
 *     repository holds no authoritative rate. `OrderItem` does carry an
 *     optional resolved *goods* tax, but that is the vendor's liability
 *     flowing through `VENDOR_PAYABLE`, not a platform GST-output line, and
 *     `SubOrder.totalAmount` excludes it entirely. Inventing a figure for an
 *     append-only accounting record would be worse than omitting it.
 *   * `HOLD_SUSPENSE` — S3-7 has no settlement-release workflow, so a hold
 *     would strand every vendor balance with no supported exit.
 *
 * `LedgerEntry.create` refuses any dormant account outright, so these are
 * enforced rather than merely documented.
 */
export class PostOrderPaymentJournalsUseCase {
  constructor(private readonly deps: PostOrderPaymentJournalsDeps) {}

  async execute(scope: TransactionScope, input: PostOrderPaymentJournalsInput): Promise<void> {
    const { ledgerRepository } = this.deps;

    const journals = input.subOrders.flatMap((subOrder) => [
      this.captureJournal(input, subOrder),
      ...this.commissionJournal(input, subOrder),
    ]);

    if (journals.length === 0) {
      return;
    }

    await ledgerRepository.withTransaction(scope).append(journals);
  }

  private captureJournal(
    input: PostOrderPaymentJournalsInput,
    subOrder: SubOrderPostingInput,
  ): LedgerJournal {
    const { idGenerator } = this.deps;
    return LedgerJournal.create({
      id: toLedgerJournalId(idGenerator.generate()),
      kind: 'PAYMENT_CAPTURED',
      orderId: input.orderId,
      subOrderId: subOrder.subOrderId,
      paymentAttemptId: input.paymentAttemptId,
      vendorId: subOrder.vendorId,
      occurredAt: input.occurredAt,
      entries: [
        LedgerEntry.create({
          id: toLedgerEntryId(idGenerator.generate()),
          accountCode: 'GATEWAY_CLEARING',
          vendorId: null,
          direction: 'DEBIT',
          amount: subOrder.total,
          orderItemId: null,
        }),
        LedgerEntry.create({
          id: toLedgerEntryId(idGenerator.generate()),
          accountCode: 'VENDOR_PAYABLE',
          vendorId: subOrder.vendorId,
          direction: 'CREDIT',
          amount: subOrder.total,
          orderItemId: null,
        }),
      ],
    });
  }

  /**
   * Returns zero or one journal. A sub-order whose commission is zero gets
   * none at all rather than a journal of two zero lines — `LedgerEntry`
   * refuses a non-positive amount, and a zero-value journal would be noise
   * in an append-only record.
   *
   * The debit is a single rolled-up `VENDOR_PAYABLE` line while the credits
   * stay per-item: that keeps each line's commission attributable to the
   * `OrderItem` it came from (via `orderItemId`) without inventing a
   * per-item payable the vendor does not actually hold.
   */
  private commissionJournal(
    input: PostOrderPaymentJournalsInput,
    subOrder: SubOrderPostingInput,
  ): LedgerJournal[] {
    const { idGenerator } = this.deps;
    const contributing = subOrder.commissionLines.filter(
      (line) => line.commissionAmount.amountMinor > 0n,
    );
    if (contributing.length === 0) {
      return [];
    }

    const currency = subOrder.total.currency;
    const totalMinor = contributing.reduce(
      (sum, line) => sum + line.commissionAmount.amountMinor,
      0n,
    );

    return [
      LedgerJournal.create({
        id: toLedgerJournalId(idGenerator.generate()),
        kind: 'COMMISSION_ACCRUED',
        orderId: input.orderId,
        subOrderId: subOrder.subOrderId,
        paymentAttemptId: input.paymentAttemptId,
        vendorId: subOrder.vendorId,
        occurredAt: input.occurredAt,
        entries: [
          LedgerEntry.create({
            id: toLedgerEntryId(idGenerator.generate()),
            accountCode: 'VENDOR_PAYABLE',
            vendorId: subOrder.vendorId,
            direction: 'DEBIT',
            amount: Money.fromMinor(totalMinor, currency),
            orderItemId: null,
          }),
          ...contributing.map((line) =>
            LedgerEntry.create({
              id: toLedgerEntryId(idGenerator.generate()),
              accountCode: 'PLATFORM_COMMISSION_INCOME',
              vendorId: null,
              direction: 'CREDIT',
              amount: line.commissionAmount,
              orderItemId: line.orderItemId,
            }),
          ),
        ],
      }),
    ];
  }
}
