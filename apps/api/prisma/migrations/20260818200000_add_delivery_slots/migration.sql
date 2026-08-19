-- Vendor delivery/pickup slots and their capacity (S4-SLOTS, SDD 5 module 10
-- `delivery_slots` + `slot_capacity`; FR-27; SC-13; PERF-09; SDD 4.2 step 4c).
--
-- Locked decisions this transcribes:
--   S1   capacity is a vendor-defined integer per slot
--   S2   one sub-order consumes exactly one unit — never items, weight or volume
--   S3   vendor-defined arbitrary windows, recurring weekly; concrete rows are
--        materialised lazily at booking time, so there is no generator job and
--        no pre-generated horizon to keep swept
--   S4   PICKUP consumes capacity too (business hours stay DELIVERY-only, H2-A)
--   S5   capacity is consumed at successful placement, inside the existing
--        checkout transaction — no soft reservation, hence no TTL (S6/S7)
--   S8   cancellation releases one unit, mirroring the inventory restore
--   S9   no money column anywhere: delivery charges are out of scope (BR-10)
--   S12  correctness is the database's job alone — an atomic conditional UPDATE
--        against the CHECK below. No Redis counter, no reconciliation sweep.
--
-- Times are minutes since local midnight (0 = 00:00, 1440 = 24:00), never
-- timestamps — the same reasoning `business_hours` records: an integer cannot
-- carry a timezone, and the platform is IST-only (ASM-01). No overnight
-- windows: `start_minute < end_minute` is enforced.

-- CreateTable
-- The vendor's recurring weekly offer. One row per window per weekday; several
-- rows may share a weekday, which is how a vendor offers 07:00–09:00 and
-- 17:00–19:00 on the same day.
CREATE TABLE "delivery_slots" (
    "vendor_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- The triple is the identity, exactly as in `business_hours`: a vendor
    -- cannot offer two windows starting at the same minute on one weekday.
    CONSTRAINT "delivery_slots_pkey" PRIMARY KEY ("vendor_id", "weekday", "start_minute")
);

-- 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay()`.
ALTER TABLE "delivery_slots"
    ADD CONSTRAINT "delivery_slots_weekday_ck" CHECK ("weekday" BETWEEN 0 AND 6);

ALTER TABLE "delivery_slots"
    ADD CONSTRAINT "delivery_slots_minutes_ck" CHECK (
        "start_minute" >= 0
        AND "start_minute" < 1440
        AND "end_minute" > 0
        AND "end_minute" <= 1440
        AND "start_minute" < "end_minute"
    );

-- S1: a slot that admits nobody is not a slot. Zero would be indistinguishable
-- from "not offered", which the absence of a row already expresses.
ALTER TABLE "delivery_slots"
    ADD CONSTRAINT "delivery_slots_capacity_ck" CHECK ("capacity" >= 1);

-- CreateIndex
CREATE INDEX "idx_delivery_slots_vendor_weekday" ON "delivery_slots"("vendor_id", "weekday");

-- AddForeignKey
-- Cascade, matching `business_hours` and `serviceable_pincodes`: an operating
-- offer is disposable configuration, not retained financial or audit history.
ALTER TABLE "delivery_slots"
    ADD CONSTRAINT "delivery_slots_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
-- The concrete, dated counter — PERF-09's "precomputed slot rows with a
-- `booked` counter", materialised lazily (S3) rather than by a generator.
--
-- `capacity` is copied from the template when the row is first created and is
-- never re-read from it afterwards. That is deliberate: a vendor lowering
-- tomorrow's capacity must not retroactively invalidate bookings already
-- taken, and the same snapshot reasoning already governs `sub_orders`'
-- pickup-location and shop-name columns (S4-ADDR).
CREATE TABLE "slot_capacity" (
    "vendor_id" UUID NOT NULL,
    "slot_date" DATE NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "booked" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slot_capacity_pkey" PRIMARY KEY ("vendor_id", "slot_date", "start_minute")
);

ALTER TABLE "slot_capacity"
    ADD CONSTRAINT "slot_capacity_minutes_ck" CHECK (
        "start_minute" >= 0
        AND "start_minute" < 1440
        AND "end_minute" > 0
        AND "end_minute" <= 1440
        AND "start_minute" < "end_minute"
    );

-- **The correctness guarantee** (S12, SC-13, SDD 6.1 "the database is the last
-- line of correctness"). The application consumes capacity with a single
-- conditional UPDATE; this CHECK is what makes overbooking impossible even if
-- that statement were written wrongly, and what makes a release below zero
-- impossible even if a cancellation were replayed.
ALTER TABLE "slot_capacity"
    ADD CONSTRAINT "slot_capacity_booked_ck" CHECK ("booked" >= 0 AND "booked" <= "capacity");

ALTER TABLE "slot_capacity"
    ADD CONSTRAINT "slot_capacity_capacity_ck" CHECK ("capacity" >= 1);

-- CreateIndex
CREATE INDEX "idx_slot_capacity_vendor_date" ON "slot_capacity"("vendor_id", "slot_date");

-- AddForeignKey
-- RESTRICT, unlike `delivery_slots` above: this table records bookings that a
-- placed order points at, so it is not disposable while those orders exist —
-- the same reasoning `sub_orders`' own vendor FK already uses.
ALTER TABLE "slot_capacity"
    ADD CONSTRAINT "slot_capacity_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- The sub-order's immutable slot snapshot (S4-SLOTS scope item 11).
--
-- Nullable, and nullable permanently: every order placed before this migration
-- has no slot, and a vendor who offers no windows still takes orders (the same
-- backward-compatible default `serviceable_pincodes` and `business_hours` each
-- established — zero configured rows never blocks an existing vendor).
--
-- Snapshot columns, not a foreign key to `slot_capacity`: an order is immutable
-- evidence of what was agreed (SDD 6.3), and a vendor deleting or re-timing a
-- window must not rewrite where an existing order said to arrive.
-- ---------------------------------------------------------------------------
ALTER TABLE "sub_orders" ADD COLUMN "slot_date" DATE;
ALTER TABLE "sub_orders" ADD COLUMN "slot_start_minute" INTEGER;
ALTER TABLE "sub_orders" ADD COLUMN "slot_end_minute" INTEGER;

-- All three together or none at all: a half-populated snapshot would describe
-- a slot nobody can render.
ALTER TABLE "sub_orders"
    ADD CONSTRAINT "sub_orders_slot_ck" CHECK (
        ("slot_date" IS NULL AND "slot_start_minute" IS NULL AND "slot_end_minute" IS NULL)
        OR (
            "slot_date" IS NOT NULL
            AND "slot_start_minute" IS NOT NULL
            AND "slot_end_minute" IS NOT NULL
            AND "slot_start_minute" >= 0
            AND "slot_start_minute" < 1440
            AND "slot_end_minute" > 0
            AND "slot_end_minute" <= 1440
            AND "slot_start_minute" < "slot_end_minute"
        )
    );

-- ---------------------------------------------------------------------------
-- Row-level security (SDD 6.6 layer 3).
--
--   leenmart_app      — the vendor's own management path, scoped by
--                       vendor_id = app.vendor_id. Read-only on
--                       `slot_capacity`: a vendor may see how full a window is
--                       but may not edit the counter, because the counter is
--                       derived from orders rather than declared.
--   leenmart_checkout — reads both tables (a multi-vendor cart evaluates
--                       vendors this session has no tenant context for, hence
--                       USING(true), exactly as for `serviceable_pincodes` and
--                       `business_hours`) and, uniquely, **writes**
--                       `slot_capacity`: it materialises the dated row and
--                       moves `booked`. The precedent is `inventory`, whose
--                       `inventory_checkout_decrement` policy is the same
--                       shape for the same reason.
--
-- leenmart_public gets nothing: slot availability is a checkout-time question
-- asked by an authenticated customer, never part of the public catalogue.
--
-- ENABLE only, never FORCE — FORCE subjects the table owner to its own
-- policies and breaks migrations (20260812180000 documents this, and the
-- database-role-separation suite asserts `relforcerowsecurity` is zero).
-- ---------------------------------------------------------------------------
ALTER TABLE "delivery_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slot_capacity" ENABLE ROW LEVEL SECURITY;

-- `ALTER DEFAULT PRIVILEGES` (20260812120000) grants new tables to
-- leenmart_app and leenmart_admin only, so the checkout role's grants are
-- explicit. `slot_capacity` needs INSERT for the lazy materialisation and
-- UPDATE for the counter; `delivery_slots` is read-only to checkout.
GRANT SELECT ON "delivery_slots" TO "leenmart_checkout";
GRANT SELECT, INSERT, UPDATE ON "slot_capacity" TO "leenmart_checkout";

-- CreatePolicy — delivery_slots
CREATE POLICY "delivery_slots_vendor_select" ON "delivery_slots"
    FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "delivery_slots_vendor_insert" ON "delivery_slots"
    FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "delivery_slots_vendor_delete" ON "delivery_slots"
    FOR DELETE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "delivery_slots_checkout_select" ON "delivery_slots"
    FOR SELECT TO "leenmart_checkout" USING (true);
CREATE POLICY "delivery_slots_admin_read" ON "delivery_slots"
    FOR SELECT TO leenmart_admin USING (true);

-- CreatePolicy — slot_capacity
-- No vendor INSERT/UPDATE/DELETE policy: the counter belongs to checkout.
CREATE POLICY "slot_capacity_vendor_select" ON "slot_capacity"
    FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "slot_capacity_checkout_select" ON "slot_capacity"
    FOR SELECT TO "leenmart_checkout" USING (true);
CREATE POLICY "slot_capacity_checkout_insert" ON "slot_capacity"
    FOR INSERT TO "leenmart_checkout" WITH CHECK (true);
CREATE POLICY "slot_capacity_checkout_update" ON "slot_capacity"
    FOR UPDATE TO "leenmart_checkout" USING (true) WITH CHECK (true);
CREATE POLICY "slot_capacity_admin_read" ON "slot_capacity"
    FOR SELECT TO leenmart_admin USING (true);
