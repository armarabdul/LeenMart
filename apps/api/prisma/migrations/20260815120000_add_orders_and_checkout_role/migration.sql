-- Order foundation + the dedicated checkout database role (S3-3A).
--
-- Two things land together because the second exists only to serve the
-- first: the checkout credential has no purpose independent of placing an
-- order, so splitting them across two migrations would leave an interim
-- state where one half is meaningless without the other.
--
-- ---------------------------------------------------------------------------
-- Why a fourth database role.
-- ---------------------------------------------------------------------------
--
-- `PlaceOrderUseCase` must, in one transaction: atomically decrement
-- `inventory.available` for line items that may belong to *different*
-- vendors, then insert the `orders`/`sub_orders`/`order_items`/
-- `outbox_events` rows. No existing runtime credential can do this safely:
--
--   * `leenmart_app` — `inventory_update` (20260813220000_add_inventory)
--     is `USING/WITH CHECK (vendor_id = app.vendor_id)`: exactly one vendor
--     per session, set once by `tenantContext` for a *vendor's own* request.
--     A customer checkout session has no vendor tenant at all, and even if
--     it minted one, a multi-vendor cart needs more than one vendor per
--     transaction, which this policy structurally cannot express.
--   * `leenmart_admin` — has the table-level UPDATE grant (via
--     `ALTER DEFAULT PRIVILEGES`, 20260812120000), but RLS is enabled on
--     `inventory` and only `inventory_admin_read` (SELECT) was ever written
--     for this role. No UPDATE policy exists, so RLS silently refuses the
--     write (zero rows), regardless of the grant.
--   * `leenmart_public` — SELECT-only by explicit, on-the-record design
--     (see this same file's own predecessor, 20260814160000_add_cart: "Not
--     `adminPrisma`: ...reusing it for a customer-triggered cart write would
--     be a real privilege escalation, contradicting the least-privilege
--     reasoning the S2-7 migration already put on record for this exact
--     role" — written for a much smaller ask, a read, than a stock mutation).
--
-- `leenmart_checkout` is a fifth role, narrower than any of the three
-- above: it can read `vendors` (to resolve a plan/status/shop name), write
-- `inventory.available` (and nothing else on that table), and fully own the
-- four tables this milestone adds. It cannot touch KYC, catalogue mutation,
-- vendor administration, users, or any admin surface — those tables get no
-- grant for this role at all, so even RLS is moot: the underlying privilege
-- to read or write them does not exist.
--
-- Follows `leenmart_public`'s bootstrap shape exactly (20260814150000): a
-- `LOGIN` role with no password until `pnpm db:provision-roles` sets one
-- from `CHECKOUT_DATABASE_URL`, `NOSUPERUSER NOBYPASSRLS NOCREATEDB
-- NOCREATEROLE NOREPLICATION INHERIT`, idempotent and self-healing on
-- replay.

-- ---------------------------------------------------------------------------
-- Vendor shop display name (decision D-S3-03).
-- ---------------------------------------------------------------------------
--
-- Nullable, never backfilled: no pre-existing vendor has ever chosen a name,
-- and inventing one would be exactly the kind of invented business data this
-- project refuses. A vendor sets this themselves; until they do,
-- `PlaceOrderUseCase` refuses to sell that vendor's items rather than
-- snapshot a null or guessed name onto an order (SDD 6.3 requires "vendor
-- name" as an immutable order-item snapshot field).

-- AlterTable
ALTER TABLE "vendors" ADD COLUMN "shop_name" VARCHAR(120);

-- No RLS/grant change needed for this column: `vendors_update`
-- (20260812180000, `leenmart_app`, self-tenant) and `vendors_admin_decide`
-- (20260812210000, `leenmart_admin`, cross-tenant) already permit UPDATE on
-- the whole row — PostgreSQL RLS policies are row-scoped, not column-scoped,
-- so a new column on an already-covered table needs nothing further.

-- ---------------------------------------------------------------------------
-- Order / SubOrder / OrderItem (S3-3A, SDD 5 module 8, SDD 6.3).
-- ---------------------------------------------------------------------------

-- CreateEnum
-- One enum shared by "orders"."status" and "sub_orders"."status" — the
-- approved decision is to use the same four-state model for both. Only
-- PENDING_PAYMENT is ever produced by this milestone's own code paths;
-- CONFIRMED and PROCESSING are modelled for the domain state machine and
-- the cancellation-eligibility rule but have no HTTP caller yet (S3-3B and
-- vendor-portal/fulfilment work respectively).
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'CANCELLED');

-- CreateTable
-- Customer-owned, like "carts"/"addresses": no RLS, ownership enforced in
-- application code by customer_id. Read and written exclusively through
-- "leenmart_checkout" (see the file header) rather than "leenmart_app" —
-- there is deliberately no tenant-scoped path to this table at all.
CREATE TABLE "orders" (
    "id"                     UUID NOT NULL,
    "customer_id"            UUID NOT NULL,
    "status"                 "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "total_amount"           BIGINT NOT NULL,
    "total_currency"         VARCHAR(3) NOT NULL DEFAULT 'INR',
    "address_recipient_name" VARCHAR(100) NOT NULL,
    "address_phone"          VARCHAR(20) NOT NULL,
    "address_line_1"         VARCHAR(200) NOT NULL,
    "address_line_2"         VARCHAR(200),
    "address_city"           VARCHAR(100) NOT NULL,
    "address_state"          VARCHAR(100) NOT NULL,
    "address_pincode"        VARCHAR(6) NOT NULL,
    "address_landmark"       VARCHAR(200),
    "address_label"          VARCHAR(50) NOT NULL,
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_orders_customer_created" ON "orders"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_orders_status_created" ON "orders"("status", "created_at");

-- AddForeignKey
-- Restrict, not Cascade like "carts"."user_id": an order is retained
-- financial/audit history (SDD 22.5: 8 years), not disposable per-session
-- state, so it must not vanish if its owning "users" row ever did.
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
-- One vendor's slice of a multi-vendor order (SDD 6.3: "One customer
-- payment, N independent fulfilment lifecycles"). vendor_id is the grouping
-- key PlaceOrderUseCase buckets cart items by.
CREATE TABLE "sub_orders" (
    "id"                        UUID NOT NULL,
    "order_id"                  UUID NOT NULL,
    "vendor_id"                 UUID NOT NULL,
    "status"                    "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "vendor_shop_name_snapshot" VARCHAR(120) NOT NULL,
    "total_amount"              BIGINT NOT NULL,
    "total_currency"            VARCHAR(3) NOT NULL DEFAULT 'INR',
    "created_at"                TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sub_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_sub_orders_order" ON "sub_orders"("order_id");

-- CreateIndex
-- The vendor dashboard's primary query shape (SDD 6.4), even though no
-- vendor-facing order view is in S3-3A's scope — the index costs nothing to
-- add now and everything to retrofit under load later.
CREATE INDEX "idx_sub_orders_vendor_status_created" ON "sub_orders"("vendor_id", "status", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Restrict, matching every other vendor-referencing foreign key in this
-- schema: a vendor with live order history must not vanish out from under it.
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
-- The immutable checkout snapshot SDD 6.3 requires. Every "*_snapshot"
-- column is copied at placement time and never updated afterward — this
-- table has no "updated_at" and no repository method writes one.
--
-- product_id/variant_id/vendor_id are plain columns with **no foreign key**
-- to catalogue's tables, mirroring "cart_items"."variant_id" (SDD 5.1: no FK
-- crossing a module boundary except to the shared users/vendors anchors).
--
-- Tax is resolved-or-not, never defaulted to zero (decision D-S3-02):
-- tax_resolved = false means every tax_* column beside it stays NULL. An
-- unresolved amount is not the same fact as a zero-rated one.
CREATE TABLE "order_items" (
    "id"                          UUID NOT NULL,
    "sub_order_id"                UUID NOT NULL,
    "product_id"                  UUID NOT NULL,
    "variant_id"                  UUID NOT NULL,
    "vendor_id"                   UUID NOT NULL,
    "product_name_snapshot"       VARCHAR(200) NOT NULL,
    "variant_name_snapshot"       VARCHAR(120) NOT NULL,
    "vendor_shop_name_snapshot"   VARCHAR(120) NOT NULL,
    "unit_of_measure_snapshot"    VARCHAR(40) NOT NULL,
    "quantity"                    INTEGER NOT NULL,
    "unit_price_amount"           BIGINT NOT NULL,
    "unit_price_currency"         VARCHAR(3) NOT NULL DEFAULT 'INR',
    "line_amount"                 BIGINT NOT NULL,
    "line_currency"               VARCHAR(3) NOT NULL DEFAULT 'INR',
    "hsn_code_snapshot"           VARCHAR(8),
    "tax_resolved"                BOOLEAN NOT NULL DEFAULT false,
    "tax_rate_basis_points"       INTEGER,
    "tax_amount"                  BIGINT,
    "tax_currency"                VARCHAR(3),
    "commission_rate_basis_points" INTEGER NOT NULL,
    "commission_amount"           BIGINT NOT NULL,
    "commission_currency"         VARCHAR(3) NOT NULL DEFAULT 'INR',
    "created_at"                  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_order_items_sub_order" ON "order_items"("sub_order_id");

-- CreateIndex
CREATE INDEX "idx_order_items_variant_created" ON "order_items"("variant_id", "created_at");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Idempotency-Key storage (S3-3A, SDD 9.2/9.4/10.5/17.1).
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "IdempotencyKeyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
-- Scoped by (user_id, key, endpoint) — SDD 6.4 names "unique (key,
-- endpoint)"; user_id narrows it further because a client-chosen header
-- value alone is not guaranteed unique across different authenticated
-- callers. request_hash (SHA-256 hex) is what SDD leaves unstated: replaying
-- the same key with a *different* payload is rejected, not served a stale
-- response for the wrong request. No database TTL extension — the 24-hour
-- honour window is enforced by the middleware comparing expires_at to the
-- clock, matching this schema's existing soft-expiry convention
-- ("otps"."expires_at", "refresh_tokens"."expires_at").
CREATE TABLE "idempotency_keys" (
    "id"              UUID NOT NULL,
    "user_id"         UUID NOT NULL,
    "key"             VARCHAR(255) NOT NULL,
    "endpoint"        VARCHAR(200) NOT NULL,
    "request_hash"    VARCHAR(64) NOT NULL,
    "status"          "IdempotencyKeyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body"   JSONB,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"      TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_idempotency_keys_user_key_endpoint" ON "idempotency_keys"("user_id", "key", "endpoint");

-- CreateIndex
CREATE INDEX "idx_idempotency_keys_expires_at" ON "idempotency_keys"("expires_at");

-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express (SDD 6.1) — the database is
-- the last line of correctness, matching "inventory"'s own CHECK (>= 0)
-- pattern (SDD 14.4) applied to every new money/quantity column here.
-- ---------------------------------------------------------------------------

ALTER TABLE "orders"
    ADD CONSTRAINT "chk_orders_total_amount_non_negative" CHECK ("total_amount" >= 0);

ALTER TABLE "sub_orders"
    ADD CONSTRAINT "chk_sub_orders_total_amount_non_negative" CHECK ("total_amount" >= 0);

ALTER TABLE "order_items"
    ADD CONSTRAINT "chk_order_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "order_items"
    ADD CONSTRAINT "chk_order_items_unit_price_non_negative" CHECK ("unit_price_amount" >= 0);

ALTER TABLE "order_items"
    ADD CONSTRAINT "chk_order_items_line_amount_non_negative" CHECK ("line_amount" >= 0);

ALTER TABLE "order_items"
    ADD CONSTRAINT "chk_order_items_commission_amount_non_negative" CHECK ("commission_amount" >= 0);

-- Tax fields are an equivalence, not an implication, mirroring
-- "chk_products_rejection_requires_reason_and_note"'s shape one migration
-- family over: resolved and unresolved are two distinct, fully-specified
-- shapes, and this constraint refuses anything halfway between them.
ALTER TABLE "order_items"
    ADD CONSTRAINT "chk_order_items_tax_resolution_shape" CHECK (
        ("tax_resolved" = true
            AND "tax_rate_basis_points" IS NOT NULL
            AND "tax_amount" IS NOT NULL
            AND "tax_amount" >= 0
            AND "tax_currency" IS NOT NULL)
        OR
        ("tax_resolved" = false
            AND "tax_rate_basis_points" IS NULL
            AND "tax_amount" IS NULL
            AND "tax_currency" IS NULL)
    );

-- No GRANT block for "orders"/"sub_orders"/"order_items"/"idempotency_keys"
-- and leenmart_app/leenmart_admin: 20260812120000_database_role_separation's
-- ALTER DEFAULT PRIVILEGES FOR ROLE leenmart already covers any table the
-- owner creates after it. Neither credential has an RLS policy that would
-- let it actually read or write these tables in practice (no RLS is enabled
-- on them at all — ownership is an application-code concern, the same
-- "carts"/"addresses" convention), but nothing in this milestone routes
-- through either role for order data regardless; only "leenmart_checkout"
-- (below) does.

-- ---------------------------------------------------------------------------
-- The "leenmart_checkout" role (S3-3A decision, Option B).
-- ---------------------------------------------------------------------------

-- CreateRole
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leenmart_checkout') THEN
        -- LOGIN but no password: unusable until `pnpm db:provision-roles` runs,
        -- the same convergence-not-assumption discipline every other runtime
        -- role in this schema uses.
        CREATE ROLE "leenmart_checkout" WITH LOGIN;
    END IF;

    -- Re-asserted on every replay, not just at creation — the same discipline
    -- 20260812120000_database_role_separation applies to leenmart_app/
    -- leenmart_admin, so a role that drifted is corrected rather than trusted.
    ALTER ROLE "leenmart_checkout" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
END
$$;

-- Grant
GRANT USAGE ON SCHEMA public TO "leenmart_checkout";
REVOKE CREATE ON SCHEMA public FROM "leenmart_checkout";

-- Grant
-- The order module's own tables: full DML, since this role's entire purpose
-- is to place, read and cancel orders.
GRANT SELECT, INSERT, UPDATE ON "orders" TO "leenmart_checkout";
GRANT SELECT, INSERT, UPDATE ON "sub_orders" TO "leenmart_checkout";
GRANT SELECT, INSERT, UPDATE ON "order_items" TO "leenmart_checkout";
-- `DELETE`, not just `SELECT, INSERT, UPDATE`: `IdempotencyKeyRepository.release()`
-- deletes a claim that didn't reach a cacheable success (so the same key can
-- be retried after a genuine failure), and `claim()`'s own expired-claim path
-- deletes a stale row before retrying — both genuine deletes this role must
-- be able to perform, not an oversight to leave narrower.
GRANT SELECT, INSERT, UPDATE, DELETE ON "idempotency_keys" TO "leenmart_checkout";

-- Grant
-- The transactional outbox: insert-only, matching the shape SDD 4.2 assigns
-- the writer half of this pattern — nothing about placing an order ever
-- reads or updates an outbox row; a future relay worker (out of S3-3A's
-- scope) would be a different credential entirely.
GRANT INSERT ON "outbox_events" TO "leenmart_checkout";

-- Grant
-- Read-only on "vendors" (to resolve plan/status/shop_name for every vendor
-- appearing in the cart, which may be more than one). Nothing else on this
-- table — no KYC table, no catalogue mutation table, no admin table, no
-- users table receives any grant for this role at all, so there is no
-- privilege to bypass regardless of what RLS policy does or does not exist
-- for them.
GRANT SELECT ON "vendors" TO "leenmart_checkout";

-- Grant
-- "inventory" needs both SELECT and UPDATE, not UPDATE alone: PostgreSQL
-- requires SELECT privilege to evaluate an UPDATE's WHERE clause and any
-- expression referencing an existing column value (`available - :quantity`
-- reads `available`), verified empirically against this exact statement
-- before writing the rest of this module — `UPDATE ... SET available =
-- available - 1 WHERE available >= 1` fails outright with UPDATE-only
-- privilege. This is still the minimum needed for the one statement this
-- role exists to run, not a broadening of intent.
GRANT SELECT, UPDATE ON "inventory" TO "leenmart_checkout";

-- CreatePolicy
-- "vendors" carries no KYC/bank/financial data (that lives in
-- "vendor_kyc_submissions"/"kyc_documents", tables this role has no grant on
-- at all) — id/user_id/status/plan/shop_name only — so an unconditional read
-- is the same shape "vendors_admin_read" already establishes for the same
-- reason: cross-vendor reach is the point, not a gap.
CREATE POLICY "vendors_checkout_read" ON "vendors" FOR SELECT TO "leenmart_checkout"
    USING (true);

-- CreatePolicy
-- The read half of the inventory grant above — a `FOR SELECT` policy is a
-- separate RLS command from `FOR UPDATE` even on the same table/role, and
-- PostgreSQL applies it independently when evaluating the UPDATE statement's
-- WHERE clause and SET expression. `USING (true)`, matching the reasoning
-- `vendors_checkout_read` already states: no filtering is meaningful here,
-- since this role must reach every vendor's inventory row.
CREATE POLICY "inventory_checkout_read" ON "inventory" FOR SELECT TO "leenmart_checkout"
    USING (true);

-- CreatePolicy
-- The one write this role exists for. WITH CHECK mirrors the table-level
-- CHECK constraint SDD 14.4 already places on "available" — restated here
-- because RLS and CHECK are enforced independently, and a WITH CHECK that
-- merely deferred to the column constraint would be trusting a mechanism
-- this design otherwise treats as defence in depth, not a single point of
-- failure. USING (true): this role must reach every vendor's inventory row
-- in one multi-vendor checkout transaction, and there is no session-level
-- setting to scope it further (SDD 6.6's tenant model exists for
-- "leenmart_app"; this role deliberately does not carry one — see the file
-- header for why).
CREATE POLICY "inventory_checkout_decrement" ON "inventory" FOR UPDATE TO "leenmart_checkout"
    USING (true)
    WITH CHECK ("available" >= 0);
