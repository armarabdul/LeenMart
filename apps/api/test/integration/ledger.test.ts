import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import { PostOrderPaymentJournalsUseCase } from '../../src/modules/ledger/application/use-cases/post-order-payment-journals.use-case.js';
import { PrismaLedgerRepository } from '../../src/modules/ledger/infrastructure/persistence/prisma-ledger.repository.js';

const requireUrl = (
  name: 'DATABASE_URL' | 'APP_DATABASE_URL' | 'ADMIN_DATABASE_URL' | 'CHECKOUT_DATABASE_URL',
): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} must be set for this suite. Run \`pnpm db:migrate:deploy && pnpm db:provision-roles\`.`,
    );
  }
  return value;
};

/**
 * The double-entry ledger against real PostgreSQL (S3-7, SDD 10.3).
 *
 * The half of the design that only exists in the database: the append-only
 * triggers, the per-role grants and RLS policies, the sub-order/kind unique
 * index the ledger's idempotency rests on, and — the point of a double-entry
 * ledger — that debits equal credits when summed by the database itself
 * rather than by the code that wrote them.
 *
 * Posting runs on `leenmart_checkout`, the only role granted INSERT, exactly
 * as `ConfirmPaymentUseCase` does in production.
 */
describe('double-entry ledger (S3-7)', () => {
  const owner = new PrismaClient({ datasources: { db: { url: requireUrl('DATABASE_URL') } } });
  const checkout = new PrismaClient({
    datasources: { db: { url: requireUrl('CHECKOUT_DATABASE_URL') } },
  });
  const app = new PrismaClient({ datasources: { db: { url: requireUrl('APP_DATABASE_URL') } } });
  const admin = new PrismaClient({
    datasources: { db: { url: requireUrl('ADMIN_DATABASE_URL') } },
  });
  const ids = new UuidV7Generator();

  const vendorA = toVendorId(ids.generate());
  const vendorB = toVendorId(ids.generate());
  const NOW = new Date('2026-03-01T00:00:00.000Z');
  const inr = (minor: bigint | number): Money => Money.fromMinor(minor, 'INR');

  const postedSubOrderIds: string[] = [];

  const useCase = (client: PrismaClient): PostOrderPaymentJournalsUseCase =>
    new PostOrderPaymentJournalsUseCase({
      ledgerRepository: new PrismaLedgerRepository(client),
      idGenerator: ids,
    });

  /**
   * Posts a whole order's accounting the way `ConfirmPaymentUseCase` does —
   * inside one transaction on the checkout credential.
   */
  const post = async (
    subOrders: {
      subOrderId: string;
      vendorId: ReturnType<typeof toVendorId>;
      totalMinor: number;
      commissionMinor: number;
    }[],
    orderId = ids.generate(),
  ): Promise<void> => {
    for (const s of subOrders) postedSubOrderIds.push(s.subOrderId);
    await checkout.$transaction(async (tx) => {
      await useCase(tx as unknown as PrismaClient).execute(tx as unknown as never, {
        orderId,
        paymentAttemptId: ids.generate(),
        occurredAt: NOW,
        subOrders: subOrders.map((s) => ({
          subOrderId: s.subOrderId,
          vendorId: s.vendorId,
          total: inr(s.totalMinor),
          commissionLines: [
            { orderItemId: ids.generate(), commissionAmount: inr(s.commissionMinor) },
          ],
        })),
      });
    });
  };

  const newSubOrder = (
    vendorId: ReturnType<typeof toVendorId>,
    totalMinor: number,
    commissionMinor: number,
  ): {
    subOrderId: string;
    vendorId: ReturnType<typeof toVendorId>;
    totalMinor: number;
    commissionMinor: number;
  } => ({
    subOrderId: ids.generate(),
    vendorId,
    totalMinor,
    commissionMinor,
  });

  afterAll(async () => {
    // Owner-only cleanup: the triggers refuse DELETE, so this must disable
    // them for the teardown of test rows. Scoped to exactly the ids this
    // suite created.
    await owner.$executeRawUnsafe(
      'ALTER TABLE "ledger_entries" DISABLE TRIGGER "trg_ledger_entries_immutable"',
    );
    await owner.$executeRawUnsafe(
      'ALTER TABLE "ledger_journals" DISABLE TRIGGER "trg_ledger_journals_immutable"',
    );
    await owner.ledgerEntry.deleteMany({
      where: { journal: { subOrderId: { in: postedSubOrderIds } } },
    });
    await owner.ledgerJournal.deleteMany({ where: { subOrderId: { in: postedSubOrderIds } } });
    await owner.$executeRawUnsafe(
      'ALTER TABLE "ledger_entries" ENABLE TRIGGER "trg_ledger_entries_immutable"',
    );
    await owner.$executeRawUnsafe(
      'ALTER TABLE "ledger_journals" ENABLE TRIGGER "trg_ledger_journals_immutable"',
    );
    await Promise.all([
      owner.$disconnect(),
      checkout.$disconnect(),
      app.$disconnect(),
      admin.$disconnect(),
    ]);
  });

  describe('posting a single-vendor payment', () => {
    it('writes two journals and four entries', async () => {
      const s = newSubOrder(vendorA, 29_800, 2_980);
      await post([s]);

      expect(await owner.ledgerJournal.count({ where: { subOrderId: s.subOrderId } })).toBe(2);
      expect(
        await owner.ledgerEntry.count({ where: { journal: { subOrderId: s.subOrderId } } }),
      ).toBe(4);
    });

    it('balances: SUM(debit) = SUM(credit), summed by PostgreSQL', async () => {
      const s = newSubOrder(vendorA, 12_345, 1_234);
      await post([s]);

      const [row] = await owner.$queryRawUnsafe<{ debit: bigint; credit: bigint }[]>(
        `SELECT
           COALESCE(SUM(e.amount_minor) FILTER (WHERE e.direction = 'DEBIT'), 0)::bigint  AS debit,
           COALESCE(SUM(e.amount_minor) FILTER (WHERE e.direction = 'CREDIT'), 0)::bigint AS credit
         FROM ledger_entries e
         JOIN ledger_journals j ON j.id = e.journal_id
         WHERE j.sub_order_id = $1::uuid`,
        s.subOrderId,
      );

      expect(row?.debit).toBe(row?.credit);
      expect(row?.debit).toBe(BigInt(12_345 + 1_234));
    });

    it('stores amounts as exact integer minor units', async () => {
      const s = newSubOrder(vendorA, 999_999_999, 1);
      await post([s]);

      const entry = await owner.ledgerEntry.findFirst({
        where: { journal: { subOrderId: s.subOrderId }, accountCode: 'GATEWAY_CLEARING' },
      });
      expect(entry?.amountMinor).toBe(999_999_999n);
      expect(typeof entry?.amountMinor).toBe('bigint');
    });

    it('leaves the vendor a net payable of total minus commission', async () => {
      const s = newSubOrder(vendorA, 50_000, 5_000);
      await post([s]);

      const [row] = await owner.$queryRawUnsafe<{ net: bigint }[]>(
        `SELECT COALESCE(SUM(CASE WHEN e.direction='DEBIT' THEN e.amount_minor ELSE -e.amount_minor END),0)::bigint AS net
         FROM ledger_entries e JOIN ledger_journals j ON j.id = e.journal_id
         WHERE j.sub_order_id = $1::uuid AND e.account_code = 'VENDOR_PAYABLE'`,
        s.subOrderId,
      );

      expect(row?.net).toBe(-(50_000n - 5_000n));
    });
  });

  describe('multi-vendor accounting (locked decision 4)', () => {
    it('keeps each vendor’s postings independently traceable under one order', async () => {
      const orderId = ids.generate();
      const a = newSubOrder(vendorA, 60_000, 6_000);
      const b = newSubOrder(vendorB, 40_000, 6_000);
      await post([a, b], orderId);

      const journals = await owner.ledgerJournal.findMany({ where: { orderId } });
      expect(journals).toHaveLength(4);
      expect(journals.filter((j) => j.vendorId === vendorA)).toHaveLength(2);
      expect(journals.filter((j) => j.vendorId === vendorB)).toHaveLength(2);
    });

    it('never places two vendors’ payables in one journal', async () => {
      const orderId = ids.generate();
      await post(
        [newSubOrder(vendorA, 60_000, 6_000), newSubOrder(vendorB, 40_000, 6_000)],
        orderId,
      );

      const rows = await owner.$queryRawUnsafe<{ journal_id: string; vendors: bigint }[]>(
        `SELECT j.id AS journal_id, COUNT(DISTINCT e.vendor_id) AS vendors
         FROM ledger_journals j JOIN ledger_entries e ON e.journal_id = j.id
         WHERE j.order_id = $1::uuid AND e.vendor_id IS NOT NULL
         GROUP BY j.id`,
        orderId,
      );

      expect(rows.every((row) => Number(row.vendors) === 1)).toBe(true);
    });

    it('balances across the whole multi-vendor order', async () => {
      const orderId = ids.generate();
      await post(
        [newSubOrder(vendorA, 60_000, 6_000), newSubOrder(vendorB, 40_000, 4_000)],
        orderId,
      );

      const [row] = await owner.$queryRawUnsafe<{ debit: bigint; credit: bigint }[]>(
        `SELECT
           COALESCE(SUM(e.amount_minor) FILTER (WHERE e.direction='DEBIT'),0)::bigint  AS debit,
           COALESCE(SUM(e.amount_minor) FILTER (WHERE e.direction='CREDIT'),0)::bigint AS credit
         FROM ledger_entries e JOIN ledger_journals j ON j.id = e.journal_id
         WHERE j.order_id = $1::uuid`,
        orderId,
      );

      expect(row?.debit).toBe(row?.credit);
      expect(row?.debit).toBe(110_000n);
    });
  });

  describe('idempotency — a replayed confirmation cannot double-post', () => {
    it('refuses a second posting for the same sub-order and kind', async () => {
      const s = newSubOrder(vendorA, 29_800, 2_980);
      await post([s]);

      // Prisma reports the violation without naming the index
      // ("Unique constraint failed on the (not available)"), so the assertion
      // matches its wording rather than the constraint's.
      await expect(post([s])).rejects.toThrow(/Unique constraint failed/i);
    });

    it('leaves exactly the original journals after the refused replay', async () => {
      const s = newSubOrder(vendorA, 11_100, 1_110);
      await post([s]);
      await expect(post([s])).rejects.toThrow();

      expect(await owner.ledgerJournal.count({ where: { subOrderId: s.subOrderId } })).toBe(2);
      expect(
        await owner.ledgerEntry.count({ where: { journal: { subOrderId: s.subOrderId } } }),
      ).toBe(4);
    });

    it('rolls the whole posting back when one sub-order in a multi-vendor order collides', async () => {
      const a = newSubOrder(vendorA, 60_000, 6_000);
      await post([a]);

      const b = newSubOrder(vendorB, 40_000, 4_000);
      // `a` is already posted; the transaction must abort as a whole, so `b`
      // must not be left behind.
      await expect(post([a, b])).rejects.toThrow();

      expect(await owner.ledgerJournal.count({ where: { subOrderId: b.subOrderId } })).toBe(0);
    });
  });

  describe('append-only enforcement', () => {
    it('refuses UPDATE on a journal, even as the owner', async () => {
      const s = newSubOrder(vendorA, 20_000, 2_000);
      await post([s]);

      await expect(
        owner.$executeRawUnsafe(
          `UPDATE ledger_journals SET currency = 'USD' WHERE sub_order_id = $1::uuid`,
          s.subOrderId,
        ),
      ).rejects.toThrow(/append-only/i);
    });

    it('refuses DELETE on a journal, even as the owner', async () => {
      const s = newSubOrder(vendorA, 20_000, 2_000);
      await post([s]);

      await expect(
        owner.$executeRawUnsafe(
          `DELETE FROM ledger_journals WHERE sub_order_id = $1::uuid`,
          s.subOrderId,
        ),
      ).rejects.toThrow(/append-only/i);
    });

    it('refuses UPDATE and DELETE on an entry', async () => {
      const s = newSubOrder(vendorA, 20_000, 2_000);
      await post([s]);

      await expect(
        owner.$executeRawUnsafe(
          `UPDATE ledger_entries SET amount_minor = 1 WHERE journal_id IN (SELECT id FROM ledger_journals WHERE sub_order_id = $1::uuid)`,
          s.subOrderId,
        ),
      ).rejects.toThrow(/append-only/i);
      await expect(
        owner.$executeRawUnsafe(
          `DELETE FROM ledger_entries WHERE journal_id IN (SELECT id FROM ledger_journals WHERE sub_order_id = $1::uuid)`,
          s.subOrderId,
        ),
      ).rejects.toThrow(/append-only/i);
    });

    it('refuses a non-positive amount at the database', async () => {
      await expect(
        owner.$executeRawUnsafe(
          `INSERT INTO ledger_entries (id, journal_id, account_code, direction, amount_minor, currency)
           SELECT $1::uuid, j.id, 'GATEWAY_CLEARING', 'DEBIT', 0, 'INR' FROM ledger_journals j LIMIT 1`,
          ids.generate(),
        ),
      ).rejects.toThrow(/chk_ledger_entries_amount_positive/);
    });
  });

  describe('role separation and RLS', () => {
    it('has row security enabled on both tables', async () => {
      const rows = await owner.$queryRaw<{ tablename: string; rowsecurity: boolean }[]>`
        SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname='public' AND tablename IN ('ledger_journals','ledger_entries')
        ORDER BY tablename`;

      expect(rows.map((r) => r.rowsecurity)).toEqual([true, true]);
    });

    it('grants the two read-only roles exactly SELECT', async () => {
      const rows = await owner.$queryRaw<{ grantee: string; privilege_type: string }[]>`
        SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_name IN ('ledger_journals','ledger_entries')
          AND grantee IN ('leenmart_app','leenmart_admin')
        ORDER BY grantee, privilege_type`;

      expect(new Set(rows.map((r) => r.privilege_type))).toEqual(new Set(['SELECT']));
    });

    it('grants the checkout role only SELECT and INSERT — never UPDATE or DELETE', async () => {
      const rows = await owner.$queryRaw<{ privilege_type: string }[]>`
        SELECT DISTINCT privilege_type FROM information_schema.role_table_grants
        WHERE table_name IN ('ledger_journals','ledger_entries') AND grantee = 'leenmart_checkout'
        ORDER BY privilege_type`;

      expect(rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);
    });

    it('lets a vendor read only their own journals', async () => {
      const a = newSubOrder(vendorA, 60_000, 6_000);
      const b = newSubOrder(vendorB, 40_000, 4_000);
      await post([a, b]);

      const seenByA = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.vendor_id', ${vendorA}, TRUE)`;
        return tx.$queryRawUnsafe<{ sub_order_id: string }[]>(
          `SELECT sub_order_id FROM ledger_journals WHERE sub_order_id IN ($1::uuid, $2::uuid)`,
          a.subOrderId,
          b.subOrderId,
        );
      });

      expect(seenByA.every((row) => row.sub_order_id === a.subOrderId)).toBe(true);
      expect(seenByA.length).toBeGreaterThan(0);
    });

    it('hides another vendor’s entries too, not just the journal header', async () => {
      const b = newSubOrder(vendorB, 40_000, 4_000);
      await post([b]);

      const seenByA = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.vendor_id', ${vendorA}, TRUE)`;
        return tx.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT count(*) AS count FROM ledger_entries e
           JOIN ledger_journals j ON j.id = e.journal_id
           WHERE j.sub_order_id = $1::uuid`,
          b.subOrderId,
        );
      });

      expect(Number(seenByA[0]?.count)).toBe(0);
    });

    it('returns nothing to a vendor connection with no tenant context', async () => {
      const s = newSubOrder(vendorA, 10_000, 1_000);
      await post([s]);

      const rows = await app.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM ledger_journals WHERE sub_order_id = $1::uuid`,
        s.subOrderId,
      );

      expect(Number(rows[0]?.count)).toBe(0);
    });

    it('refuses a vendor INSERT outright — no grant exists', async () => {
      await expect(
        app.$executeRawUnsafe(
          `INSERT INTO ledger_journals (id, kind, order_id, sub_order_id, payment_attempt_id, vendor_id, currency, occurred_at)
           VALUES ($1::uuid,'PAYMENT_CAPTURED',$2::uuid,$3::uuid,$4::uuid,$5::uuid,'INR',now())`,
          ids.generate(),
          ids.generate(),
          ids.generate(),
          ids.generate(),
          vendorA,
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('refuses a vendor UPDATE and DELETE outright', async () => {
      const s = newSubOrder(vendorA, 10_000, 1_000);
      await post([s]);

      await expect(
        app.$executeRawUnsafe(
          `UPDATE ledger_journals SET currency='USD' WHERE sub_order_id=$1::uuid`,
          s.subOrderId,
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        app.$executeRawUnsafe(
          `DELETE FROM ledger_journals WHERE sub_order_id=$1::uuid`,
          s.subOrderId,
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('lets the admin credential read across vendors but never write', async () => {
      const orderId = ids.generate();
      await post(
        [newSubOrder(vendorA, 60_000, 6_000), newSubOrder(vendorB, 40_000, 4_000)],
        orderId,
      );

      const rows = await admin.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM ledger_journals WHERE order_id = $1::uuid`,
        orderId,
      );
      expect(Number(rows[0]?.count)).toBe(4);

      await expect(
        admin.$executeRawUnsafe(
          `UPDATE ledger_journals SET currency='USD' WHERE order_id=$1::uuid`,
          orderId,
        ),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
