-- Audit log immutability (SDD 18.4: "UPDATE and DELETE are blocked by a trigger").
--
-- Hand-written, like `idx_addresses_one_default_per_user`: Prisma's schema DSL
-- cannot express functions or triggers, so this cannot be generated from
-- schema.prisma. It touches no column and no index — the `audit_logs` table
-- created by `20260807065349_leen_mart` is left exactly as it is.
--
-- Both schema.prisma and SDD 18.4 have described this control as already
-- existing since the first migration. It did not. This migration is the point
-- at which the claim becomes true, and it lands before the table holds a
-- single row: retrofitting an append-only guarantee onto a populated,
-- eight-year-retention legal record is a materially harder problem than
-- adding it to an empty one.

-- CreateFunction
CREATE OR REPLACE FUNCTION reject_audit_log_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only (SDD 18.4): % is not permitted. Corrections are new rows.', TG_OP
        USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;

-- CreateTrigger
-- Row-level, so the exception names the operation that was attempted and no
-- partial statement can slip through: BEFORE means the write is refused, not
-- rolled back after the fact.
CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW
    EXECUTE FUNCTION reject_audit_log_mutation();

-- CreateTrigger
-- TRUNCATE bypasses row-level triggers entirely, so the guard above would
-- leave the whole table erasable in one statement. Statement-level, because
-- TRUNCATE has no rows to fire per.
CREATE TRIGGER trg_audit_logs_no_truncate
    BEFORE TRUNCATE ON "audit_logs"
    FOR EACH STATEMENT
    EXECUTE FUNCTION reject_audit_log_mutation();
