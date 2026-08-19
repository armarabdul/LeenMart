-- Relay state for the transactional outbox (S5-OUTBOX, SDD 11.1, IMP-04).
--
-- `outbox_events` has been written since S3-3A and read by nothing: 10 producers,
-- 0 consumers. The row already carries `processed_at`, `attempts` and
-- `last_error`, which is enough to record *what happened*. It carries nothing
-- that says *when to try again* or *when to stop trying*, so a relay built on it
-- today would retry a poisoned event every poll, forever.
--
-- Two nullable/defaulted columns close that, and nothing else changes:
--
--   next_attempt_at   when this event becomes claimable again. Set forward by
--                     the claim itself, so a relay that crashes mid-dispatch
--                     leaves the event to be retried after the backoff rather
--                     than immediately.
--   dead_lettered_at  the explicit terminal state. Derived-from-attempts would
--                     have worked, but "stopped trying" is a fact an operator
--                     queries directly, and an implicit one is a fact nobody
--                     can see.
--
-- No RLS and no grant changes: `outbox_events` is platform infrastructure with
-- no tenant column (it is deliberately absent from `TENANT_SCOPED_MODELS`), and
-- `leenmart_app` — the credential the worker runs on — already holds
-- SELECT/UPDATE here. `leenmart_checkout` keeps INSERT only: producers write,
-- the relay reads and marks, and neither gains the other's reach.
--
-- `outbox_events` is range-partitioned by month (20260811233000), so these
-- ALTERs are issued against the partitioned parent and cascade to every
-- existing and future partition.

ALTER TABLE "outbox_events"
    ADD COLUMN "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "outbox_events"
    ADD COLUMN "dead_lettered_at" TIMESTAMPTZ(6);

-- An event is either pending, processed, or dead-lettered — never processed and
-- dead-lettered at once. The database refuses the contradiction rather than
-- trusting the relay never to write it.
ALTER TABLE "outbox_events"
    ADD CONSTRAINT "outbox_events_terminal_state_ck"
    CHECK ("processed_at" IS NULL OR "dead_lettered_at" IS NULL);

-- The claim query's own index: due, not yet finished, oldest first. Partial, so
-- it holds only the working set — the same reasoning `idx_outbox_unprocessed`
-- already records, extended to the two new predicates the relay actually
-- filters on.
CREATE INDEX "idx_outbox_claimable"
    ON "outbox_events"("next_attempt_at", "occurred_at")
    WHERE "processed_at" IS NULL AND "dead_lettered_at" IS NULL;
