-- Verified-purchase product reviews (S8-REVIEWS, SDD 5 module #14, V1 slice).
--
-- Scope, locked: product reviews only (no shop reviews, no
-- `review_moderation`/`review_aggregates` as separate tables — the SDD's
-- fuller module #14 vision), no edit/delete, no vendor reply, no Bayesian
-- aggregation, no notifications. See `Review`'s own schema.prisma comment
-- for the full reasoning.

-- CreateEnum
-- Native Postgres enum, matching this schema's own established convention
-- (e.g. `NotificationRecipientKind`/`NotificationChannel`, 20260819160000) —
-- not `TEXT` plus a `CHECK`.
CREATE TYPE "ReviewModerationStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'HIDDEN');

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "sub_order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "status" "ReviewModerationStatus" NOT NULL DEFAULT 'SUBMITTED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- The locked V1 rule, enforced twice already (the wire schema, the domain
-- entity) and now a third time here — the database is what actually makes
-- an out-of-range rating impossible regardless of an application bug.
ALTER TABLE "reviews" ADD CONSTRAINT "chk_reviews_rating_range"
    CHECK ("rating" >= 1 AND "rating" <= 5);

-- The whole of "one review per verified purchase" (locked scope): an
-- `OrderItem` is already the atomic unit of one product/variant bought once
-- within one sub-order, so a unique index on it is exactly the invariant,
-- not an approximation of it. No application-level check alone could give
-- this guarantee under concurrent submission the way this index does.
CREATE UNIQUE INDEX "uq_reviews_order_item" ON "reviews"("order_item_id");

-- CreateIndex
-- The public product page: approved reviews for one product, newest first.
CREATE INDEX "idx_reviews_product_status_created" ON "reviews"("product_id", "status", "created_at" DESC);

-- CreateIndex
-- "My reviews" / reviewability lookups: this customer's own reviews.
CREATE INDEX "idx_reviews_customer_created" ON "reviews"("customer_id", "created_at" DESC);

-- CreateIndex
-- The moderation queue: everything awaiting a decision, oldest first.
CREATE INDEX "idx_reviews_status_created" ON "reviews"("status", "created_at");

-- AddForeignKey
-- The one FK this table is allowed: `users` is a shared identity anchor
-- (SDD 5.1/6.7). `product_id`/`variant_id`/`sub_order_id`/`order_item_id`
-- deliberately carry none — `catalogue` and `order` are different modules,
-- and SDD 5.1 forbids a FK crossing a module boundary except to
-- `users`/`vendors`. Existence and ownership are verified at the
-- application layer against the real records, the same
-- `cart_items.variant_id` (S3-1) and `order_items.product_id`/`variant_id`
-- (S3-3A/S3-5) precedent for every FK-less column in this schema.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-level security (SDD 6.6 layer 3).
--
-- The second **user-scoped** table (S6-NOTIFY-INAPP's `notifications` was the
-- first) — `app.user_id` is set by `tenantContext` for every authenticated
-- caller, and `Review` now joins `TENANT_SCOPED_MODELS`/`USER_ROOTED_MODELS`
-- (tenant-context.ts) for exactly the reason `Notification` did: a customer
-- has no vendor and never will, so requiring one would lock them out of
-- their own reviews while protecting nothing.
--
--   leenmart_app   — the customer. SELECT and INSERT, both confined to
--                    `customer_id = app.user_id`. No UPDATE/DELETE policy:
--                    edit and delete are explicitly out of this milestone's
--                    locked scope (FR-52's fuller ask), so the role is not
--                    merely discouraged from writing again, it structurally
--                    cannot.
--   leenmart_admin — the moderator (`MODERATE_REVIEWS`, SDD 8.2). Unlike
--                    `notifications`, this policy is deliberate and expected:
--                    `notifications_recipient_select`'s own migration comment
--                    already anticipated that "an admin surface would have to
--                    add the policy deliberately" once one exists, and
--                    `MODERATE_REVIEWS` (`CATALOGUE_MODERATOR`/`SUPER_ADMIN`:
--                    FULL, `SUPPORT_AGENT`/`RISK_ANALYST`: READ_ONLY) is
--                    exactly that authoritative requirement. Full table
--                    reach — the read/write split for the two access levels
--                    is enforced by `requirePermission`/`requireFullAccess`
--                    in the interface layer (SDD 7.4 step 2), not by a
--                    second, narrower database role; this mirrors
--                    `admin-product`/`admin-kyc`'s own established pattern
--                    of one full-reach admin credential gated by
--                    permission-matrix middleware in front of it, not by a
--                    second credential.
--   leenmart_public — approved-only, mirroring `products_public_read`
--                    (S2-7) exactly: `USING (status = 'APPROVED')`, no other
--                    grant.
--
-- No `leenmart_checkout` policy: checkout never reads or writes reviews —
-- the verified-purchase check reads from `orders`/`sub_orders`/`order_items`
-- (already `leenmart_checkout`-reachable), never from this table.
--
-- ENABLE only, never FORCE — the established, asserted-platform-wide reason
-- (`database-role-separation`'s own test: `relforcerowsecurity` is zero
-- everywhere).
-- ---------------------------------------------------------------------------
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON "reviews" TO "leenmart_public";

CREATE POLICY "reviews_customer_select" ON "reviews"
    FOR SELECT TO leenmart_app
    USING ("customer_id" = nullif(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY "reviews_customer_insert" ON "reviews"
    FOR INSERT TO leenmart_app
    WITH CHECK ("customer_id" = nullif(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY "reviews_admin_select" ON "reviews"
    FOR SELECT TO "leenmart_admin" USING (true);
CREATE POLICY "reviews_admin_update" ON "reviews"
    FOR UPDATE TO "leenmart_admin" USING (true) WITH CHECK (true);

CREATE POLICY "reviews_public_read" ON "reviews"
    FOR SELECT TO "leenmart_public"
    USING ("status" = 'APPROVED');
