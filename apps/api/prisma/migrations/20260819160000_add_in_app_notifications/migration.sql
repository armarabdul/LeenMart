-- In-app notifications (S6-NOTIFY-INAPP, SDD 5 module 16, SDD 11.1/11.2/11.3).
--
-- The first real consumer of the S5-OUTBOX relay. Producers already write
-- `outbox_events` inside the business transaction; the relay hands each event
-- to `NotificationOutboxHandler`, which enqueues, and the BullMQ worker's
-- orchestrator writes the rows below. Nothing in this milestone talks to an
-- external provider: in-app is the only channel (SDD 11.2 marks it ● for every
-- transactional row), so there is no SES, SMS/DLT or Web Push here.
--
-- Locked decisions this transcribes:
--   * four mappings only — order.confirmed/payment_failed/cancelled to the
--     CUSTOMER, order.placed to the order's VENDORS ("New order (vendor)",
--     SDD 11.2). The other six event types stay in `outbox_events` unconsumed.
--   * user-scoped, not vendor-scoped: `recipient_user_id` is the anchor, and
--     `recipient_kind` is what keeps a vendor's inbox distinct from the same
--     person's customer inbox.
--   * read/unread is `read_at` alone. Opening a list never marks anything read.
--   * transactional only — no preferences, no quiet hours, no opt-out.
--
-- **Retention: notification records are kept 1 year** (SDD 22.5, BR-16/NFR-06).
-- The sweeper and partition archival are deliberately NOT built here; they are
-- a separate infrastructure milestone. This comment is the record of the
-- requirement so the number is not re-litigated later.

-- CreateEnum
CREATE TYPE "NotificationRecipientKind" AS ENUM ('CUSTOMER', 'VENDOR');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP');

-- CreateTable
-- Range-partitioned by month from day one (SDD 6.5: "cheap now, and impossible
-- to retrofit online later"), exactly as `audit_logs` and `outbox_events` are —
-- see 20260811233000 for the pattern this follows.
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipient_user_id" UUID NOT NULL,
    "recipient_kind" "NotificationRecipientKind" NOT NULL,
    "outbox_event_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "event_type" VARCHAR(150) NOT NULL,
    -- The originating event's own payload, kept verbatim. `title`/`body` are
    -- fixed application strings for v1 (FR-59 deferred); keeping the data means
    -- a later template can re-render from facts rather than parsing prose.
    "payload" JSONB NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(500) NOT NULL,
    -- Read/unread is this column and nothing else: NULL is unread.
    "read_at" TIMESTAMPTZ(6),

    -- `created_at` is in the key because PostgreSQL requires the partition key
    -- in every unique constraint on a partitioned table.
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");

CREATE TABLE "notifications_2026_08" PARTITION OF "notifications" FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "notifications_2026_09" PARTITION OF "notifications" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "notifications_2026_10" PARTITION OF "notifications" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "notifications_2026_11" PARTITION OF "notifications" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "notifications_2026_12" PARTITION OF "notifications" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE "notifications_2027_01" PARTITION OF "notifications" FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE "notifications_2027_02" PARTITION OF "notifications" FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE "notifications_2027_03" PARTITION OF "notifications" FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE "notifications_2027_04" PARTITION OF "notifications" FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE "notifications_2027_05" PARTITION OF "notifications" FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
-- Anything beyond the explicit months lands here rather than failing an
-- INSERT, the same safety valve `outbox_events` already has.
CREATE TABLE "notifications_default" PARTITION OF "notifications" DEFAULT;

-- AddForeignKey
-- `users` is one of the two shared identity anchors a foreign key may cross a
-- module boundary to reach (SDD 5.1/6.7). RESTRICT rather than CASCADE: a
-- notification is a record of something that was told to someone, and DPDP
-- erasure anonymises rather than deletes (SDD 22.5).
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_recipient_user_id_fkey"
    FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
-- The inbox query: this user's notifications, unread first, newest first.
CREATE INDEX "idx_notifications_recipient_inbox"
    ON "notifications"("recipient_user_id", "read_at", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- Idempotency (SDD 11.3: "consumers are idempotent on
-- `(event_id, channel, recipient)`").
--
-- **This constraint is NOT the global guarantee that sentence describes, and
-- pretending otherwise would be the dangerous reading.** PostgreSQL requires a
-- unique constraint on a partitioned table to contain the partition key, so
-- `created_at` is in the tuple below — which means two rows for the same
-- (event, channel, recipient) landing in *different months* would both be
-- accepted.
--
-- In practice a redelivery lands in the same month as the original (the relay's
-- whole attempt budget spans about six minutes), so this constraint does catch
-- every duplicate the system can actually produce. It is a backstop, not the
-- mechanism: the logical key is enforced in the application, where
-- `PrismaNotificationRepository.createIfAbsent` checks for an existing row on
-- the full logical key before inserting, and the BullMQ job carries a
-- deterministic id derived from the outbox event so a redelivered event
-- collapses onto the same job.
--
-- Monthly partitioning is required by SDD 6.5 and is not negotiable to obtain a
-- prettier constraint.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "uq_notifications_event_channel_recipient"
    ON "notifications"("outbox_event_id", "channel", "recipient_user_id", "created_at");

-- ---------------------------------------------------------------------------
-- Row-level security (SDD 6.6 layer 3).
--
-- The first **user-scoped** table in this codebase — every previous RLS table
-- is scoped by `app.vendor_id`. `app.user_id` is set by `tenantContext` for
-- every authenticated caller (and by `runWithTenant` in the worker), and the
-- `vendors` tenant-root policy already reads it, so the mechanism is not new
-- even though this use of it is.
--
--   leenmart_app      — the reader. SELECT and UPDATE, both confined to
--                       `recipient_user_id = app.user_id`. UPDATE is how a user
--                       marks their own notification read; there is no INSERT
--                       policy, so a user cannot manufacture a notification for
--                       themselves or anyone else.
--   leenmart_checkout — the writer. The orchestrator runs on this credential
--                       because it must resolve recipients across vendors and
--                       then insert rows for users it is not acting as; making
--                       insertion depend on `app.user_id` would mean the worker
--                       impersonating each recipient in turn. It is the same
--                       cross-vendor credential `PlaceOrderUseCase` already
--                       uses, and it gains no read of anyone's inbox beyond
--                       what the idempotency check needs.
--
-- No `leenmart_admin` policy: no authoritative requirement asks for an admin
-- view of a user's notifications, and this is personal data under DPDP. An
-- admin surface would have to add the policy deliberately.
--
-- leenmart_public gets nothing at all.
--
-- ENABLE only, never FORCE — FORCE subjects the owner to its own policies and
-- breaks migrations (20260812180000 documents this; `database-role-separation`
-- asserts `relforcerowsecurity` is zero platform-wide).
-- ---------------------------------------------------------------------------
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;

-- `ALTER DEFAULT PRIVILEGES` (20260812120000) grants new tables to
-- leenmart_app and leenmart_admin only, so the checkout role's grants are
-- explicit. It needs INSERT to write and SELECT for the idempotency check.
GRANT SELECT, INSERT ON "notifications" TO "leenmart_checkout";

CREATE POLICY "notifications_recipient_select" ON "notifications"
    FOR SELECT TO leenmart_app
    USING ("recipient_user_id" = nullif(current_setting('app.user_id', true), '')::uuid);

-- USING decides which rows may be updated; WITH CHECK decides what they may
-- become. Both are needed: without WITH CHECK a user could hand their own
-- notification to somebody else.
CREATE POLICY "notifications_recipient_update" ON "notifications"
    FOR UPDATE TO leenmart_app
    USING ("recipient_user_id" = nullif(current_setting('app.user_id', true), '')::uuid)
    WITH CHECK ("recipient_user_id" = nullif(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY "notifications_worker_insert" ON "notifications"
    FOR INSERT TO "leenmart_checkout" WITH CHECK (true);
CREATE POLICY "notifications_worker_select" ON "notifications"
    FOR SELECT TO "leenmart_checkout" USING (true);
