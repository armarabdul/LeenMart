import { describe, expect, it, vi } from 'vitest';
import { Money, UuidV7Generator, type TransactionScope } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import { PostOrderPaymentJournalsUseCase } from '../../../../../src/modules/ledger/application/use-cases/post-order-payment-journals.use-case.js';
import type { LedgerJournal } from '../../../../../src/modules/ledger/domain/entities/ledger-journal.entity.js';
import type { LedgerRepository } from '../../../../../src/modules/ledger/domain/repositories/ledger.repository.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const scope = {} as TransactionScope;
const inr = (minor: bigint | number): Money => Money.fromMinor(minor, 'INR');

const vendorA = toVendorId(ids.generate());
const vendorB = toVendorId(ids.generate());

/** Captures what was appended so the accounting can be asserted line by line. */
const repo = (): { repository: LedgerRepository; appended: LedgerJournal[] } => {
  const appended: LedgerJournal[] = [];
  const repository: LedgerRepository = {
    withTransaction: () => repository,
    append: vi.fn().mockImplementation((journals: readonly LedgerJournal[]) => {
      appended.push(...journals);
      return Promise.resolve();
    }),
    listBySubOrderId: vi.fn().mockResolvedValue([]),
  };
  return { repository, appended };
};

const build = (repository: LedgerRepository): PostOrderPaymentJournalsUseCase =>
  new PostOrderPaymentJournalsUseCase({ ledgerRepository: repository, idGenerator: ids });

const subOrder = (
  vendorId: ReturnType<typeof toVendorId>,
  totalMinor: number,
  commissionMinors: number[],
): {
  subOrderId: string;
  vendorId: ReturnType<typeof toVendorId>;
  total: Money;
  commissionLines: { orderItemId: string; commissionAmount: Money }[];
} => ({
  subOrderId: ids.generate(),
  vendorId,
  total: inr(totalMinor),
  commissionLines: commissionMinors.map((minor) => ({
    orderItemId: ids.generate(),
    commissionAmount: inr(minor),
  })),
});

const run = async (
  subOrders: ReturnType<typeof subOrder>[],
): Promise<{ appended: LedgerJournal[] }> => {
  const { repository, appended } = repo();
  await build(repository).execute(scope, {
    orderId: ids.generate(),
    paymentAttemptId: ids.generate(),
    occurredAt: NOW,
    subOrders,
  });
  return { appended };
};

/** Sums one account's signed position across every posted journal. */
const positionOf = (
  journals: LedgerJournal[],
  accountCode: string,
  vendorId?: ReturnType<typeof toVendorId>,
): bigint =>
  journals
    .flatMap((journal) => journal.entries)
    .filter(
      (entry) =>
        entry.accountCode === accountCode &&
        (vendorId === undefined || entry.vendorId === vendorId),
    )
    .reduce(
      (sum, entry) =>
        entry.direction === 'DEBIT'
          ? sum + entry.amount.amountMinor
          : sum - entry.amount.amountMinor,
      0n,
    );

describe('PostOrderPaymentJournalsUseCase — single vendor', () => {
  it('posts one PAYMENT_CAPTURED and one COMMISSION_ACCRUED journal', async () => {
    const { appended } = await run([subOrder(vendorA, 29_800, [2_980])]);

    expect(appended.map((journal) => journal.kind)).toEqual([
      'PAYMENT_CAPTURED',
      'COMMISSION_ACCRUED',
    ]);
  });

  it('debits GATEWAY_CLEARING and credits VENDOR_PAYABLE for the sub-order total', async () => {
    const { appended } = await run([subOrder(vendorA, 29_800, [2_980])]);
    const capture = appended[0];

    expect(capture?.entries).toHaveLength(2);
    expect(positionOf([capture!], 'GATEWAY_CLEARING')).toBe(29_800n);
    expect(positionOf([capture!], 'VENDOR_PAYABLE', vendorA)).toBe(-29_800n);
  });

  it('debits VENDOR_PAYABLE and credits PLATFORM_COMMISSION_INCOME for the commission', async () => {
    const { appended } = await run([subOrder(vendorA, 29_800, [2_980])]);
    const commission = appended[1];

    expect(positionOf([commission!], 'VENDOR_PAYABLE', vendorA)).toBe(2_980n);
    expect(positionOf([commission!], 'PLATFORM_COMMISSION_INCOME')).toBe(-2_980n);
  });

  it('leaves the vendor a net payable of total minus commission', async () => {
    const { appended } = await run([subOrder(vendorA, 29_800, [2_980])]);

    // Credit balance, so the signed position is negative.
    expect(positionOf(appended, 'VENDOR_PAYABLE', vendorA)).toBe(-(29_800n - 2_980n));
  });

  it('balances every journal it posts', async () => {
    const { appended } = await run([subOrder(vendorA, 29_800, [1_000, 980, 1_000])]);

    for (const journal of appended) {
      expect(journal.debitTotalMinor).toBe(journal.creditTotalMinor);
    }
  });

  it('keeps each commission credit attributable to its own order item', async () => {
    const target = subOrder(vendorA, 29_800, [1_000, 1_980]);
    const { appended } = await run([target]);

    const credits = (appended[1]?.entries ?? []).filter((e) => e.direction === 'CREDIT');
    expect(credits.map((entry) => entry.orderItemId)).toEqual(
      target.commissionLines.map((line) => line.orderItemId),
    );
  });

  it('rolls the commission debit into a single VENDOR_PAYABLE line', async () => {
    const { appended } = await run([subOrder(vendorA, 29_800, [1_000, 1_980])]);

    const debits = (appended[1]?.entries ?? []).filter((e) => e.direction === 'DEBIT');
    expect(debits).toHaveLength(1);
    expect(debits[0]?.amount.amountMinor).toBe(2_980n);
  });

  it('omits the commission journal entirely when commission is zero', async () => {
    const { appended } = await run([subOrder(vendorA, 29_800, [0])]);

    expect(appended.map((journal) => journal.kind)).toEqual(['PAYMENT_CAPTURED']);
  });

  it('omits the commission journal when a sub-order has no items at all', async () => {
    const { appended } = await run([subOrder(vendorA, 29_800, [])]);

    expect(appended).toHaveLength(1);
  });
});

describe('PostOrderPaymentJournalsUseCase — multi-vendor (locked decision 4)', () => {
  const twoVendors = (): ReturnType<typeof subOrder>[] => [
    subOrder(vendorA, 60_000, [6_000]),
    subOrder(vendorB, 40_000, [6_000]),
  ];

  it('posts four journals — two per vendor, never one shared journal', async () => {
    const { appended } = await run(twoVendors());

    expect(appended).toHaveLength(4);
  });

  it('scopes every journal to exactly one vendor', async () => {
    const { appended } = await run(twoVendors());

    expect(appended.filter((journal) => journal.vendorId === vendorA)).toHaveLength(2);
    expect(appended.filter((journal) => journal.vendorId === vendorB)).toHaveLength(2);
  });

  it('keeps each vendor’s payable independently traceable', async () => {
    const { appended } = await run(twoVendors());

    expect(positionOf(appended, 'VENDOR_PAYABLE', vendorA)).toBe(-(60_000n - 6_000n));
    expect(positionOf(appended, 'VENDOR_PAYABLE', vendorB)).toBe(-(40_000n - 6_000n));
  });

  it('never mixes one vendor’s payable into another’s journal', async () => {
    const { appended } = await run(twoVendors());

    for (const journal of appended) {
      const payableVendors = journal.entries
        .filter((entry) => entry.accountCode === 'VENDOR_PAYABLE')
        .map((entry) => entry.vendorId);
      expect(new Set(payableVendors).size).toBeLessThanOrEqual(1);
      expect(payableVendors.every((v) => v === journal.vendorId)).toBe(true);
    }
  });

  it('accumulates platform commission income across both vendors', async () => {
    const { appended } = await run(twoVendors());

    expect(positionOf(appended, 'PLATFORM_COMMISSION_INCOME')).toBe(-12_000n);
  });

  it('balances in total: Σ debits = Σ credits across the whole order', async () => {
    const { appended } = await run(twoVendors());

    const debits = appended.reduce((sum, journal) => sum + journal.debitTotalMinor, 0n);
    const credits = appended.reduce((sum, journal) => sum + journal.creditTotalMinor, 0n);
    expect(debits).toBe(credits);
    expect(debits).toBe(60_000n + 40_000n + 6_000n + 6_000n);
  });
});

describe('PostOrderPaymentJournalsUseCase — what it deliberately does not do', () => {
  it('never posts to a dormant tax, refund, hold or COD account', async () => {
    const { appended } = await run([
      subOrder(vendorA, 60_000, [6_000]),
      subOrder(vendorB, 40_000, [4_000]),
    ]);

    const used = new Set(appended.flatMap((j) => j.entries).map((e) => e.accountCode));
    expect([...used].sort()).toEqual([
      'GATEWAY_CLEARING',
      'PLATFORM_COMMISSION_INCOME',
      'VENDOR_PAYABLE',
    ]);
    for (const dormant of [
      'GST_OUTPUT',
      'TCS_PAYABLE',
      'TDS_PAYABLE',
      'REFUND_CLEARING',
      'HOLD_SUSPENSE',
      'VENDOR_RECEIVABLE_COD',
    ]) {
      expect(used.has(dormant as never)).toBe(false);
    }
  });

  it('consumes the commission snapshot verbatim rather than recomputing it', async () => {
    // An odd, deliberately non-round figure: any recalculation from a rate
    // would not reproduce it.
    const { appended } = await run([subOrder(vendorA, 29_800, [1_337])]);

    expect(positionOf(appended, 'PLATFORM_COMMISSION_INCOME')).toBe(-1_337n);
  });

  it('writes nothing at all when there are no sub-orders', async () => {
    const { repository, appended } = repo();
    await build(repository).execute(scope, {
      orderId: ids.generate(),
      paymentAttemptId: ids.generate(),
      occurredAt: NOW,
      subOrders: [],
    });

    expect(repository.append).not.toHaveBeenCalled();
    expect(appended).toEqual([]);
  });

  it('appends every journal in one call, so a partial posting cannot commit', async () => {
    const { repository } = repo();
    await build(repository).execute(scope, {
      orderId: ids.generate(),
      paymentAttemptId: ids.generate(),
      occurredAt: NOW,
      subOrders: [subOrder(vendorA, 60_000, [6_000]), subOrder(vendorB, 40_000, [4_000])],
    });

    expect(repository.append).toHaveBeenCalledTimes(1);
    expect(vi.mocked(repository.append).mock.calls[0]?.[0]).toHaveLength(4);
  });

  it('binds the repository to the caller’s transaction scope', async () => {
    const { repository } = repo();
    const spy = vi.spyOn(repository, 'withTransaction');

    await build(repository).execute(scope, {
      orderId: ids.generate(),
      paymentAttemptId: ids.generate(),
      occurredAt: NOW,
      subOrders: [subOrder(vendorA, 100, [10])],
    });

    expect(spy).toHaveBeenCalledWith(scope);
  });
});
