-- Cart technical foundation (S3-1, SDD 5 module 6 / 9.4).
--
-- `carts`/`cart_items` follow `addresses`' shape exactly: no RLS, ownership
-- enforced in application code by (id, user_id)/(cart_id) scoping, because a
-- cart belongs to a customer, not a vendor tenant — there is no
-- `current_setting('app.vendor_id')` for a customer session to carry.
--
-- `cart_items.variant_id` carries **no foreign key** to `product_variants`:
-- SDD 5.1 forbids a foreign key crossing a module boundary except to the
-- shared `users`/`vendors` identity anchors, and `cart` and `catalogue` are
-- separate modules. Existence/eligibility is checked at the application
-- layer instead, via the `leenmart_public` grants added below.

-- CreateTable
CREATE TABLE "carts" (
    "id"         UUID NOT NULL,
    "user_id"    UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_carts_user" ON "carts"("user_id");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "cart_items" (
    "id"         UUID NOT NULL,
    "cart_id"    UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity"   INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_cart_items_cart" ON "cart_items"("cart_id");

-- CreateIndex
-- Partial unique index, hand-added (Prisma's DSL has no WHERE clause for
-- indexes — same reason `idx_addresses_one_default_per_user` is hand-added).
-- One live row per variant per cart is the actual enforcement of "adding an
-- already-present variant increments its quantity rather than duplicating
-- the row" — a database constraint, not just an application check.
CREATE UNIQUE INDEX "uq_cart_items_cart_variant" ON "cart_items"("cart_id", "variant_id") WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express (SDD 6.1).
-- ---------------------------------------------------------------------------

ALTER TABLE "cart_items"
    ADD CONSTRAINT "chk_cart_items_quantity_positive" CHECK ("quantity" > 0);

-- No GRANT block for "carts"/"cart_items" and leenmart_app/leenmart_admin:
-- `20260812120000_database_role_separation` ends with ALTER DEFAULT
-- PRIVILEGES FOR ROLE leenmart, so a table the owner creates after it already
-- carries SELECT/INSERT/UPDATE/DELETE for both runtime roles. No RLS is
-- enabled on either table — see the file header.

-- ---------------------------------------------------------------------------
-- Widens the `leenmart_public` role (created in
-- 20260814150000_add_public_product_search) with exactly the two additional
-- grants S3-1's eligibility/availability checks need. Not `adminPrisma`: that
-- credential is the elevated cross-tenant surface used for admin actions, and
-- reusing it for a customer-triggered cart write would be a real privilege
-- escalation, contradicting the least-privilege reasoning the S2-7 migration
-- already put on record for this exact role. `leenmart_public` already exists
-- with no login password until `pnpm db:provision-roles` runs (S2-7).
-- ---------------------------------------------------------------------------

-- Grant
GRANT SELECT ON "product_variants" TO "leenmart_public";
GRANT SELECT ON "inventory" TO "leenmart_public";

-- CreatePolicy
-- Mirrors `products_public_read`'s `status = 'APPROVED'` gate one level down:
-- a variant is visible to this role only if its parent product is approved
-- and neither row is soft-deleted. This is what makes "findById returns
-- non-null under publicPrisma" the entire eligibility proof S3-1's
-- AddCartItemUseCase relies on — no separate status check in application code.
CREATE POLICY "product_variants_public_read" ON "product_variants" FOR SELECT TO "leenmart_public"
    USING (
        "deleted_at" IS NULL
        AND EXISTS (
            SELECT 1 FROM "products" p
            WHERE p."id" = "product_variants"."product_id"
              AND p."status" = 'APPROVED'
              AND p."deleted_at" IS NULL
        )
    );

-- CreatePolicy
-- Same eligibility chain one level further down, since `inventory` has no
-- status column of its own to gate on — its primary key is `variant_id`, so
-- the policy walks variant -> product itself rather than trusting a prior
-- query to have already filtered (RLS is enforced per-table, independent of
-- what else a query joins against).
CREATE POLICY "inventory_public_read" ON "inventory" FOR SELECT TO "leenmart_public"
    USING (
        EXISTS (
            SELECT 1 FROM "product_variants" v
            JOIN "products" p ON p."id" = v."product_id"
            WHERE v."id" = "inventory"."variant_id"
              AND v."deleted_at" IS NULL
              AND p."status" = 'APPROVED'
              AND p."deleted_at" IS NULL
        )
    );
