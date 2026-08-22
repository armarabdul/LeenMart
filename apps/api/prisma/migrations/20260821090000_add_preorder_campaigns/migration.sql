-- Preorder campaigns and reservations (SDD §14, "the flagship feature").
-- Phase Next discovery report, approved implementation baseline.
--
-- Locked decisions this transcribes:
--   P1  Campaign lifecycle is SDD §14.2 verbatim: DRAFT -> SCHEDULED -> OPEN
--       -> {SOLD_OUT | CLOSED | CANCELLED} -> FULFILLING ->
--       {COMPLETED | PARTIALLY_FULFILLED}. No invented states.
--   P2  Reservation states (PENDING/CONFIRMED/EXPIRED/PAYMENT_FAILED/
--       CANCELLED) are the discovery report's own approved, narrative-
--       grounded inference (SDD §14.3 gives no formal enum) -- kept isolated
--       to this module by design.
--   P3  `variant_id` is a plain uuid with NO foreign key -- `preorder` and
--       `catalogue` are different modules (SDD 5.1); existence/eligibility
--       is verified at the application layer, the same `cart_items
--       .variant_id` precedent (S3-1).
--   P4  No price column on the campaign -- the variant's own price is
--       resolved fresh and snapshotted onto each reservation, the same
--       `order_items` snapshot convention.
--   P5  `remaining_quantity` moves only through one atomic conditional
--       UPDATE, backed by a CHECK constraint -- the same `inventory
--       .available`/`slot_capacity.booked` idiom (SDD §14.4 layer 2).
--   P6  Reservations are customer-owned and written exclusively through
--       `leenmart_checkout`, mirroring `orders`' own original shape
--       (20260815120000) -- ownership enforced by the repository's own
--       `(id, customer_id)` scoping, not by a `leenmart_app` RLS policy on
--       this table.
--   P7  `vendor_id` is denormalised onto `preorder_reservations` (the same
--       `ledger_journals.vendor_id` technique, S3-7) so the vendor's own
--       demand-summary read is a direct RLS column comparison, not a
--       subquery through `preorder_campaigns` on every row.
--   P8  No refund call anywhere in this migration or the code built on it --
--       BR-06/07 remain unresolved; cancellation releases quantity only.

-- CreateEnum
CREATE TYPE "PreorderCampaignStatus" AS ENUM (
    'DRAFT', 'SCHEDULED', 'OPEN', 'SOLD_OUT', 'CLOSED', 'CANCELLED',
    'FULFILLING', 'COMPLETED', 'PARTIALLY_FULFILLED'
);

-- CreateEnum
CREATE TYPE "PreorderReservationStatus" AS ENUM (
    'PENDING', 'CONFIRMED', 'EXPIRED', 'PAYMENT_FAILED', 'CANCELLED'
);

-- CreateEnum
CREATE TYPE "PreorderFulfilmentMode" AS ENUM ('DELIVERY', 'PICKUP', 'BOTH');

-- CreateEnum
CREATE TYPE "PreorderPaymentAttemptKind" AS ENUM ('ADVANCE', 'BALANCE');

-- CreateEnum
CREATE TYPE "PreorderPaymentAttemptStatus" AS ENUM ('INITIATED', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "preorder_campaigns" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "status" "PreorderCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "opens_at" TIMESTAMPTZ(6) NOT NULL,
    "order_cutoff_at" TIMESTAMPTZ(6) NOT NULL,
    "fulfilment_window_start" TIMESTAMPTZ(6) NOT NULL,
    "fulfilment_window_end" TIMESTAMPTZ(6) NOT NULL,
    "total_quantity" INTEGER NOT NULL,
    "remaining_quantity" INTEGER NOT NULL,
    "advance_percent" INTEGER NOT NULL,
    "max_per_customer" INTEGER NOT NULL,
    "fulfilment_mode" "PreorderFulfilmentMode" NOT NULL,
    "first_reservation_confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "preorder_campaigns_pkey" PRIMARY KEY ("id")
);

-- P5: the oversell-prevention backstop -- the database makes overselling
-- impossible even if the application's conditional UPDATE were ever written
-- wrongly.
ALTER TABLE "preorder_campaigns" ADD CONSTRAINT "preorder_campaigns_quantity_ck"
    CHECK ("remaining_quantity" >= 0 AND "remaining_quantity" <= "total_quantity" AND "total_quantity" >= 1);

ALTER TABLE "preorder_campaigns" ADD CONSTRAINT "preorder_campaigns_advance_percent_ck"
    CHECK ("advance_percent" >= 0 AND "advance_percent" <= 100);

ALTER TABLE "preorder_campaigns" ADD CONSTRAINT "preorder_campaigns_max_per_customer_ck"
    CHECK ("max_per_customer" >= 1);

-- Windows: order_cutoff_at must not precede opens_at, and the fulfilment
-- window must be a real (non-empty, forward) interval that does not open
-- before the order cutoff.
ALTER TABLE "preorder_campaigns" ADD CONSTRAINT "preorder_campaigns_dates_ck"
    CHECK (
        "order_cutoff_at" >= "opens_at"
        AND "fulfilment_window_end" > "fulfilment_window_start"
        AND "fulfilment_window_start" >= "order_cutoff_at"
    );

-- CreateIndex
CREATE INDEX "idx_preorder_campaigns_vendor_status" ON "preorder_campaigns"("vendor_id", "status");
-- CreateIndex
-- The campaign-open sweep's own query shape (SCHEDULED campaigns whose
-- opens_at has passed).
CREATE INDEX "idx_preorder_campaigns_status_opens_at" ON "preorder_campaigns"("status", "opens_at");
-- CreateIndex
-- The campaign-close sweep's own query shape (OPEN campaigns whose
-- order_cutoff_at has passed).
CREATE INDEX "idx_preorder_campaigns_status_cutoff" ON "preorder_campaigns"("status", "order_cutoff_at");

-- AddForeignKey
-- RESTRICT, matching `slot_capacity`'s own reasoning: a campaign a customer
-- may hold a live reservation against is not disposable configuration.
ALTER TABLE "preorder_campaigns" ADD CONSTRAINT "preorder_campaigns_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "preorder_reservations" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "PreorderReservationStatus" NOT NULL DEFAULT 'PENDING',
    "unit_price_amount" BIGINT NOT NULL,
    "unit_price_currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "advance_amount" BIGINT NOT NULL,
    "balance_amount" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "balance_paid_at" TIMESTAMPTZ(6),
    "released_at" TIMESTAMPTZ(6),
    "converted_order_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "preorder_reservations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "preorder_reservations" ADD CONSTRAINT "preorder_reservations_quantity_ck"
    CHECK ("quantity" >= 1);

ALTER TABLE "preorder_reservations" ADD CONSTRAINT "preorder_reservations_amounts_ck"
    CHECK ("unit_price_amount" >= 0 AND "advance_amount" >= 0 AND "balance_amount" >= 0);

-- CreateIndex
-- The expiry sweep's own query shape.
CREATE INDEX "idx_preorder_reservations_status_expires" ON "preorder_reservations"("status", "expires_at");
-- CreateIndex
-- `max_per_customer` enforcement.
CREATE INDEX "idx_preorder_reservations_campaign_customer" ON "preorder_reservations"("campaign_id", "customer_id");
-- CreateIndex
CREATE INDEX "idx_preorder_reservations_campaign_status" ON "preorder_reservations"("campaign_id", "status");
-- CreateIndex
-- P7 -- the RLS policy's own comparison, and vendor-wide demand queries.
CREATE INDEX "idx_preorder_reservations_vendor_status" ON "preorder_reservations"("vendor_id", "status");
-- CreateIndex
CREATE INDEX "idx_preorder_reservations_customer_created" ON "preorder_reservations"("customer_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "preorder_reservations" ADD CONSTRAINT "preorder_reservations_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "preorder_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
-- `users` is a shared identity anchor (SDD 5.1/6.7) -- the one FK a
-- customer-owned row is always allowed.
ALTER TABLE "preorder_reservations" ADD CONSTRAINT "preorder_reservations_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "preorder_payment_attempts" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "kind" "PreorderPaymentAttemptKind" NOT NULL,
    "status" "PreorderPaymentAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "provider" VARCHAR(20) NOT NULL DEFAULT 'MOCK',
    "provider_reference" VARCHAR(100),
    "amount" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "preorder_payment_attempts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "preorder_payment_attempts" ADD CONSTRAINT "preorder_payment_attempts_amount_ck"
    CHECK ("amount" >= 0);

-- CreateIndex
CREATE INDEX "idx_preorder_payment_attempts_reservation" ON "preorder_payment_attempts"("reservation_id", "kind", "status");

-- AddForeignKey
ALTER TABLE "preorder_payment_attempts" ADD CONSTRAINT "preorder_payment_attempts_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "preorder_reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-level security (SDD 6.6 layer 3).
--
--   preorder_campaigns  -- vendor-owned, the same shape `delivery_slots`
--                        already establishes:
--     leenmart_app      full CRUD (no DELETE -- a campaign is cancelled, never
--                       hard-deleted), scoped to vendor_id = app.vendor_id.
--     leenmart_checkout reads every campaign (a reservation-creating customer
--                       has no vendor tenant) and, uniquely, UPDATEs
--                       remaining_quantity -- the P5 correctness path.
--     leenmart_public   reads every non-DRAFT campaign (SCHEDULED campaigns
--                       are publicly browsable for their countdown, per SDD
--                       §14.3's "Browse (countdown to opens_at)").
--     leenmart_admin    read-only (VIEW_PLATFORM... no: `CREATE_PREORDER_
--                       CAMPAIGN` grants SUPER_ADMIN READ_ONLY per the
--                       matrix).
--
--   preorder_reservations / preorder_payment_attempts -- customer-owned,
--   written exclusively through leenmart_checkout (P6), the same shape
--   `orders`/`sub_orders`/`order_items` originally shipped with
--   (20260815120000) before a later milestone added a vendor-read policy.
--   leenmart_app gets a vendor-scoped SELECT-only policy on
--   preorder_reservations (P7's denormalised vendor_id) for the demand-
--   summary read -- the same `ledger_journals_vendor_select` precedent
--   (S3-8) for a checkout-written, vendor-read table. No leenmart_app policy
--   on preorder_payment_attempts at all: no UI in this milestone reads
--   individual payment attempts, only a reservation's own status/amounts.
--
-- ENABLE only, never FORCE -- the established, platform-wide reason
-- (database-role-separation's own test: relforcerowsecurity is zero
-- everywhere).
-- ---------------------------------------------------------------------------
ALTER TABLE "preorder_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "preorder_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "preorder_payment_attempts" ENABLE ROW LEVEL SECURITY;

-- `ALTER DEFAULT PRIVILEGES` (20260812120000) grants new tables to
-- leenmart_app and leenmart_admin only, so every other role's grant is
-- explicit here.
GRANT SELECT, INSERT, UPDATE ON "preorder_campaigns" TO "leenmart_checkout";
GRANT SELECT ON "preorder_campaigns" TO "leenmart_public";

GRANT SELECT, INSERT, UPDATE ON "preorder_reservations" TO "leenmart_checkout";
GRANT SELECT, INSERT, UPDATE ON "preorder_payment_attempts" TO "leenmart_checkout";

-- CreatePolicy -- preorder_campaigns
CREATE POLICY "preorder_campaigns_vendor_select" ON "preorder_campaigns"
    FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "preorder_campaigns_vendor_insert" ON "preorder_campaigns"
    FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
CREATE POLICY "preorder_campaigns_vendor_update" ON "preorder_campaigns"
    FOR UPDATE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid)
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

CREATE POLICY "preorder_campaigns_checkout_select" ON "preorder_campaigns"
    FOR SELECT TO "leenmart_checkout" USING (true);
CREATE POLICY "preorder_campaigns_checkout_update" ON "preorder_campaigns"
    FOR UPDATE TO "leenmart_checkout" USING (true) WITH CHECK (true);

CREATE POLICY "preorder_campaigns_public_read" ON "preorder_campaigns"
    FOR SELECT TO "leenmart_public"
    USING ("status" != 'DRAFT');

CREATE POLICY "preorder_campaigns_admin_read" ON "preorder_campaigns"
    FOR SELECT TO leenmart_admin USING (true);

-- CreatePolicy -- preorder_reservations
-- No leenmart_app INSERT/DELETE policy at all: creation and every mutating
-- transition happen exclusively on leenmart_checkout (P6). The one
-- leenmart_app grant is the vendor's own read of their reservations (P7).
CREATE POLICY "preorder_reservations_checkout_select" ON "preorder_reservations"
    FOR SELECT TO "leenmart_checkout" USING (true);
CREATE POLICY "preorder_reservations_checkout_insert" ON "preorder_reservations"
    FOR INSERT TO "leenmart_checkout" WITH CHECK (true);
CREATE POLICY "preorder_reservations_checkout_update" ON "preorder_reservations"
    FOR UPDATE TO "leenmart_checkout" USING (true) WITH CHECK (true);

CREATE POLICY "preorder_reservations_vendor_select" ON "preorder_reservations"
    FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

CREATE POLICY "preorder_reservations_admin_read" ON "preorder_reservations"
    FOR SELECT TO leenmart_admin USING (true);

-- CreatePolicy -- preorder_payment_attempts
CREATE POLICY "preorder_payment_attempts_checkout_select" ON "preorder_payment_attempts"
    FOR SELECT TO "leenmart_checkout" USING (true);
CREATE POLICY "preorder_payment_attempts_checkout_insert" ON "preorder_payment_attempts"
    FOR INSERT TO "leenmart_checkout" WITH CHECK (true);
CREATE POLICY "preorder_payment_attempts_checkout_update" ON "preorder_payment_attempts"
    FOR UPDATE TO "leenmart_checkout" USING (true) WITH CHECK (true);

CREATE POLICY "preorder_payment_attempts_admin_read" ON "preorder_payment_attempts"
    FOR SELECT TO leenmart_admin USING (true);
