import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';

/**
 * Structural integration test for SDD 6.4/6.5's monthly range partitioning of
 * `audit_logs` and `outbox_events`, against real PostgreSQL.
 *
 * Asserts the shape of the database rather than the behaviour of a use case,
 * which is unusual here and deliberate: partitioning is a property only the
 * database can hold, it is invisible from the application (every query reads
 * and writes exactly as before), and SDD 6.5 says it is "impossible to retrofit
 * online later" — so a regression that silently un-partitions a table would
 * otherwise be caught by nothing at all.
 */
describe('audit_logs / outbox_events partitioning (SDD 6.4/6.5)', () => {
  const prisma = new PrismaClient();
  const idGenerator = new UuidV7Generator();

  /** Rows written here can never be deleted — `audit_logs` is append-only (SDD 18.4). */
  const RUN_TAG = `partition-test-${Date.now()}`;

  afterAll(async () => {
    await prisma.outboxEvent.deleteMany({ where: { aggregateType: RUN_TAG } });
    await prisma.$disconnect();
  });

  const relkindOf = async (table: string): Promise<string> => {
    const rows = await prisma.$queryRawUnsafe<{ relkind: string }[]>(
      `SELECT c.relkind::text AS relkind
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1`,
      table,
    );
    return rows[0]?.relkind ?? 'missing';
  };

  const partitionsOf = async (table: string): Promise<string[]> => {
    const rows = await prisma.$queryRawUnsafe<{ relname: string }[]>(
      `SELECT c.relname
         FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = $1::regclass
        ORDER BY c.relname`,
      table,
    );
    return rows.map((row) => row.relname);
  };

  describe.each(['audit_logs', 'outbox_events'])('%s', (table) => {
    it('is a partitioned table, not an ordinary one', async () => {
      // 'p' is a partitioned table; 'r' is the ordinary table it used to be.
      expect(await relkindOf(table)).toBe('p');
    });

    it('is range-partitioned on created_at', async () => {
      const rows = await prisma.$queryRawUnsafe<{ strategy: string; key: string }[]>(
        `SELECT p.partstrat::text AS strategy,
                pg_get_partkeydef(c.oid) AS key
           FROM pg_partitioned_table p JOIN pg_class c ON c.oid = p.partrelid
          WHERE c.relname = $1`,
        table,
      );
      expect(rows[0]?.strategy).toBe('r');
      expect(rows[0]?.key).toBe('RANGE (created_at)');
    });

    it('has the thirteen monthly partitions plus a DEFAULT', async () => {
      const partitions = await partitionsOf(table);

      expect(partitions).toHaveLength(14);
      expect(partitions).toContain(`${table}_default`);
      // The authoring month and the twelfth month forward — the boundaries of
      // the approved window.
      expect(partitions).toContain(`${table}_2026_08`);
      expect(partitions).toContain(`${table}_2027_08`);
    });

    it('has a DEFAULT partition, so a write outside every declared range cannot fail', async () => {
      const rows = await prisma.$queryRawUnsafe<{ isdefault: boolean }[]>(
        `SELECT pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT' AS isdefault
           FROM pg_class c
          WHERE c.relname = $1`,
        `${table}_default`,
      );
      expect(rows[0]?.isdefault).toBe(true);
    });

    it('carries the created_at index SDD 6.4 requires', async () => {
      const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = $1`,
        table,
      );
      const names = rows.map((row) => row.indexname);
      expect(names).toContain(
        table === 'audit_logs' ? 'idx_audit_created_at' : 'idx_outbox_created_at',
      );
    });

    it('keys its primary key on (id, created_at), as a partitioned table must', async () => {
      const rows = await prisma.$queryRawUnsafe<{ def: string }[]>(
        `SELECT pg_get_constraintdef(oid) AS def
           FROM pg_constraint
          WHERE conrelid = $1::regclass AND contype = 'p'`,
        table,
      );
      expect(rows[0]?.def).toBe('PRIMARY KEY (id, created_at)');
    });
  });

  describe('row routing', () => {
    it('routes an outbox row into the partition matching its created_at', async () => {
      const id = idGenerator.generate();
      await prisma.outboxEvent.create({
        data: {
          id,
          aggregateType: RUN_TAG,
          aggregateId: idGenerator.generate(),
          eventType: 'PartitionRoutingProbe',
          payload: {},
          occurredAt: new Date('2026-09-15T00:00:00.000Z'),
          createdAt: new Date('2026-09-15T00:00:00.000Z'),
        },
      });

      const rows = await prisma.$queryRawUnsafe<{ part: string }[]>(
        `SELECT tableoid::regclass::text AS part FROM outbox_events WHERE id = $1::uuid`,
        id,
      );
      expect(rows[0]?.part).toBe('outbox_events_2026_09');
    });

    it('accepts a row far outside every declared range by routing it to DEFAULT', async () => {
      // The property that makes the fixed partition window safe: a write must
      // never fail merely because its month has no partition yet.
      const id = idGenerator.generate();
      await prisma.outboxEvent.create({
        data: {
          id,
          aggregateType: RUN_TAG,
          aggregateId: idGenerator.generate(),
          eventType: 'PartitionDefaultProbe',
          payload: {},
          occurredAt: new Date('2031-01-01T00:00:00.000Z'),
          createdAt: new Date('2031-01-01T00:00:00.000Z'),
        },
      });

      const rows = await prisma.$queryRawUnsafe<{ part: string }[]>(
        `SELECT tableoid::regclass::text AS part FROM outbox_events WHERE id = $1::uuid`,
        id,
      );
      expect(rows[0]?.part).toBe('outbox_events_default');
    });
  });

  describe('audit_logs immutability survives partitioning (SDD 18.4)', () => {
    it('still refuses UPDATE and DELETE on the parent', async () => {
      await expect(
        prisma.$executeRawUnsafe(`UPDATE audit_logs SET reason = 'tampered'`),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM audit_logs`)).rejects.toThrow(
        /append-only/,
      );
    });

    it('refuses UPDATE and DELETE issued directly against a partition', async () => {
      // BEFORE ROW triggers are cloned onto partitions by PostgreSQL, so
      // reaching past the parent does not get around the guard.
      await expect(
        prisma.$executeRawUnsafe(`UPDATE audit_logs_default SET reason = 'tampered'`),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM audit_logs_default`)).rejects.toThrow(
        /append-only/,
      );
    });

    it('refuses TRUNCATE on the parent and on every partition individually', async () => {
      // The regression this guards: statement-level TRUNCATE triggers are NOT
      // cloned to partitions, so a guard on the parent alone would have left
      // one erasable entry point per partition — partitioning would have
      // *weakened* the append-only guarantee rather than preserving it.
      await expect(prisma.$executeRawUnsafe(`TRUNCATE audit_logs`)).rejects.toThrow(/append-only/);

      const partitions = await partitionsOf('audit_logs');
      expect(partitions.length).toBeGreaterThan(0);
      for (const partition of partitions) {
        await expect(prisma.$executeRawUnsafe(`TRUNCATE ${partition}`)).rejects.toThrow(
          /append-only/,
        );
      }
    });

    it('guards every partition, so none was left without a trigger', async () => {
      const rows = await prisma.$queryRawUnsafe<{ relname: string; tgname: string }[]>(
        `SELECT c.relname, t.tgname
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal
            AND (c.relname = 'audit_logs' OR c.relname LIKE 'audit_logs\\_%')`,
      );

      const partitions = await partitionsOf('audit_logs');
      for (const relation of ['audit_logs', ...partitions]) {
        const forRelation = rows.filter((row) => row.relname === relation).map((row) => row.tgname);
        expect(forRelation).toContain('trg_audit_logs_immutable');
        expect(forRelation).toContain('trg_audit_logs_no_truncate');
      }
    });
  });

  describe('existing behaviour is unchanged', () => {
    it('still reads back rows written before the partitioning migration', async () => {
      // Decision 1: every pre-existing row was preserved, not discarded.
      const total = await prisma.auditLog.count();
      expect(total).toBeGreaterThan(0);
    });

    it('prunes partitions on a created_at range query', async () => {
      const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT * FROM outbox_events
          WHERE created_at >= '2026-09-01' AND created_at < '2026-10-01'`,
      );
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');

      // The point of partitioning by created_at: a month-scoped scan must not
      // touch the other partitions.
      expect(text).not.toContain('outbox_events_2027_08');
      expect(text).not.toContain('outbox_events_2026_12');
    });
  });
});
