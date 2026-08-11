-- Range-partition `audit_logs` and `outbox_events` by month (SDD 6.4/6.5).
--
-- SDD 6.5: "Declarative range partitioning by month on audit_logs,
-- outbox_events ... from day one — cheap now, and impossible to retrofit
-- online later." SDD 6.4 names the partition key for both: `(created_at)`.
--
-- Hand-written, like `20260811120000_audit_log_immutability` and the partial
-- unique index in `20260811090214_add_address`: Prisma's schema DSL cannot
-- express PARTITION BY, partition bounds, functions or triggers. schema.prisma
-- describes the resulting shape so the generated client stays accurate.
--
-- WHY THIS IS NOT AN "ONLINE" MIGRATION, AND WHY THAT IS ACCEPTABLE HERE
-- ---------------------------------------------------------------------
-- PostgreSQL cannot convert a populated ordinary table into a partitioned one
-- in place. The only path is: build the partitioned table alongside, copy the
-- rows, drop the original, rename. That is exactly the operation SDD 6.5 warns
-- becomes impossible later — it takes an ACCESS EXCLUSIVE lock and rewrites
-- every row. It is cheap today because no production database exists and the
-- two tables hold only development and test fixtures. It will not be cheap
-- once `audit_logs` holds eight years of legally significant records, which is
-- the entire reason this lands now rather than "when we need it".
--
-- THE PRIMARY KEY NECESSARILY CHANGES
-- -----------------------------------
-- PostgreSQL requires every unique or primary key on a partitioned table to
-- include all partition-key columns, so `(id)` becomes `(id, created_at)` on
-- both tables. This is a constraint of the feature, not a design decision.
-- `id` remains the domain identity: no repository query looks either table up
-- by primary key (`PrismaAuditLogRepository` only ever calls `create` and two
-- `findMany`s; `outbox_events` has no consumer at all), so no application code
-- observes the change.
--
-- PARTITION WINDOW
-- ----------------
-- Thirteen monthly partitions, 2026-08 through 2027-08 — the month this
-- migration was authored plus twelve forward — and a DEFAULT partition on each
-- table. Bounds are literal rather than computed from CURRENT_DATE so that
-- every environment that replays this migration gets byte-identical structure,
-- whenever it runs.
--
-- The DEFAULT partition is what makes the fixed window safe: a row whose
-- `created_at` falls outside every declared range is routed there instead of
-- failing. For `audit_logs` that property is load-bearing — an audit write
-- must never be rejected merely because next month's partition does not exist
-- yet. It also receives the preserved historical rows below, whose timestamps
-- (2025-06 to 2026-03) predate the window. That is harmless: partitions added
-- in future will be forward-dated and cannot overlap them.
--
-- Creating partitions on an ongoing basis is deliberately NOT part of this
-- migration. SDD 6.5 specifies the partitioning but names no scheduler, and
-- `pg_partman` appears nowhere in the SDD. That is separately scoped work.
-- Until it exists, the DEFAULT partition is the safety net.

-- ---------------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------------

-- The immutability triggers (SDD 18.4) exist precisely to stop rows leaving
-- this table, so they must come off before it can be replaced. They are
-- restored at the end of this file, on the new parent AND on every partition —
-- see the note there, which is not merely a restoration but a correction.
DROP TRIGGER IF EXISTS "trg_audit_logs_immutable" ON "audit_logs";
DROP TRIGGER IF EXISTS "trg_audit_logs_no_truncate" ON "audit_logs";

ALTER TABLE "audit_logs" RENAME TO "audit_logs_pre_partition";
ALTER INDEX "audit_logs_pkey" RENAME TO "audit_logs_pre_partition_pkey";
ALTER INDEX "idx_audit_actor" RENAME TO "idx_audit_actor_pre_partition";
ALTER INDEX "idx_audit_entity" RENAME TO "idx_audit_entity_pre_partition";
ALTER INDEX "idx_audit_created_at" RENAME TO "idx_audit_created_at_pre_partition";

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" VARCHAR(50) NOT NULL,
    "impersonated_by" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip_address" INET,
    "user_agent" TEXT,
    "request_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

CREATE TABLE "audit_logs_2026_08" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "audit_logs_2026_09" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "audit_logs_2026_10" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "audit_logs_2026_11" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "audit_logs_2026_12" PARTITION OF "audit_logs" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE "audit_logs_2027_01" PARTITION OF "audit_logs" FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE "audit_logs_2027_02" PARTITION OF "audit_logs" FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE "audit_logs_2027_03" PARTITION OF "audit_logs" FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE "audit_logs_2027_04" PARTITION OF "audit_logs" FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE "audit_logs_2027_05" PARTITION OF "audit_logs" FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE "audit_logs_2027_06" PARTITION OF "audit_logs" FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE "audit_logs_2027_07" PARTITION OF "audit_logs" FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE "audit_logs_2027_08" PARTITION OF "audit_logs" FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE "audit_logs_default" PARTITION OF "audit_logs" DEFAULT;

-- Declared on the parent, which propagates each index to every partition,
-- present and future. Same three indexes as before the rewrite.
CREATE INDEX "idx_audit_actor" ON "audit_logs"("actor_id", "created_at");
CREATE INDEX "idx_audit_entity" ON "audit_logs"("entity_type", "entity_id", "created_at");
CREATE INDEX "idx_audit_created_at" ON "audit_logs"("created_at");

-- Preserve every existing row. Columns are listed explicitly rather than using
-- `SELECT *` so a future column added to one table but not the other fails
-- loudly here instead of silently shifting values into the wrong column.
INSERT INTO "audit_logs" (
    "id", "actor_id", "actor_role", "impersonated_by", "action", "entity_type",
    "entity_id", "before", "after", "reason", "ip_address", "user_agent",
    "request_id", "created_at"
)
SELECT
    "id", "actor_id", "actor_role", "impersonated_by", "action", "entity_type",
    "entity_id", "before", "after", "reason", "ip_address", "user_agent",
    "request_id", "created_at"
FROM "audit_logs_pre_partition";

-- Refuses to proceed if a single row failed to copy. An audit trail that
-- silently lost rows during a structural migration would be worthless as
-- evidence, which is the one thing this table exists to be.
DO $$
DECLARE
    copied BIGINT;
    original BIGINT;
BEGIN
    SELECT count(*) INTO copied FROM "audit_logs";
    SELECT count(*) INTO original FROM "audit_logs_pre_partition";
    IF copied <> original THEN
        RAISE EXCEPTION
            'audit_logs partition migration copied % of % rows; aborting rather than losing audit history.',
            copied, original;
    END IF;
END $$;

DROP TABLE "audit_logs_pre_partition";

-- ---------------------------------------------------------------------------
-- outbox_events
-- ---------------------------------------------------------------------------
-- Rebuilt through the same rename/copy/drop sequence as `audit_logs` rather
-- than a bare DROP + CREATE. The table is empty in every environment seen so
-- far, but "empty" is a fact about today's databases, not a guarantee about
-- whichever one replays this migration next; the copy costs nothing when there
-- is nothing to copy and keeps any row that does exist.

ALTER TABLE "outbox_events" RENAME TO "outbox_events_pre_partition";
ALTER INDEX "outbox_events_pkey" RENAME TO "outbox_events_pre_partition_pkey";
ALTER INDEX "idx_outbox_unprocessed" RENAME TO "idx_outbox_unprocessed_pre_partition";
ALTER INDEX "idx_outbox_aggregate" RENAME TO "idx_outbox_aggregate_pre_partition";

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" VARCHAR(150) NOT NULL,
    "payload" JSONB NOT NULL,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

CREATE TABLE "outbox_events_2026_08" PARTITION OF "outbox_events" FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "outbox_events_2026_09" PARTITION OF "outbox_events" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "outbox_events_2026_10" PARTITION OF "outbox_events" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "outbox_events_2026_11" PARTITION OF "outbox_events" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "outbox_events_2026_12" PARTITION OF "outbox_events" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE "outbox_events_2027_01" PARTITION OF "outbox_events" FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE "outbox_events_2027_02" PARTITION OF "outbox_events" FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE "outbox_events_2027_03" PARTITION OF "outbox_events" FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE "outbox_events_2027_04" PARTITION OF "outbox_events" FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE "outbox_events_2027_05" PARTITION OF "outbox_events" FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE "outbox_events_2027_06" PARTITION OF "outbox_events" FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE "outbox_events_2027_07" PARTITION OF "outbox_events" FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE "outbox_events_2027_08" PARTITION OF "outbox_events" FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE "outbox_events_default" PARTITION OF "outbox_events" DEFAULT;

CREATE INDEX "idx_outbox_unprocessed" ON "outbox_events"("processed_at", "occurred_at");
CREATE INDEX "idx_outbox_aggregate" ON "outbox_events"("aggregate_type", "aggregate_id");
-- SDD 6.4 lists `(created_at)` for this table; it was missing until now.
CREATE INDEX "idx_outbox_created_at" ON "outbox_events"("created_at");

INSERT INTO "outbox_events" (
    "id", "aggregate_type", "aggregate_id", "event_type", "payload", "metadata",
    "occurred_at", "processed_at", "attempts", "last_error", "created_at"
)
SELECT
    "id", "aggregate_type", "aggregate_id", "event_type", "payload", "metadata",
    "occurred_at", "processed_at", "attempts", "last_error", "created_at"
FROM "outbox_events_pre_partition";

DO $$
DECLARE
    copied BIGINT;
    original BIGINT;
BEGIN
    SELECT count(*) INTO copied FROM "outbox_events";
    SELECT count(*) INTO original FROM "outbox_events_pre_partition";
    IF copied <> original THEN
        RAISE EXCEPTION
            'outbox_events partition migration copied % of % rows; aborting.',
            copied, original;
    END IF;
END $$;

DROP TABLE "outbox_events_pre_partition";

-- ---------------------------------------------------------------------------
-- Restore audit_logs immutability (SDD 18.4)
-- ---------------------------------------------------------------------------
-- `reject_audit_log_mutation()` is untouched by this migration and is reused
-- exactly as `20260811120000_audit_log_immutability` defined it.

-- BEFORE ROW triggers declared on a partitioned parent are cloned by
-- PostgreSQL onto every partition, including partitions created later. So this
-- single statement blocks UPDATE and DELETE whether the caller targets the
-- parent or reaches past it to a partition directly.
CREATE TRIGGER "trg_audit_logs_immutable"
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW
    EXECUTE FUNCTION reject_audit_log_mutation();

-- Statement-level TRUNCATE triggers are NOT cloned to partitions — verified
-- against PostgreSQL 16.4, where `TRUNCATE <partition>` succeeded with the
-- guard present on the parent alone. Partitioning would therefore have
-- *weakened* SDD 18.4's append-only guarantee: the table would have gained one
-- erasable entry point per partition. Each partition gets its own guard, and
-- the parent keeps one so `TRUNCATE audit_logs` is refused before it cascades.
--
-- Consequence for the separately scoped partition-creation work: a new
-- partition arrives without this trigger, so whatever creates partitions must
-- add it. That is a stated dependency of that task, not an omission here.
CREATE TRIGGER "trg_audit_logs_no_truncate"
    BEFORE TRUNCATE ON "audit_logs"
    FOR EACH STATEMENT
    EXECUTE FUNCTION reject_audit_log_mutation();

DO $$
DECLARE
    partition_name TEXT;
BEGIN
    FOR partition_name IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE i.inhparent = '"audit_logs"'::regclass
    LOOP
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_mutation()',
            'trg_audit_logs_no_truncate', partition_name
        );
    END LOOP;
END $$;
