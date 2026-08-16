import { describe, expect, it } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import {
  LedgerEntry,
  LedgerJournal,
} from '../../../../../src/modules/ledger/domain/entities/ledger-journal.entity.js';
import {
  DegenerateJournalError,
  DormantAccountError,
  InvalidLedgerEntryError,
  UnbalancedJournalError,
} from '../../../../../src/modules/ledger/domain/errors/ledger-errors.js';
import {
  REACHABLE_ACCOUNT_CODES,
  isVendorOwnedAccount,
  type LedgerAccountCode,
  type LedgerDirection,
} from '../../../../../src/modules/ledger/domain/value-objects/ledger-account.value-object.js';
import {
  toLedgerEntryId,
  toLedgerJournalId,
} from '../../../../../src/modules/ledger/domain/value-objects/ledger-ids.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const vendorId = toVendorId(ids.generate());
const inr = (minor: bigint | number): Money => Money.fromMinor(minor, 'INR');

const entry = (
  accountCode: LedgerAccountCode,
  direction: LedgerDirection,
  minor: bigint | number,
  overrides: { vendorId?: ReturnType<typeof toVendorId> | null; currency?: string } = {},
): LedgerEntry =>
  LedgerEntry.create({
    id: toLedgerEntryId(ids.generate()),
    accountCode,
    vendorId:
      overrides.vendorId !== undefined
        ? overrides.vendorId
        : isVendorOwnedAccount(accountCode)
          ? vendorId
          : null,
    direction,
    // `CurrencyCode` admits only 'INR' today, so a second currency cannot be
    // named without a cast. The mixed-currency guard is still worth proving:
    // it is what stops a future multi-currency world from silently netting
    // two currencies into one "balanced" journal.
    amount: Money.fromMinor(minor, (overrides.currency ?? 'INR') as 'INR'),
    orderItemId: null,
  });

const journal = (entries: LedgerEntry[]): LedgerJournal =>
  LedgerJournal.create({
    id: toLedgerJournalId(ids.generate()),
    kind: 'PAYMENT_CAPTURED',
    orderId: ids.generate(),
    subOrderId: ids.generate(),
    paymentAttemptId: ids.generate(),
    vendorId,
    occurredAt: NOW,
    entries,
  });

describe('LedgerEntry', () => {
  it('accepts a positive amount on a reachable account', () => {
    expect(() => entry('GATEWAY_CLEARING', 'DEBIT', 100)).not.toThrow();
  });

  it.each([0, -1, -10_000])('refuses a non-positive amount (%i)', (minor) => {
    // Direction carries the sign; a negative "debit" could otherwise fake a
    // balanced journal.
    expect(() => entry('GATEWAY_CLEARING', 'DEBIT', minor)).toThrow(InvalidLedgerEntryError);
  });

  it('refuses a dormant account outright', () => {
    for (const dormant of [
      'GST_OUTPUT',
      'TCS_PAYABLE',
      'TDS_PAYABLE',
      'REFUND_CLEARING',
      'HOLD_SUSPENSE',
      'VENDOR_RECEIVABLE_COD',
    ] as const) {
      expect(() => entry(dormant, 'DEBIT', 100)).toThrow(DormantAccountError);
    }
  });

  it('exposes exactly three reachable accounts in S3-7', () => {
    expect([...REACHABLE_ACCOUNT_CODES]).toEqual([
      'GATEWAY_CLEARING',
      'VENDOR_PAYABLE',
      'PLATFORM_COMMISSION_INCOME',
    ]);
  });

  it('requires a vendorId on a vendor-owned account', () => {
    expect(() => entry('VENDOR_PAYABLE', 'CREDIT', 100, { vendorId: null })).toThrow(
      InvalidLedgerEntryError,
    );
  });

  it('refuses a vendorId on a platform-owned account', () => {
    expect(() => entry('PLATFORM_COMMISSION_INCOME', 'CREDIT', 100, { vendorId })).toThrow(
      InvalidLedgerEntryError,
    );
  });

  it('has no mutator — a posted line is immutable', () => {
    const methods = Object.getOwnPropertyNames(LedgerEntry.prototype).filter(
      (name) => name !== 'constructor',
    );
    const nonGetters = methods.filter(
      (name) => Object.getOwnPropertyDescriptor(LedgerEntry.prototype, name)?.get === undefined,
    );
    expect(nonGetters).toEqual([]);
  });
});

describe('LedgerJournal', () => {
  it('accepts a balanced two-line journal', () => {
    const posted = journal([
      entry('GATEWAY_CLEARING', 'DEBIT', 29_800),
      entry('VENDOR_PAYABLE', 'CREDIT', 29_800),
    ]);

    expect(posted.debitTotalMinor).toBe(29_800n);
    expect(posted.creditTotalMinor).toBe(posted.debitTotalMinor);
  });

  it('accepts a balanced journal whose credits are split across many lines', () => {
    const posted = journal([
      entry('VENDOR_PAYABLE', 'DEBIT', 3_000),
      entry('PLATFORM_COMMISSION_INCOME', 'CREDIT', 1_000),
      entry('PLATFORM_COMMISSION_INCOME', 'CREDIT', 2_000),
    ]);

    expect(posted.debitTotalMinor).toBe(3_000n);
    expect(posted.creditTotalMinor).toBe(3_000n);
  });

  it('refuses an unbalanced journal', () => {
    expect(() =>
      journal([
        entry('GATEWAY_CLEARING', 'DEBIT', 29_800),
        entry('VENDOR_PAYABLE', 'CREDIT', 29_700),
      ]),
    ).toThrow(UnbalancedJournalError);
  });

  it('names both totals in the imbalance error, so the defect is diagnosable', () => {
    expect(() =>
      journal([entry('GATEWAY_CLEARING', 'DEBIT', 100), entry('VENDOR_PAYABLE', 'CREDIT', 60)]),
    ).toThrow(/100.*!=.*60/);
  });

  it('refuses an empty journal', () => {
    expect(() => journal([])).toThrow(DegenerateJournalError);
  });

  it('refuses a journal with debits only', () => {
    expect(() =>
      journal([entry('GATEWAY_CLEARING', 'DEBIT', 100), entry('VENDOR_PAYABLE', 'DEBIT', 100)]),
    ).toThrow(DegenerateJournalError);
  });

  it('refuses a journal with credits only', () => {
    expect(() =>
      journal([
        entry('VENDOR_PAYABLE', 'CREDIT', 100),
        entry('PLATFORM_COMMISSION_INCOME', 'CREDIT', 100),
      ]),
    ).toThrow(DegenerateJournalError);
  });

  it('refuses a journal mixing currencies, even when the raw minor units happen to agree', () => {
    expect(() =>
      journal([
        entry('GATEWAY_CLEARING', 'DEBIT', 100, { currency: 'USD' }),
        entry('VENDOR_PAYABLE', 'CREDIT', 100, { currency: 'INR' }),
      ]),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('reports its single currency', () => {
    expect(
      journal([entry('GATEWAY_CLEARING', 'DEBIT', 100), entry('VENDOR_PAYABLE', 'CREDIT', 100)])
        .currency,
    ).toBe('INR');
  });

  it('has no mutator and no reverse() — corrections are new compensating journals', () => {
    const methods = Object.getOwnPropertyNames(LedgerJournal.prototype).filter(
      (name) => name !== 'constructor',
    );
    const nonGetters = methods.filter(
      (name) => Object.getOwnPropertyDescriptor(LedgerJournal.prototype, name)?.get === undefined,
    );
    expect(nonGetters).toEqual([]);
    expect(methods).not.toContain('reverse');
  });

  it('reconstitutes a stored journal without revalidating', () => {
    // Rehydration must not re-run `create`'s invariants: a historic row is a
    // fact, not a proposal, and an append-only table cannot be corrected.
    const rehydrated = LedgerJournal.reconstitute({
      id: toLedgerJournalId(ids.generate()),
      kind: 'COMMISSION_ACCRUED',
      orderId: ids.generate(),
      subOrderId: ids.generate(),
      paymentAttemptId: ids.generate(),
      vendorId,
      occurredAt: NOW,
      entries: [],
    });

    expect(rehydrated.entries).toEqual([]);
    expect(rehydrated.currency).toBe('INR');
  });
});

describe('the money representation', () => {
  it('is integer minor units, never a float', () => {
    const posted = journal([
      entry('GATEWAY_CLEARING', 'DEBIT', 1),
      entry('VENDOR_PAYABLE', 'CREDIT', 1),
    ]);

    expect(typeof posted.debitTotalMinor).toBe('bigint');
    expect(posted.entries[0]?.amount.amountMinor).toBe(1n);
  });

  it('is exact at a magnitude that would lose precision as a float', () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1
    const posted = journal([
      entry('GATEWAY_CLEARING', 'DEBIT', huge),
      entry('VENDOR_PAYABLE', 'CREDIT', huge),
    ]);

    expect(posted.debitTotalMinor).toBe(huge);
    expect(posted.debitTotalMinor === posted.creditTotalMinor).toBe(true);
  });

  it('keeps Money as the only amount type on an entry', () => {
    expect(entry('GATEWAY_CLEARING', 'DEBIT', 500).amount).toBeInstanceOf(Money);
    expect(inr(500).amountMinor).toBe(500n);
  });
});
