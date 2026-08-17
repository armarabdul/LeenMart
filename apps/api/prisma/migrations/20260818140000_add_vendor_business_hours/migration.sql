-- Vendor business hours and closures (S4-HOURS, SDD 5 module 3
-- `business_hours`; FR-27; SDD 4.2 step 4c; SDD 26 Stage 4).
--
-- Locked decisions this transcribes:
--   H1-A  a closed vendor blocks DELIVERY checkout outright
--   H2-A  enforcement applies to DELIVERY only; PICKUP is exempt
--   H3-C  both recurring weekly holidays and dated closures
--   H4-A  a vendor with NO business_hours rows is OPEN — the backward-
--         compatible default, so no existing vendor is taken offline by this
--         migration. That rule lives in the application layer
--         (`ResolveBusinessHoursUseCase`), not here.
--   ASM-01 IST only — no timezone column anywhere in this file.
--
-- Times are minutes since local midnight (0 = 00:00, 1440 = 24:00), never
-- timestamps: an integer cannot carry a timezone, which is precisely why it is
-- used. No overnight intervals — `open_minute < close_minute` is enforced.
--
-- Nothing here concerns slots, capacity, reservations or delivery charges;
-- those are S4-SLOTS and remain untouched.

-- CreateTable
CREATE TABLE "business_hours" (
    "vendor_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "open_minute" INTEGER NOT NULL,
    "close_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- The triple is the identity: a vendor cannot open twice at the same
    -- moment on the same weekday, so duplicates are impossible rather than
    -- merely discouraged.
    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("vendor_id", "weekday", "open_minute")
);

-- 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay()`.
ALTER TABLE "business_hours"
    ADD CONSTRAINT "business_hours_weekday_ck" CHECK ("weekday" BETWEEN 0 AND 6);

-- Minutes within a single day, and strictly ordered. `close_minute` may reach
-- 1440 (midnight) but `open_minute` may not, since a zero-length interval is
-- not an opening.
ALTER TABLE "business_hours"
    ADD CONSTRAINT "business_hours_minutes_ck" CHECK (
        "open_minute" >= 0
        AND "open_minute" < 1440
        AND "close_minute" > 0
        AND "close_minute" <= 1440
        AND "open_minute" < "close_minute"
    );

-- CreateIndex
CREATE INDEX "idx_business_hours_vendor_weekday" ON "business_hours"("vendor_id", "weekday");

-- AddForeignKey
-- Cascade, matching `serviceable_pincodes`: an operating schedule is
-- disposable configuration, not retained financial or audit history.
ALTER TABLE "business_hours"
    ADD CONSTRAINT "business_hours_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "business_hour_closures" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "weekday" INTEGER,
    "closed_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_hour_closures_pkey" PRIMARY KEY ("id")
);

-- Exactly one kind per row, discriminated by which column is populated rather
-- than by an enum the application would also have to keep in step.
ALTER TABLE "business_hour_closures"
    ADD CONSTRAINT "business_hour_closures_kind_ck" CHECK (
        ("weekday" IS NOT NULL AND "closed_on" IS NULL)
        OR ("weekday" IS NULL AND "closed_on" IS NOT NULL)
    );

ALTER TABLE "business_hour_closures"
    ADD CONSTRAINT "business_hour_closures_weekday_ck"
    CHECK ("weekday" IS NULL OR "weekday" BETWEEN 0 AND 6);

-- CreateIndex
-- Partial uniques rather than table-wide ones, because each kind uses a
-- different column — the same hand-written partial-index technique
-- `idx_addresses_one_default_per_user` already established (Prisma's DSL has
-- no WHERE clause for indexes).
CREATE UNIQUE INDEX "uq_business_hour_closures_vendor_weekday"
    ON "business_hour_closures"("vendor_id", "weekday") WHERE "weekday" IS NOT NULL;
CREATE UNIQUE INDEX "uq_business_hour_closures_vendor_date"
    ON "business_hour_closures"("vendor_id", "closed_on") WHERE "closed_on" IS NOT NULL;

CREATE INDEX "idx_business_hour_closures_vendor_weekday"
    ON "business_hour_closures"("vendor_id", "weekday");
CREATE INDEX "idx_business_hour_closures_vendor_date"
    ON "business_hour_closures"("vendor_id", "closed_on");

-- AddForeignKey
ALTER TABLE "business_hour_closures"
    ADD CONSTRAINT "business_hour_closures_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-level security (SDD 6.6 layer 3), the same dual-policy shape
-- `serviceable_pincodes` established in S4-SERV:
--
--   leenmart_app      — the vendor's own management path, scoped by
--                       vendor_id = app.vendor_id.
--   leenmart_checkout — the read PlaceOrderUseCase performs. USING(true),
--                       identical reasoning to `serviceable_pincodes_checkout_select`:
--                       a multi-vendor cart must evaluate vendors the caller
--                       has no tenant context for. SELECT only.
--
-- leenmart_public gets nothing: no authoritative requirement asks for
-- customer-facing display of business hours, so the public catalogue role has
-- no reason to read a vendor's operating schedule.
--
-- ENABLE only, never FORCE — FORCE subjects the table owner to its own
-- policies and breaks migrations (20260812180000 documents this, and the
-- database-role-separation suite asserts `relforcerowsecurity` is zero).
-- ---------------------------------------------------------------------------
ALTER TABLE "business_hours" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_hour_closures" ENABLE ROW LEVEL SECURITY;

-- `ALTER DEFAULT PRIVILEGES` (20260812120000) grants new tables to
-- leenmart_app and leenmart_admin only, so the checkout role's grant is
-- explicit — exactly as it was for `serviceable_pincodes`.
GRANT SELECT ON "business_hours" TO "leenmart_checkout";
GRANT SELECT ON "business_hour_closures" TO "leenmart_checkout";

-- CreatePolicy — business_hours
CREATE POLICY "business_hours_vendor_select" ON "business_hours"
    FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "business_hours_vendor_insert" ON "business_hours"
    FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "business_hours_vendor_delete" ON "business_hours"
    FOR DELETE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "business_hours_checkout_select" ON "business_hours"
    FOR SELECT TO "leenmart_checkout" USING (true);
CREATE POLICY "business_hours_admin_read" ON "business_hours"
    FOR SELECT TO leenmart_admin USING (true);

-- CreatePolicy — business_hour_closures
CREATE POLICY "business_hour_closures_vendor_select" ON "business_hour_closures"
    FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "business_hour_closures_vendor_insert" ON "business_hour_closures"
    FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "business_hour_closures_vendor_delete" ON "business_hour_closures"
    FOR DELETE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "business_hour_closures_checkout_select" ON "business_hour_closures"
    FOR SELECT TO "leenmart_checkout" USING (true);
CREATE POLICY "business_hour_closures_admin_read" ON "business_hour_closures"
    FOR SELECT TO leenmart_admin USING (true);
