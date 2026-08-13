-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "brand" VARCHAR(120),
    "description" TEXT,
    "hsn_code" VARCHAR(8),
    "country_of_origin" VARCHAR(2),
    "net_quantity" VARCHAR(40),
    "attribute_values" JSONB NOT NULL DEFAULT '{}',
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "price_amount" BIGINT NOT NULL,
    "price_currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "unit_of_measure" VARCHAR(40) NOT NULL,
    "quantity_step" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- The composite-foreign-key target `product_variants` pins its own
-- denormalised vendor_id against — the exact technique
-- vendor_kyc_submissions/kyc_documents already use (KYC-2A), so the database
-- itself refuses a variant whose vendor does not match its product's.
CREATE UNIQUE INDEX "uq_products_id_vendor" ON "products"("id", "vendor_id");

-- CreateIndex
CREATE INDEX "idx_products_vendor_status" ON "products"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "idx_products_category_status" ON "products"("category_id", "status");

-- CreateIndex
-- SDD 6.4's own indexing table: a vendor's own SKU must be unique to them,
-- never globally — two different vendors may both use "SKU-001".
CREATE UNIQUE INDEX "uq_product_variants_vendor_sku" ON "product_variants"("vendor_id", "sku");

-- CreateIndex
CREATE INDEX "idx_product_variants_product" ON "product_variants"("product_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Composite: both product_id and vendor_id must match one products row, so a
-- variant cannot be created (or drifted, by a later update) onto a different
-- vendor's product.
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_vendor_id_fkey" FOREIGN KEY ("product_id", "vendor_id") REFERENCES "products"("id", "vendor_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express (SDD 6.1: "Constraints in
-- the database. Not only in the application... The database is the last line
-- of correctness"). Every rule below is also enforced by the `Product`/
-- `ProductVariant` aggregates where S2-3a builds that enforcement; this is
-- the copy that survives an application bug.
--
-- No GRANT block: `20260812120000_database_role_separation` ends with
-- ALTER DEFAULT PRIVILEGES FOR ROLE leenmart, so tables the owner creates
-- after it already carry SELECT/INSERT/UPDATE/DELETE for `leenmart_app` and
-- `leenmart_admin`.
-- ---------------------------------------------------------------------------

ALTER TABLE "products"
    -- A non-empty name after trimming — the same "database is the final
    -- arbiter of basic shape" reasoning `chk_categories_slug_format` applies,
    -- scoped down to "not blank" since S2-3 D-2/D-4 rule out a format regex
    -- or a uniqueness claim for product names.
    ADD CONSTRAINT "chk_products_name_not_blank"
        CHECK (char_length(btrim("name")) > 0);

ALTER TABLE "product_variants"
    -- Non-empty after trimming (S2-3 D-5: no format regex beyond that).
    ADD CONSTRAINT "chk_product_variants_sku_not_blank"
        CHECK (char_length(btrim("sku")) > 0),
    -- Non-empty after trimming (S2-3 D-3: free text, no closed vocabulary).
    ADD CONSTRAINT "chk_product_variants_unit_of_measure_not_blank"
        CHECK (char_length(btrim("unit_of_measure")) > 0),
    -- A price cannot be negative. Not stated as its own SDD line, but the
    -- same "an application bug must not be able to create a negative
    -- preorder quantity" principle (SDD 6.1) generalises directly to money.
    ADD CONSTRAINT "chk_product_variants_price_non_negative"
        CHECK ("price_amount" >= 0),
    -- A step of zero or less makes the increment meaningless; a step is what
    -- "250 g increments" (FR-11) means at all.
    ADD CONSTRAINT "chk_product_variants_quantity_step_positive"
        CHECK ("quantity_step" > 0);


-- ---------------------------------------------------------------------------
-- Tenant row-level security (S2-3a), the same three-layer defence SDD 6.6
-- already requires for kyc_documents et al., applied to the first catalogue
-- tables that are vendor-owned rather than platform-owned. Exact template:
-- 20260812180000_enable_tenant_rls. Deliberately NOT here, for the same
-- reasons that migration gives: no FORCE ROW LEVEL SECURITY (the runtime
-- roles already own nothing, so plain ENABLE binds them), no SECURITY
-- DEFINER, no app.is_admin setting.
-- ---------------------------------------------------------------------------

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;

-- CreatePolicy
-- No pre-tenant case here, unlike "vendors": a product cannot be created
-- before its vendor exists, so every policy is a plain vendor_id comparison.
CREATE POLICY "products_select" ON "products" FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
CREATE POLICY "products_insert" ON "products" FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
CREATE POLICY "products_update" ON "products" FOR UPDATE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid)
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- No DELETE policy, deliberately — soft-delete only, the same absence
-- "vendors"/"vendor_kyc_submissions"/"kyc_documents" already establish.

-- CreatePolicy
-- product_variants carries its own vendor_id, pinned to the parent product by
-- the composite foreign key above — the same reason kyc_documents_select is a
-- column comparison rather than a subquery against the parent.
CREATE POLICY "product_variants_select" ON "product_variants" FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
CREATE POLICY "product_variants_insert" ON "product_variants" FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
CREATE POLICY "product_variants_update" ON "product_variants" FOR UPDATE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid)
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- No DELETE policy on either table, matching the KYC tables.

-- ---------------------------------------------------------------------------
-- leenmart_admin — read-only, and only that. S2-3a builds no admin product
-- surface (D-6): granting a write policy now, before any admin code path
-- needs one, would hand every future admin route unrestricted write access
-- to every vendor's catalogue before anything written requires it — the
-- exact reasoning vendors_admin_read already gives.
-- ---------------------------------------------------------------------------

-- CreatePolicy
CREATE POLICY "products_admin_read" ON "products" FOR SELECT TO leenmart_admin USING (true);

-- CreatePolicy
CREATE POLICY "product_variants_admin_read" ON "product_variants" FOR SELECT TO leenmart_admin
    USING (true);
