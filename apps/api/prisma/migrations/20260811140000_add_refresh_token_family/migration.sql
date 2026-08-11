-- Refresh-token session families (SDD 7.2: on reuse detection, "the entire
-- session family is revoked").
--
-- Added in four steps rather than one `ADD COLUMN ... NOT NULL`, because the
-- table already holds rows and every one of them belongs to some lineage that
-- must be preserved: a blanket default would silently collapse or scatter
-- existing families, and the whole point of the column is that its grouping
-- is correct.

-- AlterTable: nullable first, so existing rows can be backfilled before the
-- constraint is applied.
ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" UUID;

-- Backfill, preserving existing lineage.
--
-- Rotation is recorded forward: an exchanged token points at its replacement
-- via `replaced_by_id`. So a family's root is a row nothing else points to,
-- and walking `replaced_by_id` from each root reaches every descendant. Each
-- row is stamped with its root's id — the same value `Session.issue()` now
-- assigns a fresh login.
--
-- The alternative, defaulting every row to its own id, would be simpler and
-- wrong: it would split each live chain into singleton families, so a reuse
-- detected on a pre-existing token would revoke only itself and leave the
-- thief's descendant alive — exactly the hole this migration exists to close.
--
-- CYCLE is a guard, not an expectation. Chains are append-only and built from
-- fresh UUIDv7 ids, so a loop should be impossible; if data ever contradicts
-- that, the recursion terminates and the offending rows fall through to the
-- safety net below instead of hanging the migration.
WITH RECURSIVE lineage(root_id, node_id) AS (
        SELECT r."id", r."id"
        FROM "refresh_tokens" r
        WHERE NOT EXISTS (
            SELECT 1 FROM "refresh_tokens" p WHERE p."replaced_by_id" = r."id"
        )
    UNION ALL
        SELECT l.root_id, child."id"
        FROM lineage l
        JOIN "refresh_tokens" parent ON parent."id" = l.node_id
        JOIN "refresh_tokens" child ON child."id" = parent."replaced_by_id"
) CYCLE node_id SET is_cycle USING path
UPDATE "refresh_tokens" t
SET "family_id" = l.root_id
FROM lineage l
WHERE t."id" = l.node_id AND NOT l.is_cycle;

-- Safety net: any row the walk could not place (an orphan, or a row dropped by
-- the cycle guard) becomes its own family root. Conservative by design — an
-- over-narrow family can only under-revoke, never revoke someone else's
-- session.
UPDATE "refresh_tokens" SET "family_id" = "id" WHERE "family_id" IS NULL;

-- AlterTable: now that every row has a family, make it an invariant. Every
-- session belongs to exactly one lineage, so the column is never nullable.
ALTER TABLE "refresh_tokens" ALTER COLUMN "family_id" SET NOT NULL;

-- CreateIndex: this is what makes reuse detection one statement instead of a
-- chain walk whose length an attacker controls.
CREATE INDEX "idx_refresh_tokens_family" ON "refresh_tokens"("family_id");
