-- CreateTable
CREATE TABLE "inventory" (
    "variant_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("variant_id")
);

-- CreateIndex
CREATE INDEX "idx_inventory_vendor" ON "inventory"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_inventory_variant_vendor" ON "inventory"("variant_id", "vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_product_variants_id_vendor" ON "product_variants"("id", "vendor_id");

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_vendor_id_fkey" FOREIGN KEY ("variant_id", "vendor_id") REFERENCES "product_variants"("id", "vendor_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express (SDD 6.1: "Constraints in the
-- database. Not only in the application... The database is the last line of
-- correctness").
--
-- `chk_inventory_available_non_negative` is the one SDD 14.4 names by hand:
-- the atomic conditional decrement is "Backed by CHECK (... >= 0), so the
-- database itself makes overselling impossible regardless of application
-- bugs." Stage 3's checkout path will lean on exactly this.
--
-- No GRANT block: `20260812120000_database_role_separation` ends with
-- ALTER DEFAULT PRIVILEGES FOR ROLE leenmart, so a table the owner creates
-- after it already carries SELECT/INSERT/UPDATE/DELETE for both runtime roles.
-- ---------------------------------------------------------------------------

ALTER TABLE "inventory"
    ADD CONSTRAINT "chk_inventory_available_non_negative" CHECK ("available" >= 0),
    ADD CONSTRAINT "chk_inventory_reserved_non_negative" CHECK ("reserved" >= 0),
    -- A version only ever moves forward, and starts at 1.
    ADD CONSTRAINT "chk_inventory_version_positive" CHECK ("version" >= 1);

-- ---------------------------------------------------------------------------
-- Row-level security (SDD 6.6 layer 3), mirroring `product_variants` exactly.
--
-- A column comparison rather than a subquery against the parent variant: this
-- is the row every checkout in the system will contend on, and the
-- denormalised `vendor_id` — pinned by the composite foreign key above — is
-- what makes that possible.
-- ---------------------------------------------------------------------------

ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_select" ON "inventory" FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

CREATE POLICY "inventory_insert" ON "inventory" FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

CREATE POLICY "inventory_update" ON "inventory" FOR UPDATE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid)
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- A DELETE policy, unlike every other catalogue table — and deliberately.
-- Inventory is a counter belonging to a variant, not a user-visible entity
-- with its own lifecycle, so it carries no `deleted_at` and is genuinely
-- removed when its variant goes. Without this policy that removal would
-- silently affect zero rows under RLS.
CREATE POLICY "inventory_delete" ON "inventory" FOR DELETE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- The admin credential reads across every vendor and writes nothing, the same
-- shape `products_admin_read`/`product_variants_admin_read` already take.
CREATE POLICY "inventory_admin_read" ON "inventory" FOR SELECT TO leenmart_admin USING (true);
